import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
	keyHint,
	withFileMutationQueue,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

type PermissionMode = "read-only" | "edit-allowed" | "review-runner";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type AgentScope = "global" | "project" | "both";
type AgentSource = "global" | "project";
type RunStatus = "queued" | "running" | "done" | "failed" | "blocked" | "canceled";

type ProfileDefinition = {
	description?: string;
	permissionMode: PermissionMode;
	tools?: string[];
	instructions?: string;
};

type ProfilesFile = {
	defaultProfile?: string;
	profiles?: Record<string, ProfileDefinition>;
};

type ModelRouteConfig = string | { ref?: string; provider?: string; model?: string; thinkingLevel?: ThinkingLevel };

type ModelsFile = {
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevel;
	routing?: Record<string, ModelRouteConfig>;
};

type SwarmAgentModelConfig = string | { route?: string; ref?: string; provider?: string; model?: string; thinkingLevel?: ThinkingLevel };

type SwarmAgentDefinition = {
	description?: string;
	profile?: string;
	tools?: string[];
	safetyMode?: PermissionMode;
	model?: SwarmAgentModelConfig;
	instructions?: string;
};

type SwarmAgentsFile = {
	defaultScope?: AgentScope;
	agents?: Record<string, SwarmAgentDefinition>;
};

type LoadedProfiles = {
	defaultProfile: string;
	profiles: Record<string, ProfileDefinition>;
};

type LoadedModels = {
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevel;
	routing: Record<string, ModelRouteConfig>;
};

type ModelRoute = {
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
};

type LoadedSwarmAgent = {
	name: string;
	description: string;
	profile?: string;
	tools: string[];
	safetyMode: PermissionMode;
	instructions: string;
	model: {
		route?: string;
		ref?: string;
		provider?: string;
		model?: string;
		thinkingLevel?: ThinkingLevel;
	};
	source: AgentSource;
	sourcePath: string;
};

type LoadedSwarmCatalog = {
	defaultScope: AgentScope;
	agents: Record<string, LoadedSwarmAgent>;
	globalPath: string;
	projectPath?: string;
};

type UsageStats = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
};

type WorkerResult = {
	agent: string;
	agentSource: AgentSource;
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
};

type SwarmRunTaskRecord = {
	agent: string;
	agentSource: AgentSource;
	task: string;
	cwd: string;
	profile?: string;
	safetyMode: PermissionMode;
	state: RunStatus;
	startedAt?: string;
	finishedAt?: string;
	summary?: string;
	output?: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	stderr?: string;
	messages: Message[];
};

type SwarmRunRecord = {
	id: string;
	mode: "single";
	status: RunStatus;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	finishedAt?: string;
	agentScope: AgentScope;
	source: "tool" | "command";
	runFile: string;
	projectAgentsPath?: string;
	trustProjectAgents: boolean;
	error?: string;
	recentActivity: string[];
	task: SwarmRunTaskRecord;
};

type SwarmToolDetails = {
	run: SwarmRunRecord;
	catalog: {
		globalPath: string;
		projectPath?: string;
	};
};

type ActiveRunState = {
	controller: AbortController;
	record: SwarmRunRecord;
	childPid?: number;
};

type RunRequest = {
	agent: string;
	task: string;
	cwd?: string;
	agentScope?: AgentScope;
	trustProjectAgents?: boolean;
	source: "tool" | "command";
};

type RunOutcome = {
	record: SwarmRunRecord;
	catalog: LoadedSwarmCatalog;
	isError: boolean;
};

const PROFILE_STATE_TYPE = "pi-profile-state";
const SWARM_RUN_ENTRY_TYPE = "pi-swarm-run";
const SWARM_STATUS_KEY = "pi-swarm";
const SWARM_WIDGET_KEY = "pi-swarm-runs";
const RUNS_DIRECTORY = join("swarm", "runs");
const PLAN_PATH = join(".pi", "plans", "active-plan.md");
const GLOBAL_PROFILES_PATH = fileURLToPath(new URL("../profiles.json", import.meta.url));
const GLOBAL_MODELS_PATH = fileURLToPath(new URL("../models.json", import.meta.url));
const GLOBAL_SWARM_AGENTS_PATH = fileURLToPath(new URL("../swarm-agents.json", import.meta.url));
const DEFAULT_READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];
const DEFAULT_EDIT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const SWARM_COMMANDS = ["help", "agents", "status", "runs", "inspect", "abort", "run"];
const PERMISSION_RANK: Record<PermissionMode, number> = {
	"read-only": 0,
	"review-runner": 1,
	"edit-allowed": 2,
};

const AgentScopeSchema = StringEnum(["global", "project", "both"] as const, {
	description: 'Where to load swarm agents from. Default: "global". Use "both" to include project-local agents.',
	default: "global",
});

const SwarmParams = Type.Object({
	agent: Type.String({ description: "Name of the swarm agent to invoke" }),
	task: Type.String({ description: "Bounded task to delegate to the worker" }),
	agentScope: Type.Optional(AgentScopeSchema),
	cwd: Type.Optional(Type.String({ description: "Working directory for the worker process" })),
	trustProjectAgents: Type.Optional(
		Type.Boolean({
			description: "Allow running project-local swarm agents without an interactive confirmation prompt. Default: false.",
			default: false,
		}),
	),
});

function readJsonFile<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;

	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch (error) {
		console.error(`Failed to read ${path}: ${String(error)}`);
		return undefined;
	}
}

function normalizeThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
	if (!value) return undefined;
	return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(value) ? (value as ThinkingLevel) : undefined;
}

function parseModelRef(ref: string | undefined): { provider?: string; model?: string } {
	if (!ref) return {};

	const slashIndex = ref.indexOf("/");
	if (slashIndex === -1) return { model: ref };

	return {
		provider: ref.slice(0, slashIndex).trim() || undefined,
		model: ref.slice(slashIndex + 1).trim() || undefined,
	};
}

function normalizeModelRouteConfig(config: ModelRouteConfig | undefined): ModelRoute {
	if (!config) return {};
	if (typeof config === "string") {
		const parsed = parseModelRef(config);
		return {
			provider: parsed.provider,
			model: parsed.model,
		};
	}

	const parsed = parseModelRef(config.ref);
	return {
		provider: config.provider ?? parsed.provider,
		model: config.model ?? parsed.model,
		thinkingLevel: normalizeThinkingLevel(config.thinkingLevel),
	};
}

function normalizeSwarmModelConfig(config: SwarmAgentModelConfig | undefined): LoadedSwarmAgent["model"] {
	if (!config) return {};
	if (typeof config === "string") {
		const parsed = parseModelRef(config);
		return {
			ref: config,
			provider: parsed.provider,
			model: parsed.model,
		};
	}

	const parsed = parseModelRef(config.ref);
	return {
		route: config.route,
		ref: config.ref,
		provider: config.provider ?? parsed.provider,
		model: config.model ?? parsed.model,
		thinkingLevel: normalizeThinkingLevel(config.thinkingLevel),
	};
}

function getLatestCustomEntryData<T>(ctx: ExtensionContext, customType: string): T | undefined {
	const entry = ctx.sessionManager
		.getEntries()
		.filter((item: { type: string; customType?: string }) => item.type === "custom" && item.customType === customType)
		.pop() as { data?: T } | undefined;
	return entry?.data;
}

function getProjectProfilesPath(cwd: string): string {
	return join(cwd, ".pi", "profiles.json");
}

function getProjectModelsPath(cwd: string): string {
	return join(cwd, ".pi", "models.json");
}

function getProjectSwarmAgentsPath(cwd: string): string {
	return join(cwd, ".pi", "swarm-agents.json");
}

function loadProfiles(cwd: string): LoadedProfiles {
	const globalProfiles = readJsonFile<ProfilesFile>(GLOBAL_PROFILES_PATH) ?? {};
	const projectProfiles = readJsonFile<ProfilesFile>(getProjectProfilesPath(cwd)) ?? {};
	const profiles = {
		...(globalProfiles.profiles ?? {}),
		...(projectProfiles.profiles ?? {}),
	};
	const defaultProfile =
		projectProfiles.defaultProfile ??
		globalProfiles.defaultProfile ??
		(profiles.builder ? "builder" : Object.keys(profiles)[0] ?? "builder");

	return {
		defaultProfile,
		profiles,
	};
}

function loadModels(cwd: string): LoadedModels {
	const globalModels = readJsonFile<ModelsFile>(GLOBAL_MODELS_PATH) ?? {};
	const projectModels = readJsonFile<ModelsFile>(getProjectModelsPath(cwd)) ?? {};

	return {
		defaultModel: projectModels.defaultModel ?? globalModels.defaultModel,
		defaultThinkingLevel:
			normalizeThinkingLevel(projectModels.defaultThinkingLevel) ??
			normalizeThinkingLevel(globalModels.defaultThinkingLevel),
		routing: {
			...(globalModels.routing ?? {}),
			...(projectModels.routing ?? {}),
		},
	};
}

function loadSwarmCatalog(cwd: string, requestedScope: AgentScope | undefined): LoadedSwarmCatalog {
	const profiles = loadProfiles(cwd);
	const globalCatalog = readJsonFile<SwarmAgentsFile>(GLOBAL_SWARM_AGENTS_PATH) ?? {};
	const projectPath = getProjectSwarmAgentsPath(cwd);
	const projectCatalog = readJsonFile<SwarmAgentsFile>(projectPath) ?? {};
	const defaultScope = requestedScope ?? projectCatalog.defaultScope ?? globalCatalog.defaultScope ?? "global";

	const normalizeAgent = (
		name: string,
		definition: SwarmAgentDefinition,
		source: AgentSource,
		sourcePath: string,
	): LoadedSwarmAgent => {
		const profile = definition.profile ? profiles.profiles[definition.profile] : undefined;
		const model = normalizeSwarmModelConfig(definition.model);
		const tools =
			definition.tools ??
			profile?.tools ??
			(definition.safetyMode === "edit-allowed" ? DEFAULT_EDIT_TOOLS : DEFAULT_READ_ONLY_TOOLS);

		return {
			name,
			description: definition.description ?? profile?.description ?? `${name} swarm worker`,
			profile: definition.profile,
			tools: tools.filter((tool) => tool !== "swarm"),
			safetyMode: definition.safetyMode ?? profile?.permissionMode ?? "read-only",
			instructions: definition.instructions ?? profile?.instructions ?? "",
			model: model.route || model.ref || model.provider || model.model || model.thinkingLevel ? model : {},
			source,
			sourcePath,
		};
	};

	const globalAgents =
		defaultScope === "project"
			? {}
			: Object.fromEntries(
					Object.entries(globalCatalog.agents ?? {}).map(([name, definition]) => [
						name,
						normalizeAgent(name, definition, "global", GLOBAL_SWARM_AGENTS_PATH),
					]),
				);

	const projectAgents =
		defaultScope === "global"
			? {}
			: Object.fromEntries(
					Object.entries(projectCatalog.agents ?? {}).map(([name, definition]) => [
						name,
						normalizeAgent(name, definition, "project", projectPath),
					]),
				);

	return {
		defaultScope,
		agents: {
			...globalAgents,
			...projectAgents,
		},
		globalPath: GLOBAL_SWARM_AGENTS_PATH,
		projectPath: existsSync(projectPath) ? projectPath : undefined,
	};
}

function resolveModelRoute(agent: LoadedSwarmAgent, loadedModels: LoadedModels): ModelRoute {
	const requested = agent.model;
	const routed = normalizeModelRouteConfig(
		requested.route ? loadedModels.routing[requested.route] : agent.profile ? loadedModels.routing[agent.profile] : undefined,
	);
	const direct = normalizeModelRouteConfig(
		requested.ref || requested.provider || requested.model || requested.thinkingLevel
			? {
					ref: requested.ref,
					provider: requested.provider,
					model: requested.model,
					thinkingLevel: requested.thinkingLevel,
				}
			: undefined,
	);
	const fallback = normalizeModelRouteConfig(
		loadedModels.defaultModel || loadedModels.defaultThinkingLevel
			? {
					ref: loadedModels.defaultModel,
					thinkingLevel: loadedModels.defaultThinkingLevel,
				}
			: undefined,
	);

	return {
		provider: direct.provider ?? routed.provider ?? fallback.provider,
		model: direct.model ?? routed.model ?? fallback.model,
		thinkingLevel: direct.thinkingLevel ?? routed.thinkingLevel ?? fallback.thinkingLevel,
	};
}

function getPermissionContext(ctx: ExtensionContext): { profileName: string; mode: PermissionMode } {
	const profiles = loadProfiles(ctx.cwd);
	const storedProfile = getLatestCustomEntryData<{ name?: string }>(ctx, PROFILE_STATE_TYPE)?.name;
	const profileName = storedProfile && profiles.profiles[storedProfile] ? storedProfile : profiles.defaultProfile;
	const profile = profiles.profiles[profileName];
	const planStatus = readPlanStatus(ctx.cwd);

	if (!profile) {
		return {
			profileName,
			mode: "edit-allowed",
		};
	}

	if (profileName === "builder" && planStatus !== "approved") {
		return {
			profileName,
			mode: "read-only",
		};
	}

	return {
		profileName,
		mode: profile.permissionMode,
	};
}

function readPlanStatus(cwd: string): "draft" | "approved" | undefined {
	const path = join(cwd, PLAN_PATH);
	if (!existsSync(path)) return undefined;

	try {
		const raw = readFileSync(path, "utf-8");
		const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
		if (!match) return "draft";

		const statusLine = match[1]
			.split("\n")
			.find((line) => line.trim().toLowerCase().startsWith("status:"));
		if (!statusLine) return "draft";
		return statusLine.split(":").slice(1).join(":").trim() === "approved" ? "approved" : "draft";
	} catch (error) {
		console.error(`Failed to read plan status from ${path}: ${String(error)}`);
		return undefined;
	}
}

function canDelegate(current: PermissionMode, target: PermissionMode): boolean {
	return PERMISSION_RANK[current] >= PERMISSION_RANK[target];
}

function createUsageStats(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

function now(): string {
	return new Date().toISOString();
}

function createRunId(): string {
	const timestamp = now().replace(/[-:.TZ]/g, "").slice(0, 14);
	return `sw-${timestamp}-${randomBytes(3).toString("hex")}`;
}

function getRunDirectory(ctx: ExtensionContext): string {
	return join(ctx.sessionManager.getSessionDir(), RUNS_DIRECTORY);
}

function getRunPath(ctx: ExtensionContext, runId: string): string {
	return join(getRunDirectory(ctx), `${runId}.json`);
}

function cloneRecord(record: SwarmRunRecord): SwarmRunRecord {
	return JSON.parse(JSON.stringify(record)) as SwarmRunRecord;
}

async function persistRunRecord(record: SwarmRunRecord): Promise<void> {
	await mkdir(dirname(record.runFile), { recursive: true });
	await withFileMutationQueue(record.runFile, async () => {
		await writeFile(record.runFile, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
	});
}

async function loadRunRecord(path: string): Promise<SwarmRunRecord | undefined> {
	if (!existsSync(path)) return undefined;

	try {
		const raw = await readFile(path, "utf-8");
		return JSON.parse(raw) as SwarmRunRecord;
	} catch (error) {
		console.error(`Failed to load swarm run record ${path}: ${String(error)}`);
		return undefined;
	}
}

async function loadRunRecords(ctx: ExtensionContext): Promise<SwarmRunRecord[]> {
	const directory = getRunDirectory(ctx);
	if (!existsSync(directory)) return [];

	const entries = readdirSync(directory)
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => join(directory, entry));

	const records = await Promise.all(entries.map((entry) => loadRunRecord(entry)));
	return records
		.filter((record): record is SwarmRunRecord => Boolean(record))
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function getRelativePath(cwd: string, path: string): string {
	const rel = relative(cwd, path);
	if (!rel || rel.length === 0) return ".";
	return rel.startsWith("..") ? shortenPath(path) : rel;
}

function summarizeText(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const firstLine = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	if (!firstLine) return undefined;
	return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(usage: UsageStats, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function getStatusLabel(status: RunStatus): string {
	switch (status) {
		case "queued":
			return "queued";
		case "running":
			return "running";
		case "done":
			return "done";
		case "failed":
			return "failed";
		case "blocked":
			return "blocked";
		case "canceled":
			return "canceled";
	}
}

function pushRecentActivity(record: SwarmRunRecord, line: string): void {
	const next = line.trim();
	if (!next) return;
	record.recentActivity = [...record.recentActivity.slice(-11), next];
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text" && part.text.trim()) return part.text.trim();
		}
	}
	return "";
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") items.push({ type: "text", text: part.text });
			if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
		}
	}
	return items;
}

function formatToolCall(toolName: string, args: Record<string, unknown>, fg: (color: any, text: string) => string): string {
	switch (toolName) {
		case "bash": {
			const command = typeof args.command === "string" ? args.command : "...";
			const preview = command.length > 72 ? `${command.slice(0, 72)}...` : command;
			return fg("muted", "$ ") + fg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (typeof args.file_path === "string" ? args.file_path : args.path) as string | undefined;
			return fg("muted", "read ") + fg("accent", rawPath ? shortenPath(rawPath) : "...");
		}
		case "edit":
		case "write": {
			const rawPath = (typeof args.file_path === "string" ? args.file_path : args.path) as string | undefined;
			return fg("muted", `${toolName} `) + fg("accent", rawPath ? shortenPath(rawPath) : "...");
		}
		case "grep": {
			const pattern = typeof args.pattern === "string" ? args.pattern : "...";
			return fg("muted", "grep ") + fg("accent", `/${pattern}/`);
		}
		case "find": {
			const pattern = typeof args.pattern === "string" ? args.pattern : "*";
			return fg("muted", "find ") + fg("accent", pattern);
		}
		case "ls": {
			const path = typeof args.path === "string" ? args.path : ".";
			return fg("muted", "ls ") + fg("accent", shortenPath(path));
		}
		default: {
			const preview = JSON.stringify(args);
			return fg("accent", toolName) + fg("dim", ` ${preview.length > 56 ? `${preview.slice(0, 56)}...` : preview}`);
		}
	}
}

async function writePromptFile(runId: string, prompt: string): Promise<string> {
	const directory = join(tmpdir(), "pi-swarm");
	mkdirSync(directory, { recursive: true });
	const filePath = join(directory, `${runId}.md`);
	await withFileMutationQueue(filePath, async () => {
		await writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return filePath;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

function buildWorkerSystemPrompt(agent: LoadedSwarmAgent): string {
	const lines = [
		`You are the delegated swarm worker "${agent.name}".`,
		`Role: ${agent.description}`,
		`Safety mode: ${agent.safetyMode}`,
		"",
		"Worker rules:",
		"- Stay inside the delegated task and do not expand scope on your own",
		"- Prefer concise evidence and file references over long dumps",
		"- Do not assume the parent agent can see your intermediate tool chatter unless you include it in the final answer",
	];

	if (agent.instructions.trim()) {
		lines.push("", agent.instructions.trim());
	}

	return lines.join("\n");
}

function buildWorkerPrompt(runId: string, agent: LoadedSwarmAgent, task: string, cwd: string): string {
	return [
		`Swarm run id: ${runId}`,
		`Agent: ${agent.name}`,
		`Working directory: ${cwd}`,
		"",
		"Delegated task:",
		task.trim(),
		"",
		"Final answer requirements:",
		"- Keep the response structured and concise",
		"- Include the most important evidence, files, or commands used",
		"- If blocked, explain the blocker clearly",
	].join("\n");
}

function formatNotifySummary(ctx: ExtensionContext, record: SwarmRunRecord): string {
	const summary = record.task.summary ?? record.error ?? "(no summary)";
	return [
		`Swarm ${record.id}`,
		`${record.task.agent} (${record.task.agentSource}) -> ${getStatusLabel(record.status)}`,
		`Task: ${record.task.task}`,
		`Summary: ${summary}`,
		`Run record: ${getRelativePath(ctx.cwd, record.runFile)}`,
	].join("\n");
}

function buildRunsSummary(ctx: ExtensionContext, records: SwarmRunRecord[]): string {
	if (records.length === 0) {
		return `No swarm runs found in ${shortenPath(getRunDirectory(ctx))}`;
	}

	return records
		.slice(0, 20)
		.map((record) => {
			const summary = record.task.summary ?? record.error ?? "(no summary)";
			return `${record.id} | ${getStatusLabel(record.status)} | ${record.task.agent} (${record.task.agentSource}) | ${summary}`;
		})
		.join("\n");
}

function buildInspectSummary(ctx: ExtensionContext, record: SwarmRunRecord): string {
	const usage = formatUsageStats(record.task.usage, record.task.model);
	const lines = [
		`Run: ${record.id}`,
		`Status: ${getStatusLabel(record.status)}`,
		`Mode: ${record.mode}`,
		`Agent: ${record.task.agent} (${record.task.agentSource})`,
		`Profile: ${record.task.profile ?? "(none)"}`,
		`Safety: ${record.task.safetyMode}`,
		`Scope: ${record.agentScope}`,
		`Working directory: ${record.task.cwd}`,
		`Run record: ${shortenPath(record.runFile)}`,
		"",
		"Task:",
		record.task.task,
	];

	if (record.task.summary) {
		lines.push("", "Summary:", record.task.summary);
	}

	if (record.task.output) {
		lines.push("", "Output:", record.task.output);
	}

	if (record.error) {
		lines.push("", "Error:", record.error);
	}

	if (record.recentActivity.length > 0) {
		lines.push("", "Recent activity:");
		for (const line of record.recentActivity) lines.push(`- ${line}`);
	}

	if (usage) {
		lines.push("", `Usage: ${usage}`);
	}

	return lines.join("\n");
}

async function emitRunEntry(pi: ExtensionAPI, record: SwarmRunRecord): Promise<void> {
	pi.appendEntry(SWARM_RUN_ENTRY_TYPE, {
		runId: record.id,
		status: record.status,
		agent: record.task.agent,
		agentSource: record.task.agentSource,
		task: record.task.task,
		summary: record.task.summary,
		runFile: record.runFile,
		updatedAt: record.updatedAt,
	});
}

function statusIcon(theme: any, status: RunStatus): string {
	switch (status) {
		case "queued":
			return theme.fg("warning", "◷");
		case "running":
			return theme.fg("accent", "▶");
		case "done":
			return theme.fg("success", "✓");
		case "failed":
			return theme.fg("error", "✗");
		case "blocked":
			return theme.fg("warning", "!");
		case "canceled":
			return theme.fg("muted", "■");
	}
}

export default function swarmExtension(pi: ExtensionAPI): void {
	const activeRuns = new Map<string, ActiveRunState>();
	let latestTerminalRun: SwarmRunRecord | undefined;

	const updateUi = (ctx: ExtensionContext): void => {
		const active = Array.from(activeRuns.values())
			.map((entry) => entry.record)
			.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

		if (active.length === 0) {
			if (!latestTerminalRun || latestTerminalRun.status === "done") {
				ctx.ui.setStatus(SWARM_STATUS_KEY, ctx.ui.theme.fg("dim", "swarm:idle"));
			} else {
				const color = latestTerminalRun.status === "failed" ? "error" : "warning";
				ctx.ui.setStatus(SWARM_STATUS_KEY, ctx.ui.theme.fg(color, `swarm:last ${getStatusLabel(latestTerminalRun.status)}`));
			}
			ctx.ui.setWidget(SWARM_WIDGET_KEY, undefined);
			return;
		}

		const running = active.filter((record) => record.status === "running").length;
		const queued = active.filter((record) => record.status === "queued").length;
		const color = active.some((record) => record.status === "failed" || record.status === "blocked") ? "warning" : "accent";
		const parts = [`swarm:${running}/${active.length} running`];
		if (queued > 0) parts.push(`${queued} queued`);
		ctx.ui.setStatus(SWARM_STATUS_KEY, ctx.ui.theme.fg(color, parts.join(" ")));

		const lines = active.slice(0, 5).map((record) => {
			const preview = record.task.task.length > 68 ? `${record.task.task.slice(0, 68)}...` : record.task.task;
			const icon = statusIcon(ctx.ui.theme, record.status);
			const detail = record.task.summary ?? record.recentActivity.at(-1);
			let line =
				`${icon} ` +
				ctx.ui.theme.fg("accent", record.id) +
				ctx.ui.theme.fg("muted", ` ${record.task.agent} (${record.task.agentSource}) `) +
				ctx.ui.theme.fg("dim", preview);
			if (detail) {
				line += `\n  ${ctx.ui.theme.fg("muted", detail.length > 96 ? `${detail.slice(0, 96)}...` : detail)}`;
			}
			return line;
		});

		if (active.length > 5) {
			lines.push(ctx.ui.theme.fg("muted", `... +${active.length - 5} more active swarm runs`));
		}

		ctx.ui.setWidget(SWARM_WIDGET_KEY, lines);
	};

	const finalizeRecord = async (ctx: ExtensionContext, record: SwarmRunRecord): Promise<void> => {
		record.updatedAt = now();
		await persistRunRecord(record);
		await emitRunEntry(pi, record);
		latestTerminalRun = cloneRecord(record);
		activeRuns.delete(record.id);
		updateUi(ctx);
	};

	const emitToolUpdate = (
		onUpdate: ((result: AgentToolResult<SwarmToolDetails>) => void) | undefined,
		record: SwarmRunRecord,
		catalog: LoadedSwarmCatalog,
	): void => {
		if (!onUpdate) return;
		const text = record.task.output || record.task.summary || `${record.task.agent} ${getStatusLabel(record.status)}...`;
		onUpdate({
			content: [{ type: "text", text }],
			details: {
				run: cloneRecord(record),
				catalog: {
					globalPath: catalog.globalPath,
					projectPath: catalog.projectPath,
				},
			},
		});
	};

	const markBlocked = async (
		ctx: ExtensionContext,
		record: SwarmRunRecord,
		message: string,
		catalog: LoadedSwarmCatalog,
		onUpdate?: (result: AgentToolResult<SwarmToolDetails>) => void,
	): Promise<RunOutcome> => {
		record.status = "blocked";
		record.error = message;
		record.task.state = "blocked";
		record.task.errorMessage = message;
		record.task.summary = summarizeText(message) ?? "Blocked before worker start";
		record.finishedAt = now();
		record.updatedAt = record.finishedAt;
		record.task.finishedAt = record.finishedAt;
		pushRecentActivity(record, `blocked: ${record.task.summary}`);
		await persistRunRecord(record);
		await emitRunEntry(pi, record);
		latestTerminalRun = cloneRecord(record);
		updateUi(ctx);
		emitToolUpdate(onUpdate, record, catalog);
		return { record, catalog, isError: true };
	};

	const runSingleAgent = async (
		ctx: ExtensionContext,
		request: RunRequest,
		onUpdate?: (result: AgentToolResult<SwarmToolDetails>) => void,
		signal?: AbortSignal,
	): Promise<RunOutcome> => {
		const catalog = loadSwarmCatalog(ctx.cwd, request.agentScope);
		const agent =
			catalog.agents[request.agent] ??
			Object.values(catalog.agents).find((entry) => entry.name.toLowerCase() === request.agent.toLowerCase());

		if (!agent) {
			throw new Error(
				`Unknown swarm agent "${request.agent}". Available: ${Object.keys(catalog.agents).sort().join(", ") || "none"}`,
			);
		}

		const cwd = request.cwd ?? ctx.cwd;
		const record: SwarmRunRecord = {
			id: createRunId(),
			mode: "single",
			status: "queued",
			createdAt: now(),
			updatedAt: now(),
			agentScope: catalog.defaultScope,
			source: request.source,
			runFile: getRunPath(ctx, "pending"),
			projectAgentsPath: catalog.projectPath,
			trustProjectAgents: request.trustProjectAgents ?? false,
			recentActivity: [],
			task: {
				agent: agent.name,
				agentSource: agent.source,
				task: request.task,
				cwd,
				profile: agent.profile,
				safetyMode: agent.safetyMode,
				state: "queued",
				usage: createUsageStats(),
				messages: [],
			},
		};
		record.runFile = getRunPath(ctx, record.id);

		const { profileName, mode } = getPermissionContext(ctx);
		pushRecentActivity(record, `queued by ${request.source}`);
		await persistRunRecord(record);

		if (!canDelegate(mode, agent.safetyMode)) {
			return markBlocked(
				ctx,
				record,
				`${profileName} (${mode}) cannot delegate to ${agent.name} (${agent.safetyMode}).`,
				catalog,
				onUpdate,
			);
		}

		if (agent.source === "project" && !(request.trustProjectAgents ?? false)) {
			if (!ctx.hasUI) {
				return markBlocked(
					ctx,
					record,
					`Project-local swarm agent "${agent.name}" requires interactive confirmation or trustProjectAgents:true.`,
					catalog,
					onUpdate,
				);
			}

			const confirmed = await ctx.ui.confirm(
				"Run project-local swarm agent?",
				`Agent: ${agent.name}\nSource: ${agent.sourcePath}\n\nProject-local swarm agents are repository-controlled. Continue only if you trust this checkout.`,
			);
			if (!confirmed) {
				return markBlocked(ctx, record, `Project-local swarm agent "${agent.name}" was not approved.`, catalog, onUpdate);
			}
		}

		const controller = new AbortController();
		if (signal) {
			const abort = () => controller.abort(signal.reason);
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
		}

		activeRuns.set(record.id, {
			controller,
			record,
		});

		record.status = "running";
		record.startedAt = now();
		record.updatedAt = record.startedAt;
		record.task.state = "running";
		record.task.startedAt = record.startedAt;
		pushRecentActivity(record, "worker starting");
		await persistRunRecord(record);
		updateUi(ctx);
		emitToolUpdate(onUpdate, record, catalog);

		const prompt = buildWorkerSystemPrompt(agent);
		const promptPath = await writePromptFile(record.id, prompt);
		const loadedModels = loadModels(ctx.cwd);
		const route = resolveModelRoute(agent, loadedModels);
		const args = ["--mode", "json", "-p", "--no-session"];
		if (agent.profile) args.push("--persona", agent.profile);
		if (route.provider && route.model) args.push("--model", `${route.provider}/${route.model}`);
		if (route.thinkingLevel) args.push("--effort", route.thinkingLevel);
		if (agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
		args.push("--append-system-prompt", promptPath);
		args.push(buildWorkerPrompt(record.id, agent, request.task, cwd));

		let aborted = false;
		const currentResult: WorkerResult = {
			agent: agent.name,
			agentSource: agent.source,
			task: request.task,
			exitCode: 0,
			messages: [],
			stderr: "",
			usage: createUsageStats(),
		};

		try {
			const exitCode = await new Promise<number>((resolve) => {
				const invocation = getPiInvocation(args);
				const child = spawn(invocation.command, invocation.args, {
					cwd,
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
				});
				const activeState = activeRuns.get(record.id);
				if (activeState) activeState.childPid = child.pid;

				let buffer = "";

				const syncRecordFromResult = async (): Promise<void> => {
					record.task.messages = currentResult.messages;
					record.task.output = getFinalOutput(currentResult.messages) || undefined;
					record.task.summary = summarizeText(record.task.output) ?? summarizeText(record.task.errorMessage);
					record.task.usage = { ...currentResult.usage };
					record.task.model = currentResult.model;
					record.task.stopReason = currentResult.stopReason;
					record.task.errorMessage = currentResult.errorMessage;
					record.task.stderr = currentResult.stderr || undefined;
					record.updatedAt = now();
					await persistRunRecord(record);
					updateUi(ctx);
					emitToolUpdate(onUpdate, record, catalog);
				};

				const processLine = (line: string) => {
					if (!line.trim()) return;

					let event: any;
					try {
						event = JSON.parse(line);
					} catch {
						return;
					}

					if (event.type === "tool_execution_start") {
						pushRecentActivity(record, formatToolCall(event.toolName, event.args ?? {}, ctx.ui.theme.fg.bind(ctx.ui.theme)));
					}

					if (event.type === "message_end" && event.message) {
						const message = event.message as Message;
						currentResult.messages.push(message);
						if (message.role === "assistant") {
							currentResult.usage.turns++;
							if (message.usage) {
								currentResult.usage.input += message.usage.input || 0;
								currentResult.usage.output += message.usage.output || 0;
								currentResult.usage.cacheRead += message.usage.cacheRead || 0;
								currentResult.usage.cacheWrite += message.usage.cacheWrite || 0;
								currentResult.usage.cost += message.usage.cost?.total || 0;
								currentResult.usage.contextTokens = message.usage.totalTokens || 0;
							}
							if (!currentResult.model && message.model) currentResult.model = message.model;
							if (message.stopReason) currentResult.stopReason = message.stopReason;
							if (message.errorMessage) currentResult.errorMessage = message.errorMessage;
							const preview = summarizeText(getFinalOutput([message]));
							if (preview) pushRecentActivity(record, `assistant: ${preview}`);
						}
						void syncRecordFromResult();
					}

					if (event.type === "tool_result_end" && event.message) {
						currentResult.messages.push(event.message as Message);
						void syncRecordFromResult();
					}
				};

				child.stdout.on("data", (chunk) => {
					buffer += chunk.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) processLine(line);
				});

				child.stderr.on("data", (chunk) => {
					currentResult.stderr += chunk.toString();
				});

				child.on("close", (code) => {
					if (buffer.trim()) processLine(buffer);
					resolve(code ?? 0);
				});

				child.on("error", () => {
					resolve(1);
				});

				const abort = () => {
					aborted = true;
					child.kill("SIGTERM");
					setTimeout(() => {
						if (!child.killed) child.kill("SIGKILL");
					}, 5000);
				};

				if (controller.signal.aborted) abort();
				else controller.signal.addEventListener("abort", abort, { once: true });
			});

			currentResult.exitCode = exitCode;
		} finally {
			try {
				await withFileMutationQueue(promptPath, async () => {
					await writeFile(promptPath, "", "utf-8");
				});
			} catch {
				/* ignore */
			}
		}

		record.task.messages = currentResult.messages;
		record.task.output = getFinalOutput(currentResult.messages) || undefined;
		record.task.summary =
			summarizeText(record.task.output) ??
			summarizeText(currentResult.errorMessage) ??
			summarizeText(currentResult.stderr) ??
			`${agent.name} finished`;
		record.task.usage = { ...currentResult.usage };
		record.task.model = currentResult.model;
		record.task.stopReason = currentResult.stopReason;
		record.task.errorMessage = currentResult.errorMessage;
		record.task.stderr = currentResult.stderr || undefined;
		record.finishedAt = now();
		record.updatedAt = record.finishedAt;
		record.task.finishedAt = record.finishedAt;

		if (aborted || currentResult.stopReason === "aborted") {
			record.status = "canceled";
			record.task.state = "canceled";
			record.error = currentResult.errorMessage ?? "Swarm run was aborted";
			pushRecentActivity(record, "worker canceled");
		} else if (currentResult.exitCode !== 0 || currentResult.stopReason === "error") {
			record.status = "failed";
			record.task.state = "failed";
			record.error =
				currentResult.errorMessage ??
				summarizeText(record.task.output) ??
				summarizeText(currentResult.stderr) ??
				"Swarm worker failed";
			pushRecentActivity(record, `worker failed: ${record.error}`);
		} else {
			record.status = "done";
			record.task.state = "done";
			pushRecentActivity(record, "worker completed");
		}

		await finalizeRecord(ctx, record);
		emitToolUpdate(onUpdate, record, catalog);
		return {
			record,
			catalog,
			isError: record.status !== "done",
		};
	};

	const getDefaultInspectableRun = async (ctx: ExtensionContext, runId: string | undefined): Promise<SwarmRunRecord | undefined> => {
		if (runId && activeRuns.has(runId)) {
			return cloneRecord(activeRuns.get(runId)!.record);
		}

		if (runId) {
			const fromDisk = await loadRunRecord(getRunPath(ctx, runId));
			if (fromDisk) return fromDisk;
		}

		if (activeRuns.size > 0) {
			return cloneRecord(Array.from(activeRuns.values())[activeRuns.size - 1].record);
		}

		if (latestTerminalRun) return cloneRecord(latestTerminalRun);

		const records = await loadRunRecords(ctx);
		return records[0];
	};

	pi.registerCommand("swarm", {
		description: "Run or inspect swarm delegations",
		getArgumentCompletions: (prefix) =>
			SWARM_COMMANDS.filter((command) => command.startsWith(prefix.trim().toLowerCase())).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const raw = args.trim();
			if (!raw || raw === "help") {
				ctx.ui.notify(
					[
						"Usage:",
						"/swarm agents [global|project|both]",
						"/swarm status",
						"/swarm runs",
						"/swarm inspect [run-id]",
						"/swarm abort [run-id]",
						"/swarm run [--scope global|project|both] [--cwd path] [--trust-project] <agent> -- <task>",
					].join("\n"),
					"info",
				);
				return;
			}

			const [head, tail] = raw.includes(" -- ") ? raw.split(/\s+--\s+/, 2) : [raw, ""];
			const tokens = head.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
			const command = tokens[0]?.toLowerCase();

			if (command === "agents") {
				const requestedScope = tokens[1] as AgentScope | undefined;
				const scope = requestedScope && ["global", "project", "both"].includes(requestedScope) ? requestedScope : undefined;
				const catalog = loadSwarmCatalog(ctx.cwd, scope);
				const lines = Object.values(catalog.agents)
					.sort((a, b) => a.name.localeCompare(b.name))
					.map((agent) => `${agent.name} (${agent.source}) | ${agent.safetyMode} | ${agent.description}`);
				ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No swarm agents available.", "info");
				return;
			}

			if (command === "status") {
				if (activeRuns.size > 0) {
					const lines = Array.from(activeRuns.values()).map((entry) => formatNotifySummary(ctx, entry.record));
					ctx.ui.notify(lines.join("\n\n"), "info");
					return;
				}

				if (latestTerminalRun) {
					ctx.ui.notify(formatNotifySummary(ctx, latestTerminalRun), "info");
					return;
				}

				ctx.ui.notify("Swarm is idle.", "info");
				return;
			}

			if (command === "runs") {
				const records = await loadRunRecords(ctx);
				ctx.ui.notify(buildRunsSummary(ctx, records), "info");
				return;
			}

			if (command === "inspect") {
				const runId = tokens[1];
				const record = await getDefaultInspectableRun(ctx, runId);
				if (!record) {
					ctx.ui.notify("No swarm run found to inspect.", "warning");
					return;
				}
				ctx.ui.notify(buildInspectSummary(ctx, record), "info");
				return;
			}

			if (command === "abort") {
				const runId = tokens[1] ?? Array.from(activeRuns.keys())[0];
				if (!runId) {
					ctx.ui.notify("No active swarm run to abort.", "warning");
					return;
				}

				const active = activeRuns.get(runId);
				if (!active) {
					ctx.ui.notify(`Swarm run ${runId} is not active.`, "warning");
					return;
				}

				active.controller.abort(new Error(`Swarm run ${runId} aborted by user command.`));
				ctx.ui.notify(`Abort requested for swarm run ${runId}.`, "info");
				return;
			}

			if (command === "run") {
				let scope: AgentScope | undefined;
				let cwd: string | undefined;
				let trustProjectAgents = false;
				const remaining = tokens.slice(1);
				const positional: string[] = [];

				for (let i = 0; i < remaining.length; i++) {
					const token = remaining[i];
					if (token === "--scope") {
						const next = remaining[i + 1];
						if (!next || !["global", "project", "both"].includes(next)) {
							ctx.ui.notify("Usage: /swarm run --scope global|project|both <agent> -- <task>", "error");
							return;
						}
						scope = next as AgentScope;
						i++;
						continue;
					}
					if (token === "--cwd") {
						const next = remaining[i + 1];
						if (!next) {
							ctx.ui.notify("Usage: /swarm run --cwd <path> <agent> -- <task>", "error");
							return;
						}
						cwd = next;
						i++;
						continue;
					}
					if (token === "--trust-project") {
						trustProjectAgents = true;
						continue;
					}
					positional.push(token);
				}

				const agent = positional[0];
				const task = tail || positional.slice(1).join(" ");
				if (!agent || !task) {
					ctx.ui.notify("Usage: /swarm run <agent> -- <task>", "error");
					return;
				}

				try {
					const outcome = await runSingleAgent(
						ctx,
						{
							agent,
							task,
							cwd,
							agentScope: scope,
							trustProjectAgents,
							source: "command",
						},
					);
					ctx.ui.notify(
						formatNotifySummary(ctx, outcome.record),
						outcome.record.status === "done" ? "success" : outcome.record.status === "failed" ? "error" : "warning",
					);
				} catch (error) {
					ctx.ui.notify(String(error), "error");
				}
				return;
			}

			ctx.ui.notify(`Unknown /swarm action "${command}". Try: ${SWARM_COMMANDS.join(", ")}`, "error");
		},
	});

	pi.registerTool({
		name: "swarm",
		label: "Swarm",
		description: "Delegate one bounded task to a named swarm worker with isolated context and persisted run records.",
		promptSnippet: "Delegate one bounded task to a named swarm worker when isolated context or specialized review would help.",
		promptGuidelines: [
			"Prefer a single well-scoped swarm task with one clear owner.",
			"Use read-only workers for exploration, planning, review, or verification tasks.",
			"Only delegate to edit-capable workers when the current persona has equal or stronger permissions.",
		],
		parameters: SwarmParams,
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			try {
				const outcome = await runSingleAgent(
					ctx,
					{
						agent: params.agent,
						task: params.task,
						cwd: params.cwd,
						agentScope: params.agentScope,
						trustProjectAgents: params.trustProjectAgents,
						source: "tool",
					},
					onUpdate,
					signal,
				);

				return {
					content: [{ type: "text", text: outcome.record.task.output || outcome.record.error || "(no output)" }],
					details: {
						run: cloneRecord(outcome.record),
						catalog: {
							globalPath: outcome.catalog.globalPath,
							projectPath: outcome.catalog.projectPath,
						},
					},
					isError: outcome.isError,
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: String(error) }],
					isError: true,
				};
			}
		},
		renderCall(args, theme) {
			const preview = args.task.length > 80 ? `${args.task.slice(0, 80)}...` : args.task;
			const scope = args.agentScope ?? "global";
			return new Text(
				theme.fg("toolTitle", theme.bold("swarm ")) +
					theme.fg("accent", args.agent) +
					theme.fg("muted", ` [${scope}]`) +
					`\n  ${theme.fg("dim", preview)}`,
				0,
				0,
			);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as SwarmToolDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const record = details.run;
			const icon = record.status === "done" ? theme.fg("success", "✓") : record.status === "running" || isPartial ? theme.fg("accent", "▶") : record.status === "failed" ? theme.fg("error", "✗") : theme.fg("warning", "!");
			const header =
				`${icon} ` +
				theme.fg("toolTitle", theme.bold(record.task.agent)) +
				theme.fg("muted", ` (${record.task.agentSource}) `) +
				theme.fg(
					record.status === "done"
						? "success"
						: record.status === "failed"
							? "error"
							: record.status === "running" || isPartial
								? "accent"
								: "warning",
					getStatusLabel(record.status),
				) +
				theme.fg("muted", ` ${record.id}`);

			const displayItems = getDisplayItems(record.task.messages);
			const usage = formatUsageStats(record.task.usage, record.task.model);
			const markdownTheme = getMarkdownTheme();

			if (!expanded) {
				let text = header;
				const preview = record.task.summary ?? record.error ?? record.task.output ?? "(no output)";
				text += `\n${theme.fg("toolOutput", preview.length > 220 ? `${preview.slice(0, 220)}...` : preview)}`;
				if (record.recentActivity.length > 0) {
					text += `\n${theme.fg("muted", record.recentActivity.at(-1) ?? "")}`;
				}
				if (usage) {
					text += `\n${theme.fg("dim", usage)}`;
				}
				if (!expanded) {
					text += `\n${theme.fg("muted", keyHint("app.tools.expand", "to expand"))}`;
				}
				return new Text(text, 0, 0);
			}

			const container = new Container();
			container.addChild(new Text(header, 0, 0));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "Task"), 0, 0));
			container.addChild(new Text(theme.fg("dim", record.task.task), 0, 0));

			if (record.recentActivity.length > 0) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "Recent Activity"), 0, 0));
				for (const line of record.recentActivity) {
					container.addChild(new Text(theme.fg("toolOutput", line), 0, 0));
				}
			}

			if (displayItems.length > 0) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "Worker Transcript"), 0, 0));
				for (const item of displayItems) {
					if (item.type === "toolCall") {
						container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
					}
				}
			}

			if (record.task.output) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "Final Output"), 0, 0));
				container.addChild(new Markdown(record.task.output, 0, 0, markdownTheme));
			}

			if (record.error) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("error", record.error), 0, 0));
			}

			if (usage) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", usage), 0, 0));
			}

			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", `Run record: ${shortenPath(record.runFile)}`), 0, 0));
			return container;
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const records = await loadRunRecords(ctx);
		const staleRecords = records.filter((record) => record.status === "queued" || record.status === "running");
		for (const record of staleRecords) {
			record.status = "canceled";
			record.task.state = "canceled";
			record.finishedAt = now();
			record.updatedAt = record.finishedAt;
			record.task.finishedAt = record.finishedAt;
			record.error = record.error ?? "Swarm run was interrupted before the session resumed.";
			pushRecentActivity(record, "session resumed after interrupted run");
			await persistRunRecord(record);
		}
		const refreshedRecords = await loadRunRecords(ctx);
		latestTerminalRun = refreshedRecords[0];
		updateUi(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		activeRuns.clear();
		const records = await loadRunRecords(ctx);
		latestTerminalRun = records[0];
		updateUi(ctx);
	});

	pi.on("session_shutdown", async () => {
		for (const active of activeRuns.values()) {
			active.controller.abort(new Error("Pi session shutting down"));
		}
	});
}
