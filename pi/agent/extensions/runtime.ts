import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	formatSize,
	truncateHead,
	type ExtensionAPI,
	type ExtensionContext,
	withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";

type MemoryState = {
	enabled?: boolean;
};

type WorktreeState = {
	enabled?: boolean;
	name?: string;
	path?: string;
	rootPath?: string;
};

type CachedSection = {
	signature: string;
	text: string;
};

type BuiltInTools = ReturnType<typeof createBuiltInTools>;

type ManagedWorktree = {
	name: string;
	path: string;
	rootPath: string;
};

type GitWorktreeRecord = {
	path: string;
	branch?: string;
	detached: boolean;
};

const MEMORY_STATE_TYPE = "pi-memory-state";
const WORKTREE_STATE_TYPE = "pi-worktree-state";
const CONTEXT_STATUS_KEY = "pi-context";
const MEMORY_STATUS_KEY = "pi-memory";
const WORKTREE_STATUS_KEY = "pi-worktree";
const MEMORY_DIRECTORY = join(".pi", "memory");
const MEMORY_FILE_NAME = "project-memory.md";
const PLAN_PATH = join(".pi", "plans", "active-plan.md");
const CONTEXT_COMMANDS = ["status", "refresh", "compact"];
const MEMORY_COMMANDS = ["status", "show", "edit", "path", "on", "off"];
const WORKTREE_COMMANDS = ["status", "create", "use", "off", "path", "list"];
const LARGE_OUTPUT_THRESHOLD_BYTES = 24 * 1024;
const LARGE_OUTPUT_PREVIEW_LINES = 160;
const LARGE_OUTPUT_PREVIEW_BYTES = 12 * 1024;
const MEMORY_PROMPT_MAX_LINES = 120;
const MEMORY_PROMPT_MAX_BYTES = 8 * 1024;
const HOST_PLATFORM = platform();
const MEMORY_TEMPLATE = [
	"# Project Memory",
	"",
	"## Durable Facts",
	"- ",
	"",
	"## Conventions",
	"- ",
	"",
	"## Known Constraints",
	"- ",
].join("\n");
const SENSITIVE_MEMORY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
	{ label: "password", pattern: /\bpassword\b/i },
	{ label: "secret", pattern: /\bsecret\b/i },
	{ label: "token", pattern: /\btoken\b/i },
	{ label: "api key", pattern: /\bapi[_ -]?key\b/i },
	{ label: "private key", pattern: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
	{ label: "authorization header", pattern: /\bauthorization:\s*(bearer|basic)\b/i },
	{ label: "aws access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ label: "github token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
];

function createBuiltInTools(cwd: string) {
	return {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		grep: createGrepTool(cwd),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
	};
}

function getLatestCustomEntryData<T>(ctx: ExtensionContext, customType: string): T | undefined {
	const entry = ctx.sessionManager
		.getEntries()
		.filter((item: { type: string; customType?: string }) => item.type === "custom" && item.customType === customType)
		.pop() as { data?: T } | undefined;

	return entry?.data;
}

function getProjectMemoryPath(cwd: string): string {
	return join(cwd, MEMORY_DIRECTORY, MEMORY_FILE_NAME);
}

function getRelativeDisplayPath(cwd: string, path: string): string {
	const rel = relative(cwd, path);
	if (!rel || rel.length === 0) return ".";
	return rel.startsWith("..") ? path : rel;
}

function readTextFile(path: string): string | undefined {
	if (!existsSync(path)) return undefined;

	try {
		return readFileSync(path, "utf-8");
	} catch (error) {
		console.error(`Failed to read ${path}: ${String(error)}`);
		return undefined;
	}
}

function stripFrontMatter(raw: string): string {
	const match = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
	return match ? match[1].trim() : raw.trim();
}

function hashText(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

function canonicalizeExistingPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function getHostPlatformLabel(): string {
	if (HOST_PLATFORM === "darwin") return "macOS";
	if (HOST_PLATFORM === "win32") return "Windows";
	return "Linux/Unix";
}

function getSensitiveMemoryLabels(text: string): string[] {
	return SENSITIVE_MEMORY_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
}

function buildPlatformPromptSection(): string {
	if (HOST_PLATFORM !== "darwin") return "";

	return [
		"## Host Platform",
		"- Host OS: macOS (Darwin)",
		"- Prefer POSIX- and BSD-compatible shell flags over GNU-only variants",
		"- `sed -i`, `stat`, `du`, `df`, and `readlink` behave differently than on Linux",
		"- Prefer Pi's read/edit/write tools for file changes instead of shell mutation one-liners",
		"- macOS-safe inspection commands such as `sw_vers`, `mdfind`, `mdls`, `plutil`, and read-only `brew info|list|search` commands may be available",
	].join("\n");
}

function buildMemoryPromptSection(cwd: string, memoryEnabled: boolean): string {
	if (!memoryEnabled) return "";

	const path = getProjectMemoryPath(cwd);
	const memory = readTextFile(path)?.trim();
	if (!memory) return "";

	const sensitiveLabels = getSensitiveMemoryLabels(memory);
	if (sensitiveLabels.length > 0) {
		return [
			"## Project Memory",
			`Project memory exists at \`${getRelativeDisplayPath(cwd, path)}\` but it was not injected because it appears to contain sensitive material.`,
			`Review the file and remove secret-like content before relying on it in prompts. Triggers: ${sensitiveLabels.join(", ")}`,
		].join("\n");
	}

	const truncated = truncateHead(memory, {
		maxLines: MEMORY_PROMPT_MAX_LINES,
		maxBytes: MEMORY_PROMPT_MAX_BYTES,
	});
	const lines = [
		"## Project Memory",
		"Use this only for durable project facts and conventions, not for transient task state.",
		`Source: \`${getRelativeDisplayPath(cwd, path)}\``,
		"",
		truncated.content.trim(),
	];

	if (truncated.truncated) {
		lines.push(
			"",
			`[Prompt memory truncated: showing ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)}). Read the file directly if needed.]`,
		);
	}

	return lines.join("\n");
}

function buildWorktreePromptSection(cwd: string, worktreeState: WorktreeState): string {
	if (!worktreeState.enabled || !worktreeState.path) return "";

	const worktreePath = getRelativeDisplayPath(cwd, worktreeState.path);
	const rootPath = worktreeState.rootPath ? getRelativeDisplayPath(cwd, worktreeState.rootPath) : worktreePath;
	return [
		"## Execution Workspace",
		`Tool execution is routed through the isolated git worktree \`${worktreePath}\`.`,
		`Worktree root: \`${rootPath}\``,
		"Treat that workspace as the active checkout for reads, searches, bash commands, and edits.",
		"Shared workflow files such as the project plan and project memory still live under the main repository root unless the user changes them explicitly via commands.",
	].join("\n");
}

function buildCompactionInstructions(cwd: string, memoryEnabled: boolean, worktreeState: WorktreeState, extraInstructions?: string): string {
	const lines = [
		"Preserve the durable workflow state below in the compaction summary.",
		"- Keep the current persona/workflow intent, approved-plan state, and any remaining blockers.",
		"- Keep durable project conventions and constraints.",
		"- Drop repetitive tool chatter and transient exploration that no longer matters.",
	];

	if (worktreeState.enabled && worktreeState.path) {
		lines.push(`- Execution workspace is the isolated worktree at \`${getRelativeDisplayPath(cwd, worktreeState.path)}\`.`);
	} else {
		lines.push("- Execution workspace is the main checkout.");
	}

	const planRaw = readTextFile(join(cwd, PLAN_PATH));
	if (planRaw) {
		const planBody = stripFrontMatter(planRaw);
		const truncatedPlan = truncateHead(planBody, { maxLines: 40, maxBytes: 4 * 1024 });
		lines.push("", "Active plan snapshot:", truncatedPlan.content.trim());
	}

	if (memoryEnabled) {
		const memory = readTextFile(getProjectMemoryPath(cwd))?.trim();
		if (memory) {
			const sensitiveLabels = getSensitiveMemoryLabels(memory);
			if (sensitiveLabels.length === 0) {
				const truncatedMemory = truncateHead(memory, { maxLines: 40, maxBytes: 4 * 1024 });
				lines.push("", "Durable project memory to preserve:", truncatedMemory.content.trim());
			} else {
				lines.push("", `Project memory exists but may contain sensitive material. Do not quote or retain the sensitive text verbatim. Triggers: ${sensitiveLabels.join(", ")}`);
			}
		}
	}

	if (extraInstructions) {
		lines.push("", "Additional user instructions:", extraInstructions.trim());
	}

	return lines.join("\n");
}

function getManagedWorktreeBase(repoRoot: string): string {
	const repoName = basename(repoRoot).replace(/[^a-zA-Z0-9._-]+/g, "-") || "repo";
	const repoHash = hashText(repoRoot).slice(0, 8);
	return join(canonicalizeExistingPath(tmpdir()), "pi-worktrees", `${repoName}-${repoHash}`);
}

function findGitRepoRoot(cwd: string): string | undefined {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		encoding: "utf-8",
	});

	if (result.status !== 0) return undefined;
	const root = result.stdout.trim();
	return root.length > 0 ? canonicalizeExistingPath(root) : undefined;
}

function parseGitWorktreeList(output: string): GitWorktreeRecord[] {
	const entries: GitWorktreeRecord[] = [];
	let current: GitWorktreeRecord | undefined;

	for (const line of output.split(/\r?\n/)) {
		if (!line.trim()) {
			if (current) entries.push(current);
			current = undefined;
			continue;
		}

		const separatorIndex = line.indexOf(" ");
		const key = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
		const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).trim();

		if (key === "worktree") {
			current = {
				path: value,
				detached: false,
			};
			continue;
		}

		if (!current) continue;
		if (key === "branch") current.branch = value;
		if (key === "detached") current.detached = true;
	}

	if (current) entries.push(current);
	return entries;
}

function listManagedWorktrees(repoRoot: string): ManagedWorktree[] {
	const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd: repoRoot,
		encoding: "utf-8",
	});
	if (result.status !== 0) return [];

	const basePath = getManagedWorktreeBase(repoRoot);
	return parseGitWorktreeList(result.stdout)
		.map((entry) => ({
			...entry,
			path: canonicalizeExistingPath(entry.path),
		}))
		.filter((entry) => entry.path.startsWith(`${basePath}/`) || entry.path === basePath)
		.map((entry) => ({
			name: basename(entry.path),
			path: entry.path,
			rootPath: entry.path,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function validateWorktreeName(name: string): string | undefined {
	if (!name) return "Worktree name is required.";
	if (name === "." || name === "..") return "Worktree name must not be '.' or '..'.";
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/.test(name)) {
		return "Worktree name must start with a letter or digit and contain only letters, digits, dot, underscore, or hyphen.";
	}
	return undefined;
}

function resolveExecutionPath(repoRoot: string, currentCwd: string, worktreeRoot: string): string {
	const relativePath = relative(canonicalizeExistingPath(repoRoot), canonicalizeExistingPath(currentCwd));
	if (!relativePath || relativePath === ".") return worktreeRoot;
	const candidate = join(worktreeRoot, relativePath);
	return existsSync(candidate) ? candidate : worktreeRoot;
}

function createOrReuseManagedWorktree(repoRoot: string, currentCwd: string, name: string): { created: boolean; rootPath: string; path: string; error?: string } {
	const existing = listManagedWorktrees(repoRoot).find((entry) => entry.name === name);
	if (existing) {
		return {
			created: false,
			rootPath: existing.rootPath,
			path: resolveExecutionPath(repoRoot, currentCwd, existing.rootPath),
		};
	}

	const baseDir = getManagedWorktreeBase(repoRoot);
	const targetRoot = join(baseDir, name);
	mkdirSync(baseDir, { recursive: true });

	if (existsSync(targetRoot)) {
		const normalizedTargetRoot = canonicalizeExistingPath(targetRoot);
		return {
			created: false,
			rootPath: normalizedTargetRoot,
			path: resolveExecutionPath(repoRoot, currentCwd, normalizedTargetRoot),
			error: `Path already exists but is not registered as a git worktree: ${normalizedTargetRoot}`,
		};
	}

	const result = spawnSync("git", ["worktree", "add", "--detach", targetRoot], {
		cwd: repoRoot,
		encoding: "utf-8",
	});

	if (result.status !== 0) {
		const normalizedTargetRoot = canonicalizeExistingPath(targetRoot);
		return {
			created: false,
			rootPath: normalizedTargetRoot,
			path: resolveExecutionPath(repoRoot, currentCwd, normalizedTargetRoot),
			error: (result.stderr || result.stdout || "git worktree add failed").trim(),
		};
	}

	return {
		created: true,
		rootPath: canonicalizeExistingPath(targetRoot),
		path: resolveExecutionPath(repoRoot, currentCwd, canonicalizeExistingPath(targetRoot)),
	};
}

function createSectionCache() {
	const cache = new Map<string, CachedSection>();
	return {
		clear() {
			cache.clear();
		},
		get(key: string, signature: string, factory: () => string): string {
			const cached = cache.get(key);
			if (cached && cached.signature === signature) return cached.text;
			const text = factory();
			cache.set(key, { signature, text });
			return text;
		},
		size() {
			return cache.size;
		},
	};
}

function getTextContent(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

export default function runtimeExtension(pi: ExtensionAPI): void {
	const bootstrapTools = createBuiltInTools(process.cwd());
	const toolCache = new Map<string, BuiltInTools>();
	const sectionCache = createSectionCache();
	let memoryEnabled = true;
	let worktreeState: WorktreeState = { enabled: false };
	let warnedHighContext = false;
	let warnedSensitiveMemory = false;

	function getBuiltInTools(cwd: string): BuiltInTools {
		let tools = toolCache.get(cwd);
		if (!tools) {
			tools = createBuiltInTools(cwd);
			toolCache.set(cwd, tools);
		}
		return tools;
	}

	function clearPromptState(): void {
		sectionCache.clear();
	}

	function getActiveToolCwd(ctx: ExtensionContext): string {
		if (worktreeState.enabled && worktreeState.path && existsSync(worktreeState.path)) {
			return worktreeState.path;
		}
		return ctx.cwd;
	}

	function updateStatus(ctx: ExtensionContext): void {
		const usage = ctx.getContextUsage();
		if (!usage || usage.percent === null) {
			ctx.ui.setStatus(CONTEXT_STATUS_KEY, ctx.ui.theme.fg("muted", "ctx:unknown"));
		} else {
			const color = usage.percent >= 85 ? "warning" : usage.percent >= 65 ? "accent" : "muted";
			const tokensLabel = usage.tokens === null ? "?" : usage.tokens.toLocaleString();
			ctx.ui.setStatus(CONTEXT_STATUS_KEY, ctx.ui.theme.fg(color, `ctx:${Math.round(usage.percent)}%/${tokensLabel}`));
		}

		ctx.ui.setStatus(MEMORY_STATUS_KEY, ctx.ui.theme.fg(memoryEnabled ? "success" : "dim", memoryEnabled ? "mem:on" : "mem:off"));

		if (worktreeState.enabled && worktreeState.name) {
			ctx.ui.setStatus(WORKTREE_STATUS_KEY, ctx.ui.theme.fg("accent", `wt:${worktreeState.name}`));
		} else {
			ctx.ui.setStatus(WORKTREE_STATUS_KEY, ctx.ui.theme.fg("dim", "wt:main"));
		}
	}

	function maybeWarnAboutContext(ctx: ExtensionContext): void {
		const usage = ctx.getContextUsage();
		if (!usage || usage.percent === null) return;

		if (usage.percent >= 85) {
			if (!warnedHighContext && ctx.hasUI) {
				ctx.ui.notify("Context usage is high. Run `/context compact` to trim stale turns while keeping workflow state.", "warning");
			}
			warnedHighContext = true;
			return;
		}

		if (usage.percent < 70) warnedHighContext = false;
	}

	function maybeWarnAboutSensitiveMemory(ctx: ExtensionContext): void {
		if (!memoryEnabled || warnedSensitiveMemory) return;
		const memory = readTextFile(getProjectMemoryPath(ctx.cwd))?.trim();
		if (!memory) return;
		const labels = getSensitiveMemoryLabels(memory);
		if (labels.length === 0) return;
		warnedSensitiveMemory = true;
		ctx.ui.notify(`Project memory looks sensitive and will be withheld from prompts. Triggers: ${labels.join(", ")}`, "warning");
	}

	async function setMemoryEnabled(nextEnabled: boolean, ctx: ExtensionContext, persist = true): Promise<void> {
		memoryEnabled = nextEnabled;
		warnedSensitiveMemory = false;
		clearPromptState();
		updateStatus(ctx);
		maybeWarnAboutSensitiveMemory(ctx);
		if (persist) {
			pi.appendEntry(MEMORY_STATE_TYPE, { enabled: nextEnabled });
		}
	}

	async function setWorktreeState(nextState: WorktreeState, ctx: ExtensionContext, persist = true): Promise<void> {
		worktreeState = nextState;
		clearPromptState();
		updateStatus(ctx);
		if (persist) {
			pi.appendEntry(WORKTREE_STATE_TYPE, nextState);
		}
	}

	function getMemoryPromptSection(ctx: ExtensionContext): string {
		const memoryText = readTextFile(getProjectMemoryPath(ctx.cwd))?.trim() ?? "";
		const signature = JSON.stringify({
			memoryEnabled,
			hash: memoryText ? hashText(memoryText) : "",
		});
		return sectionCache.get("project-memory", signature, () => buildMemoryPromptSection(ctx.cwd, memoryEnabled));
	}

	function getWorktreePromptSection(ctx: ExtensionContext): string {
		const signature = JSON.stringify(worktreeState);
		return sectionCache.get("worktree", signature, () => buildWorktreePromptSection(ctx.cwd, worktreeState));
	}

	function showContextStatus(ctx: ExtensionContext): void {
		const usage = ctx.getContextUsage();
		const usageLabel =
			!usage || usage.percent === null || usage.tokens === null
				? "unknown"
				: `${Math.round(usage.percent)}% (${usage.tokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens)`;
		const worktreeLabel =
			worktreeState.enabled && worktreeState.path
				? `${worktreeState.name ?? "active"} at ${getRelativeDisplayPath(ctx.cwd, worktreeState.path)}`
				: "off";
		ctx.ui.notify(
			`Context: ${usageLabel} | Host: ${getHostPlatformLabel()} | Prompt cache sections: ${sectionCache.size()} | Memory: ${memoryEnabled ? "on" : "off"} | Worktree: ${worktreeLabel} | Large-output threshold: ${formatSize(LARGE_OUTPUT_THRESHOLD_BYTES)}`,
			"info",
		);
	}

	function triggerCompaction(ctx: ExtensionContext, extraInstructions?: string): void {
		const customInstructions = buildCompactionInstructions(ctx.cwd, memoryEnabled, worktreeState, extraInstructions);
		ctx.ui.notify("Compaction started", "info");
		ctx.compact({
			customInstructions,
			onComplete: () => {
				warnedHighContext = false;
				updateStatus(ctx);
				ctx.ui.notify("Compaction completed", "success");
			},
			onError: (error) => {
				ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
			},
		});
	}

	async function handleContextCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const tokens = args.trim().split(/\s+/).filter(Boolean);
		const action = tokens[0]?.toLowerCase() ?? "status";
		const extraInstructions = tokens.slice(1).join(" ");

		if (action === "status") {
			showContextStatus(ctx);
			return;
		}

		if (action === "refresh") {
			clearPromptState();
			warnedSensitiveMemory = false;
			updateStatus(ctx);
			maybeWarnAboutSensitiveMemory(ctx);
			ctx.ui.notify("Runtime prompt cache cleared. Use `/lang refresh` if project detection also needs a rescan.", "info");
			return;
		}

		if (action === "compact") {
			triggerCompaction(ctx, extraInstructions || undefined);
			return;
		}

		ctx.ui.notify(`Unknown /context action "${action}". Try: ${CONTEXT_COMMANDS.join(", ")}`, "error");
	}

	function renderMemorySummary(cwd: string, content: string): string {
		return [
			"# Project Memory",
			"",
			`- Path: \`${getRelativeDisplayPath(cwd, getProjectMemoryPath(cwd))}\``,
			`- Enabled for prompts: \`${memoryEnabled}\``,
			"",
			content.trim(),
		].join("\n");
	}

	async function handleMemoryCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const action = args.trim().toLowerCase() || "status";
		const memoryPath = getProjectMemoryPath(ctx.cwd);
		const current = readTextFile(memoryPath)?.trim() ?? "";

		if (action === "status") {
			const labels = current ? getSensitiveMemoryLabels(current) : [];
			const suffix = labels.length > 0 ? ` (withheld: ${labels.join(", ")})` : "";
			ctx.ui.notify(
				`Project memory: ${current ? getRelativeDisplayPath(ctx.cwd, memoryPath) : "not created"} | prompts: ${memoryEnabled ? "on" : "off"}${suffix}`,
				"info",
			);
			return;
		}

		if (action === "path") {
			ctx.ui.notify(getRelativeDisplayPath(ctx.cwd, memoryPath), "info");
			return;
		}

		if (action === "show") {
			if (!current) {
				ctx.ui.notify("Project memory is empty", "info");
				return;
			}

			pi.sendMessage(
				{
					customType: "pi-memory",
					content: renderMemorySummary(ctx.cwd, current),
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		if (action === "on") {
			await setMemoryEnabled(true, ctx);
			ctx.ui.notify("Project memory enabled for prompts", "info");
			return;
		}

		if (action === "off") {
			await setMemoryEnabled(false, ctx);
			ctx.ui.notify("Project memory disabled for this session", "info");
			return;
		}

		if (action === "edit") {
			if (!ctx.hasUI) {
				ctx.ui.notify("Memory editing requires interactive mode", "error");
				return;
			}

			const edited = await ctx.ui.editor("Edit project memory", current || MEMORY_TEMPLATE);
			if (edited === undefined) return;

			const nextContent = edited.trim();
			const labels = getSensitiveMemoryLabels(nextContent);
			if (labels.length > 0) {
				ctx.ui.notify(`Blocked memory update because it looks sensitive. Triggers: ${labels.join(", ")}`, "error");
				return;
			}

			await mkdir(join(ctx.cwd, MEMORY_DIRECTORY), { recursive: true });
			await withFileMutationQueue(memoryPath, async () => {
				await writeFile(memoryPath, `${nextContent}\n`, "utf-8");
			});
			clearPromptState();
			warnedSensitiveMemory = false;
			updateStatus(ctx);
			ctx.ui.notify(`Project memory saved to ${getRelativeDisplayPath(ctx.cwd, memoryPath)}`, "success");
			return;
		}

		ctx.ui.notify(`Unknown /memory action "${action}". Try: ${MEMORY_COMMANDS.join(", ")}`, "error");
	}

	async function handleWorktreeCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const tokens = args.trim().split(/\s+/).filter(Boolean);
		const action = tokens[0]?.toLowerCase() ?? "status";
		const repoRoot = findGitRepoRoot(ctx.cwd);

		if (action === "status") {
			if (worktreeState.enabled && worktreeState.path) {
				ctx.ui.notify(
					`Worktree mode: ${worktreeState.name ?? "active"} at ${getRelativeDisplayPath(ctx.cwd, worktreeState.path)}`,
					"info",
				);
			} else {
				ctx.ui.notify("Worktree mode is off; tools are using the main checkout.", "info");
			}
			return;
		}

		if (action === "path") {
			ctx.ui.notify(getRelativeDisplayPath(ctx.cwd, getActiveToolCwd(ctx)), "info");
			return;
		}

		if (action === "off") {
			await setWorktreeState({ enabled: false }, ctx);
			ctx.ui.notify("Worktree mode disabled; tools are back on the main checkout.", "info");
			return;
		}

		if (action !== "list" && action !== "create" && action !== "use") {
			ctx.ui.notify(`Unknown /worktree action "${action}". Try: ${WORKTREE_COMMANDS.join(", ")}`, "error");
			return;
		}

		if (!repoRoot) {
			ctx.ui.notify("Git worktrees are only available inside a git repository.", "error");
			return;
		}

		if (action === "list") {
			const worktrees = listManagedWorktrees(repoRoot);
			if (worktrees.length === 0) {
				ctx.ui.notify("No managed Pi worktrees exist for this repository yet.", "info");
				return;
			}

			const lines = worktrees.map((entry) => {
				const active = worktreeState.enabled && worktreeState.name === entry.name ? " (active)" : "";
				return `${entry.name}: ${getRelativeDisplayPath(ctx.cwd, resolveExecutionPath(repoRoot, ctx.cwd, entry.rootPath))}${active}`;
			});
			ctx.ui.notify(lines.join("\n"), "info");
			return;
		}

		const name = tokens[1] ?? "";
		const validationError = validateWorktreeName(name);
		if (validationError) {
			ctx.ui.notify(validationError, "error");
			return;
		}

		if (action === "create") {
			const result = createOrReuseManagedWorktree(repoRoot, ctx.cwd, name);
			if (result.error) {
				ctx.ui.notify(result.error, "error");
				return;
			}

			await setWorktreeState(
				{
					enabled: true,
					name,
					path: result.path,
					rootPath: result.rootPath,
				},
				ctx,
			);
			ctx.ui.notify(
				result.created
					? `Created and activated worktree ${name} at ${getRelativeDisplayPath(ctx.cwd, result.path)}`
					: `Reusing and activating worktree ${name} at ${getRelativeDisplayPath(ctx.cwd, result.path)}`,
				"success",
			);
			return;
		}

		if (action === "use") {
			const existing = listManagedWorktrees(repoRoot).find((entry) => entry.name === name);
			if (!existing) {
				ctx.ui.notify(`Worktree "${name}" does not exist yet. Create it with /worktree create ${name}`, "error");
				return;
			}

			await setWorktreeState(
				{
					enabled: true,
					name: existing.name,
					path: resolveExecutionPath(repoRoot, ctx.cwd, existing.rootPath),
					rootPath: existing.rootPath,
				},
				ctx,
			);
			ctx.ui.notify(`Activated worktree ${name}`, "success");
			return;
		}

	}

	function getContextCommandCompletions(prefix: string) {
		return CONTEXT_COMMANDS.filter((command) => command.startsWith(prefix)).map((command) => ({
			value: command,
			label: command,
		}));
	}

	function getMemoryCommandCompletions(prefix: string) {
		return MEMORY_COMMANDS.filter((command) => command.startsWith(prefix)).map((command) => ({
			value: command,
			label: command,
		}));
	}

	function getWorktreeCommandCompletions(prefix: string) {
		const tokens = prefix.trim().split(/\s+/).filter(Boolean);
		if (tokens.length <= 1) {
			return WORKTREE_COMMANDS.filter((command) => command.startsWith(tokens[0] ?? "")).map((command) => ({
				value: command,
				label: command,
			}));
		}

		return null;
	}

	async function persistLargeBashOutput(ctx: ExtensionContext, toolCallId: string, text: string, fullOutputPath?: string): Promise<string | undefined> {
		const artifactDir = join(ctx.sessionManager.getSessionDir(), "artifacts");
		const artifactPath = join(artifactDir, `bash-${toolCallId}.txt`);

		try {
			await mkdir(artifactDir, { recursive: true });
			await withFileMutationQueue(artifactPath, async () => {
				if (fullOutputPath && existsSync(fullOutputPath)) {
					await copyFile(fullOutputPath, artifactPath);
					return;
				}

				await writeFile(artifactPath, text, "utf-8");
			});
			return artifactPath;
		} catch (error) {
			ctx.ui.notify(`Failed to persist large bash output: ${String(error)}`, "warning");
			return undefined;
		}
	}

	pi.registerCommand("context", {
		description: "Inspect context usage, clear prompt cache, or compact the session",
		getArgumentCompletions: (prefix) => getContextCommandCompletions(prefix),
		handler: async (args, ctx) => {
			await handleContextCommand(args, ctx);
		},
	});

	pi.registerCommand("memory", {
		description: "Inspect, edit, or disable durable project memory",
		getArgumentCompletions: (prefix) => getMemoryCommandCompletions(prefix),
		handler: async (args, ctx) => {
			await handleMemoryCommand(args, ctx);
		},
	});

	pi.registerCommand("worktree", {
		description: "Create, enable, or disable isolated git worktrees for risky execution",
		getArgumentCompletions: (prefix) => getWorktreeCommandCompletions(prefix),
		handler: async (args, ctx) => {
			await handleWorktreeCommand(args, ctx);
		},
	});

	pi.registerTool({
		name: "read",
		label: "read",
		description: bootstrapTools.read.description,
		parameters: bootstrapTools.read.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(getActiveToolCwd(ctx)).read.execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		name: "bash",
		label: "bash",
		description: bootstrapTools.bash.description,
		parameters: bootstrapTools.bash.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(getActiveToolCwd(ctx)).bash.execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		name: "edit",
		label: "edit",
		description: bootstrapTools.edit.description,
		parameters: bootstrapTools.edit.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(getActiveToolCwd(ctx)).edit.execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		name: "write",
		label: "write",
		description: bootstrapTools.write.description,
		parameters: bootstrapTools.write.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(getActiveToolCwd(ctx)).write.execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		name: "grep",
		label: "grep",
		description: bootstrapTools.grep.description,
		parameters: bootstrapTools.grep.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(getActiveToolCwd(ctx)).grep.execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		name: "find",
		label: "find",
		description: bootstrapTools.find.description,
		parameters: bootstrapTools.find.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(getActiveToolCwd(ctx)).find.execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		name: "ls",
		label: "ls",
		description: bootstrapTools.ls.description,
		parameters: bootstrapTools.ls.parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getBuiltInTools(getActiveToolCwd(ctx)).ls.execute(toolCallId, params, signal, onUpdate);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		memoryEnabled = getLatestCustomEntryData<MemoryState>(ctx, MEMORY_STATE_TYPE)?.enabled ?? true;
		worktreeState = getLatestCustomEntryData<WorktreeState>(ctx, WORKTREE_STATE_TYPE) ?? { enabled: false };
		clearPromptState();
		warnedHighContext = false;
		warnedSensitiveMemory = false;

		if (worktreeState.enabled && worktreeState.path && !existsSync(worktreeState.path)) {
			worktreeState = { enabled: false };
			pi.appendEntry(WORKTREE_STATE_TYPE, worktreeState);
			ctx.ui.notify("Saved worktree path no longer exists. Falling back to the main checkout.", "warning");
		}

		updateStatus(ctx);
		maybeWarnAboutSensitiveMemory(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		updateStatus(ctx);
		maybeWarnAboutSensitiveMemory(ctx);

		const sections = [buildPlatformPromptSection(), getWorktreePromptSection(ctx), getMemoryPromptSection(ctx)].filter(
			(section) => section.trim().length > 0,
		);
		if (sections.length === 0) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${sections.join("\n\n")}`,
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash") return;

		const text = getTextContent(event.content);
		const fullOutputPath = event.details && typeof event.details === "object" && "fullOutputPath" in event.details
			? (event.details as { fullOutputPath?: string }).fullOutputPath
			: undefined;

		let shouldPersist = false;
		if (fullOutputPath && existsSync(fullOutputPath)) {
			shouldPersist = true;
		} else if (Buffer.byteLength(text, "utf-8") > LARGE_OUTPUT_THRESHOLD_BYTES) {
			shouldPersist = true;
		}

		if (!shouldPersist) return;

		const artifactPath = await persistLargeBashOutput(ctx, event.toolCallId, text, fullOutputPath);
		if (!artifactPath) return;

		let artifactSizeLabel = "";
		try {
			const stats = await stat(artifactPath);
			artifactSizeLabel = formatSize(stats.size);
		} catch {
			artifactSizeLabel = "";
		}

		const preview = truncateHead(text, {
			maxLines: LARGE_OUTPUT_PREVIEW_LINES,
			maxBytes: LARGE_OUTPUT_PREVIEW_BYTES,
		});
		const lines = [`[Large bash output persisted to ${artifactPath}${artifactSizeLabel ? ` (${artifactSizeLabel})` : ""}. Use read on that file for the full log.]`];

		if (preview.content.trim().length > 0) {
			lines.push("", preview.content.trim());
		} else {
			lines.push("", "[No inline preview was available for this command output.]");
		}

		if (preview.truncated) {
			lines.push(
				"",
				`[Preview truncated: showing ${preview.outputLines} of ${preview.totalLines} lines (${formatSize(preview.outputBytes)} of ${formatSize(preview.totalBytes)}).]`,
			);
		}

		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details:
				event.details && typeof event.details === "object"
					? { ...(event.details as Record<string, unknown>), persistedOutputPath: artifactPath }
					: { persistedOutputPath: artifactPath },
		};
	});

	pi.on("turn_end", async (_event, ctx) => {
		updateStatus(ctx);
		maybeWarnAboutContext(ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		warnedHighContext = false;
		updateStatus(ctx);
	});
}
