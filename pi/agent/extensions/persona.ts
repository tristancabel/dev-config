import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

type PermissionMode = "read-only" | "edit-allowed" | "review-runner";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type EffortMode = "auto" | ThinkingLevel;
type VerificationPrimary = "frontend" | "backend" | "cli" | "config" | "general";
type VerificationModifier = "refactor" | "bug-fix";

type ProfileDefinition = {
	description?: string;
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	permissionMode: PermissionMode;
	instructions: string;
	autoSwitch?: string[];
};

type ProfilesFile = {
	defaultProfile?: string;
	profiles?: Record<string, ProfileDefinition>;
};

type GuardrailRule = {
	command: string;
	message: string;
};

type GuardrailsFile = {
	deny?: GuardrailRule[];
	confirm?: GuardrailRule[];
};

type ModelRouteConfig = string | { ref?: string; provider?: string; model?: string; thinkingLevel?: ThinkingLevel };

type ModelsFile = {
	defaultModel?: string;
	defaultThinkingLevel?: ThinkingLevel;
	routing?: Record<string, ModelRouteConfig>;
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

type PlanDocument = {
	path: string;
	status: "draft" | "approved";
	updatedAt: string;
	approvedAt?: string;
	sourceProfile?: string;
	body: string;
};

type VerificationContext = {
	primary: VerificationPrimary;
	modifiers: VerificationModifier[];
	changedFiles: string[];
};

type WorktreeState = {
	enabled?: boolean;
	path?: string;
	rootPath?: string;
	name?: string;
};

const PROFILE_STATE_TYPE = "pi-profile-state";
const EFFORT_STATE_TYPE = "pi-effort-state";
const WORKTREE_STATE_TYPE = "pi-worktree-state";
const DEFAULT_PROFILE = "builder";
const PERSONA_STATUS_KEY = "pi-persona";
const PLAN_STATUS_KEY = "pi-plan";
const EFFORT_STATUS_KEY = "pi-effort";
const VERIFY_STATUS_KEY = "pi-verify";
const PLAN_DIRECTORY = join(".pi", "plans");
const PLAN_FILE_NAME = "active-plan.md";
const PLAN_COMMANDS = ["status", "show", "approve", "draft", "edit", "new", "remove", "path"];
const EFFORT_LEVELS: EffortMode[] = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"];
const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];
const DEFAULT_PERSONA_PRIORITY = ["verifier", "reviewer", "planner", "scout", "builder"];
const GLOBAL_PROFILES_PATH = fileURLToPath(new URL("../profiles.json", import.meta.url));
const GLOBAL_GUARDRAILS_PATH = fileURLToPath(new URL("../../guardrails.json", import.meta.url));
const GLOBAL_MODELS_PATH = fileURLToPath(new URL("../models.json", import.meta.url));
const FRONTEND_FILE_PATTERN = /\.(tsx|jsx|css|scss|sass|less|html|vue|svelte)$/i;
const FRONTEND_PATH_PATTERN = /(^|\/)(app|components|frontend|pages|styles|ui|web)(\/|$)/i;
const BACKEND_FILE_PATTERN = /\.(py|rb|go|rs|java|kt|scala|php|cs)$/i;
const BACKEND_PATH_PATTERN = /(^|\/)(api|backend|controllers|db|handlers|migrations|models|routes|server|services)(\/|$)/i;
const CLI_FILE_PATTERN = /\.(sh|bash|zsh|ps1)$/i;
const CLI_PATH_PATTERN = /(^|\/)(bin|cli|cmd|command|commands|scripts)(\/|$)/i;
const CONFIG_FILE_PATTERN = /(^|\/)(Dockerfile|docker-compose\.(ya?ml)|compose\.(ya?ml)|\.env(\..+)?|.*\.(json|jsonc|toml|ya?ml|ini|cfg|conf|properties)|CMakeLists\.txt|compile_commands\.json)$/i;
const FRONTEND_TEXT_PATTERN = /\b(frontend|ui|ux|component|page|responsive|browser|accessibility|layout|styling)\b/i;
const BACKEND_TEXT_PATTERN = /\b(backend|api|server|endpoint|request|response|database|db|migration|service|auth)\b/i;
const CLI_TEXT_PATTERN = /\b(cli|command line|subcommand|flag|argument|stdin|stdout|exit code)\b/i;
const CONFIG_TEXT_PATTERN = /\b(config|configuration|settings|toml|yaml|json|cmake|env file|workflow)\b/i;
const REFACTOR_TEXT_PATTERN = /\b(refactor|rename|cleanup|extract|reorganize|mechanical|no behavior change)\b/i;
const BUG_FIX_TEXT_PATTERN = /\b(fix|bug|regression|issue|crash|error|incorrect|broken|failure)\b/i;

const READ_ONLY_SAFE_PATTERNS = [
	/^\s*cat\b/i,
	/^\s*head\b/i,
	/^\s*tail\b/i,
	/^\s*less\b/i,
	/^\s*more\b/i,
	/^\s*grep\b/i,
	/^\s*find\b/i,
	/^\s*ls\b/i,
	/^\s*pwd\b/i,
	/^\s*echo\b/i,
	/^\s*printf\b/i,
	/^\s*wc\b/i,
	/^\s*sort\b/i,
	/^\s*uniq\b/i,
	/^\s*diff\b/i,
	/^\s*file\b/i,
	/^\s*stat\b/i,
	/^\s*du\b/i,
	/^\s*df\b/i,
	/^\s*tree\b/i,
	/^\s*which\b/i,
	/^\s*whereis\b/i,
	/^\s*type\b/i,
	/^\s*env\b/i,
	/^\s*printenv\b/i,
	/^\s*uname\b/i,
	/^\s*whoami\b/i,
	/^\s*id\b/i,
	/^\s*date\b/i,
	/^\s*uptime\b/i,
	/^\s*ps\b/i,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-files)\b/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*yarn\s+(list|info|why|audit)\b/i,
	/^\s*brew\s+(list|info|search|outdated|config|doctor)\b/i,
	/^\s*node\s+--version\b/i,
	/^\s*python(?:3)?\s+--version\b/i,
	/^\s*curl\b/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/i,
	/^\s*sed\s+-n\b/i,
	/^\s*awk\b/i,
	/^\s*rg\b/i,
	/^\s*fd\b/i,
	/^\s*bat\b/i,
	/^\s*exa\b/i,
	/^\s*sw_vers\b/i,
	/^\s*mdfind\b/i,
	/^\s*mdls\b/i,
	/^\s*plutil\b/i,
	/^\s*xcodebuild\s+(-version|-showsdks)\b/i,
	/^\s*xcrun\b/i,
];

const REVIEW_RUNNER_BLOCKED_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/\bsed\s+-i\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)\b/i,
	/\byarn\s+(add|remove|install|publish)\b/i,
	/\bpnpm\s+(add|remove|install|publish)\b/i,
	/\bpip(?:3)?\s+(install|uninstall)\b/i,
	/\bpython(?:3)?\s+-m\s+pip\s+(install|uninstall)\b/i,
	/\bapt(?:-get)?\s+(install|remove|purge|update|upgrade)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)\b/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
	/\bservice\s+\S+\s+(start|stop|restart)\b/i,
	/^\s*open\b/i,
	/^\s*osascript\b/i,
	/\blaunchctl\b/i,
	/\bsoftwareupdate\b/i,
	/\bdiskutil\b/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

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

function normalizeEffortMode(value: string | undefined): EffortMode | undefined {
	if (!value) return undefined;
	return EFFORT_LEVELS.includes(value as EffortMode) ? (value as EffortMode) : undefined;
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
		return parseModelRef(config);
	}

	const parsedRef = parseModelRef(config.ref);
	return {
		provider: config.provider ?? parsedRef.provider,
		model: config.model ?? parsedRef.model,
		thinkingLevel: normalizeThinkingLevel(config.thinkingLevel),
	};
}

function getGlobalProfilesPath(): string {
	return GLOBAL_PROFILES_PATH;
}

function getProjectProfilesPath(cwd: string): string {
	return join(cwd, ".pi", "profiles.json");
}

function loadProfiles(cwd: string): LoadedProfiles {
	const globalProfiles = readJsonFile<ProfilesFile>(getGlobalProfilesPath()) ?? {};
	const projectProfiles = readJsonFile<ProfilesFile>(getProjectProfilesPath(cwd)) ?? {};
	const mergedProfiles = {
		...(globalProfiles.profiles ?? {}),
		...(projectProfiles.profiles ?? {}),
	};

	const defaultProfile =
		projectProfiles.defaultProfile ??
		globalProfiles.defaultProfile ??
		(mergedProfiles[DEFAULT_PROFILE] ? DEFAULT_PROFILE : Object.keys(mergedProfiles)[0] ?? DEFAULT_PROFILE);

	return {
		defaultProfile,
		profiles: mergedProfiles,
	};
}

function getGlobalGuardrailsPath(): string {
	return GLOBAL_GUARDRAILS_PATH;
}

function getProjectGuardrailsPath(cwd: string): string {
	return join(cwd, ".pi", "guardrails.json");
}

function loadGuardrails(cwd: string): GuardrailsFile {
	const globalGuardrails = readJsonFile<GuardrailsFile>(getGlobalGuardrailsPath()) ?? {};
	const projectGuardrails = readJsonFile<GuardrailsFile>(getProjectGuardrailsPath(cwd)) ?? {};

	return {
		deny: [...(globalGuardrails.deny ?? []), ...(projectGuardrails.deny ?? [])],
		confirm: [...(globalGuardrails.confirm ?? []), ...(projectGuardrails.confirm ?? [])],
	};
}

function getGlobalModelsPath(): string {
	return GLOBAL_MODELS_PATH;
}

function getProjectModelsPath(cwd: string): string {
	return join(cwd, ".pi", "models.json");
}

function loadModels(cwd: string): LoadedModels {
	const globalModels = readJsonFile<ModelsFile>(getGlobalModelsPath()) ?? {};
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

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

function getAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function getPlanPath(cwd: string): string {
	return join(cwd, PLAN_DIRECTORY, PLAN_FILE_NAME);
}

function getRelativePlanPath(cwd: string): string {
	const relPath = relative(cwd, getPlanPath(cwd));
	return relPath.length > 0 ? relPath : getPlanPath(cwd);
}

function parsePlan(raw: string, path: string): PlanDocument {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		return {
			path,
			status: "draft",
			updatedAt: "",
			body: raw.trim(),
		};
	}

	const metadataLines = match[1].split("\n");
	const metadata: Record<string, string> = {};

	for (const line of metadataLines) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		metadata[key] = value;
	}

	return {
		path,
		status: metadata.status === "approved" ? "approved" : "draft",
		updatedAt: metadata.updatedAt ?? "",
		approvedAt: metadata.approvedAt || undefined,
		sourceProfile: metadata.sourceProfile || undefined,
		body: match[2].trim(),
	};
}

function readPlan(cwd: string): PlanDocument | undefined {
	const path = getPlanPath(cwd);
	if (!existsSync(path)) return undefined;

	try {
		return parsePlan(readFileSync(path, "utf-8"), path);
	} catch (error) {
		console.error(`Failed to read ${path}: ${String(error)}`);
		return undefined;
	}
}

function writePlan(cwd: string, plan: Omit<PlanDocument, "path">): PlanDocument {
	const path = getPlanPath(cwd);
	mkdirSync(dirname(path), { recursive: true });

	const lines = [
		"---",
		`status: ${plan.status}`,
		`updatedAt: ${plan.updatedAt}`,
		plan.approvedAt ? `approvedAt: ${plan.approvedAt}` : undefined,
		plan.sourceProfile ? `sourceProfile: ${plan.sourceProfile}` : undefined,
		"---",
		"",
		plan.body.trim(),
		"",
	].filter((line): line is string => Boolean(line));

	writeFileSync(path, `${lines.join("\n")}`, "utf-8");

	return {
		...plan,
		path,
	};
}

function removePlan(cwd: string): boolean {
	const path = getPlanPath(cwd);
	if (!existsSync(path)) return false;
	unlinkSync(path);
	return true;
}

function buildEmptyPlanTemplate(): string {
	return [
		"## Plan",
		"",
		"### Step 1",
		"- Files:",
		"- Changes:",
		"",
		"## Risks",
		"- ",
		"",
		"## Validation",
		"- ",
	].join("\n");
}

function isEmptyPlanBody(body: string): boolean {
	const trimmedBody = body.trim();
	return trimmedBody.length === 0 || trimmedBody === buildEmptyPlanTemplate().trim();
}

function getProfileNames(loadedProfiles: LoadedProfiles): string[] {
	return Object.keys(loadedProfiles.profiles);
}

function getProfileOrder(loadedProfiles: LoadedProfiles): string[] {
	const available = new Set(getProfileNames(loadedProfiles));
	const ordered = DEFAULT_PERSONA_PRIORITY.filter((name) => available.has(name));
	const extras = getProfileNames(loadedProfiles).filter((name) => !ordered.includes(name)).sort();
	return [...ordered, ...extras];
}

function getProfile(loadedProfiles: LoadedProfiles, name: string | undefined): ProfileDefinition | undefined {
	if (!name) return undefined;
	return loadedProfiles.profiles[name];
}

function getProfileArgumentCompletions(loadedProfiles: LoadedProfiles, prefix: string) {
	return getProfileNames(loadedProfiles)
		.filter((name) => name.startsWith(prefix))
		.map((name) => ({ value: name, label: name }));
}

function getPlanArgumentCompletions(prefix: string) {
	return PLAN_COMMANDS.filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
}

function getEffortArgumentCompletions(prefix: string) {
	return EFFORT_LEVELS.filter((name) => name.startsWith(prefix)).map((name) => ({ value: name, label: name }));
}

function getEffectivePermissionMode(
	profileName: string,
	profile: ProfileDefinition,
	plan: PlanDocument | undefined,
): PermissionMode {
	if (profileName === "builder" && plan?.status !== "approved") {
		return "read-only";
	}
	return profile.permissionMode;
}

function getAllowedTools(
	profileName: string,
	profile: ProfileDefinition,
	plan: PlanDocument | undefined,
	allToolNames: string[],
): string[] {
	if (profileName === "builder" && plan?.status !== "approved") {
		return READ_ONLY_TOOLS.filter((name) => allToolNames.includes(name));
	}

	if (profile.tools && profile.tools.length > 0) {
		return profile.tools.filter((name) => allToolNames.includes(name));
	}

	return allToolNames;
}

function resolveModelRoute(profileName: string, profile: ProfileDefinition, loadedModels: LoadedModels): ModelRoute {
	const routed = normalizeModelRouteConfig(loadedModels.routing[profileName]);
	const fallback = normalizeModelRouteConfig(
		loadedModels.defaultModel || loadedModels.defaultThinkingLevel
			? {
					ref: loadedModels.defaultModel,
					thinkingLevel: loadedModels.defaultThinkingLevel,
				}
			: undefined,
	);

	return {
		provider: profile.provider ?? routed.provider ?? fallback.provider,
		model: profile.model ?? routed.model ?? fallback.model,
		thinkingLevel: profile.thinkingLevel ?? routed.thinkingLevel ?? fallback.thinkingLevel,
	};
}

function formatModelRoute(route: ModelRoute): string | undefined {
	if (!route.provider || !route.model) return undefined;
	return `${route.provider}/${route.model}`;
}

function resolveEffectiveThinkingLevel(route: ModelRoute, effortMode: EffortMode): ThinkingLevel | undefined {
	if (effortMode !== "auto") return effortMode;
	return route.thinkingLevel;
}

function matchesRule(rule: GuardrailRule, command: string): boolean {
	try {
		return new RegExp(rule.command).test(command);
	} catch {
		return false;
	}
}

function getGuardrailMatch(rules: GuardrailRule[] | undefined, command: string): GuardrailRule | undefined {
	return rules?.find((rule) => matchesRule(rule, command));
}

function isSafeReadOnlyCommand(command: string): boolean {
	return READ_ONLY_SAFE_PATTERNS.some((pattern) => pattern.test(command));
}

function isBlockedReviewRunnerCommand(command: string): boolean {
	return REVIEW_RUNNER_BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

function explainBashBlock(profileName: string, mode: PermissionMode, command: string): string | undefined {
	if (mode === "read-only") {
		if (!isSafeReadOnlyCommand(command)) {
			return `${profileName} is in read-only mode. Only safe inspection commands are allowed.\nBlocked command: ${command}`;
		}
		return undefined;
	}

	if (mode === "review-runner") {
		if (isBlockedReviewRunnerCommand(command)) {
			return `${profileName} is in review-runner mode. Validation commands are allowed, but project mutations are blocked.\nBlocked command: ${command}`;
		}
	}

	return undefined;
}

function suggestProfile(loadedProfiles: LoadedProfiles, input: string): string | undefined {
	const normalized = input.trim().toLowerCase();
	if (normalized.length < 4 || normalized.startsWith("/")) return undefined;

	for (const profileName of getProfileOrder(loadedProfiles)) {
		const profile = loadedProfiles.profiles[profileName];
		if (!profile?.autoSwitch?.length) continue;
		if (profile.autoSwitch.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
			return profileName;
		}
	}

	return undefined;
}

function parseGitStatusPath(line: string): string | undefined {
	if (line.length < 4) return undefined;
	const payload = line.slice(3).trim();
	if (!payload) return undefined;
	const renamedPath = payload.includes(" -> ") ? payload.split(" -> ").pop() : payload;
	return renamedPath?.trim() || undefined;
}

function getChangedFiles(cwd: string): string[] {
	const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
		cwd,
		encoding: "utf-8",
	});

	if (result.status !== 0 || !result.stdout) return [];

	const files = result.stdout
		.split(/\r?\n/)
		.map((line) => parseGitStatusPath(line))
		.filter((path): path is string => Boolean(path));

	return [...new Set(files)];
}

function inferVerificationContext(cwd: string, plan: PlanDocument | undefined): VerificationContext {
	const changedFiles = getChangedFiles(cwd);
	const planText = plan?.body ?? "";
	const combinedText = `${planText}\n${changedFiles.join("\n")}`;

	const scores: Record<VerificationPrimary, number> = {
		frontend: 0,
		backend: 0,
		cli: 0,
		config: 0,
		general: 0,
	};

	for (const file of changedFiles) {
		if (FRONTEND_FILE_PATTERN.test(file) || FRONTEND_PATH_PATTERN.test(file)) scores.frontend += 2;
		if (BACKEND_FILE_PATTERN.test(file) || BACKEND_PATH_PATTERN.test(file)) scores.backend += 2;
		if (CLI_FILE_PATTERN.test(file) || CLI_PATH_PATTERN.test(file)) scores.cli += 2;
		if (CONFIG_FILE_PATTERN.test(file)) scores.config += 2;
	}

	if (FRONTEND_TEXT_PATTERN.test(combinedText)) scores.frontend += 1;
	if (BACKEND_TEXT_PATTERN.test(combinedText)) scores.backend += 1;
	if (CLI_TEXT_PATTERN.test(combinedText)) scores.cli += 1;
	if (CONFIG_TEXT_PATTERN.test(combinedText)) scores.config += 1;

	const primary = (["frontend", "backend", "cli", "config"] as VerificationPrimary[]).reduce<VerificationPrimary>(
		(best, current) => (scores[current] > scores[best] ? current : best),
		"general",
	);

	const modifiers: VerificationModifier[] = [];
	if (REFACTOR_TEXT_PATTERN.test(combinedText)) modifiers.push("refactor");
	if (BUG_FIX_TEXT_PATTERN.test(combinedText)) modifiers.push("bug-fix");

	return {
		primary: scores[primary] > 0 ? primary : "general",
		modifiers,
		changedFiles: changedFiles.slice(0, 12),
	};
}

function formatVerificationLabel(context: VerificationContext): string {
	const suffix = context.modifiers.length > 0 ? `+${context.modifiers.join("+")}` : "";
	return `${context.primary}${suffix}`;
}

function buildPermissionModeSection(mode: PermissionMode): string {
	if (mode === "read-only") {
		return [
			"Permission mode: READ-ONLY",
			"- Do not modify project files",
			"- Do not use edit or write tools",
			"- Bash is limited to safe inspection commands",
		].join("\n");
	}

	if (mode === "review-runner") {
		return [
			"Permission mode: REVIEW-RUNNER",
			"- Do not modify project files",
			"- You may run safe validation commands",
			"- Bash may be used for tests, builds, and inspection but not for repo mutation",
		].join("\n");
	}

	return [
		"Permission mode: EDIT-ALLOWED",
		"- File edits are allowed when they follow the approved workflow",
		"- Existing guardrails still apply to dangerous commands",
	].join("\n");
}

function buildModelSection(route: ModelRoute, effortMode: EffortMode, currentThinkingLevel: ThinkingLevel): string[] {
	const lines = ["## Model Routing"];
	const routeLabel = formatModelRoute(route);

	lines.push(routeLabel ? `Active route: ${routeLabel}` : "Active route: current Pi model");

	if (effortMode === "auto") {
		lines.push(`Reasoning effort: auto (effective: ${currentThinkingLevel})`);
	} else {
		lines.push(`Reasoning effort override: ${effortMode} (effective: ${currentThinkingLevel})`);
	}

	return lines;
}

function buildVerificationSection(context: VerificationContext): string {
	const lines = [
		"Verification workflow:",
		"- This is an executable validation pass. Prefer running commands over pure reasoning.",
		"- Run at least one happy-path validation command when the environment allows.",
		"- Run at least one non-happy-path probe when the environment allows.",
		"- Use executed command output as evidence.",
		"- End with exactly one verdict line: `VERDICT: PASS`, `VERDICT: FAIL`, or `VERDICT: PARTIAL`.",
		"- If environment limits block useful checks, explain the limit and use `VERDICT: PARTIAL`.",
		"",
		`Detected verification focus: ${formatVerificationLabel(context)}`,
	];

	if (context.changedFiles.length > 0) {
		lines.push("", "Changed files detected:");
		for (const file of context.changedFiles) {
			lines.push(`- ${file}`);
		}
	}

	switch (context.primary) {
		case "frontend":
			lines.push(
				"",
				"Frontend checks:",
				"- Run the most relevant UI build, lint, or test command if available",
				"- Probe a non-happy-path UI state such as invalid input, empty state, error state, or narrow viewport",
				"- Look for visible regressions, accessibility issues, and loading-state problems",
			);
			break;
		case "backend":
			lines.push(
				"",
				"Backend checks:",
				"- Run the most relevant service, unit, or integration test command if available",
				"- Probe a non-happy-path case such as malformed input, missing resource, auth failure, or boundary values",
				"- Call out API, data, and error-handling regressions explicitly",
			);
			break;
		case "cli":
			lines.push(
				"",
				"CLI checks:",
				"- Run the normal invocation path plus help or usage output when relevant",
				"- Probe a non-happy-path case such as bad flags, missing args, invalid files, or non-zero exit behavior",
				"- Report command output and exit-code behavior clearly",
			);
			break;
		case "config":
			lines.push(
				"",
				"Config checks:",
				"- Run parse, lint, build, or dry-run validation if the project exposes one",
				"- Probe a non-happy-path case such as invalid values, missing keys, or startup failures",
				"- Focus on syntax validity, safe defaults, and boot-time regressions",
			);
			break;
		default:
			lines.push(
				"",
				"General checks:",
				"- Choose the most relevant project command to validate behavior",
				"- Add at least one adversarial or edge-case probe when possible",
				"- Be explicit about what remains unverified",
			);
			break;
	}

	if (context.modifiers.includes("bug-fix")) {
		lines.push(
			"",
			"Bug-fix checks:",
			"- Try to reproduce the original bug first when the environment allows it",
			"- After the fix passes, probe one adjacent edge case to look for partial regressions",
		);
	}

	if (context.modifiers.includes("refactor")) {
		lines.push(
			"",
			"Refactor checks:",
			"- Focus on regression detection and unchanged external behavior",
			"- Compare public interfaces, command output, or test behavior rather than only code shape",
		);
	}

	lines.push(
		"",
		"Required output format:",
		"## Evidence",
		"- `command` -> observed result",
		"## Findings",
		"- ...",
		"## Limits",
		"- ...",
		"VERDICT: PASS|FAIL|PARTIAL",
	);

	return lines.join("\n");
}

function buildWorkflowSection(
	cwd: string,
	executionCwd: string,
	profileName: string,
	profile: ProfileDefinition,
	mode: PermissionMode,
	plan: PlanDocument | undefined,
	route: ModelRoute,
	effortMode: EffortMode,
	currentThinkingLevel: ThinkingLevel,
	verificationContext: VerificationContext | undefined,
): string {
	const lines = [
		"## Pi Workflow",
		`Active persona: ${profileName}`,
		...buildModelSection(route, effortMode, currentThinkingLevel),
		"",
		buildPermissionModeSection(mode),
		"",
		profile.instructions.trim(),
	];

	if (executionCwd !== cwd) {
		lines.push(
			"",
			`Execution workspace: \`${formatWorkspacePath(cwd, executionCwd)}\` (isolated worktree)`,
			"- Use that workspace for reads, searches, bash commands, and edits",
			"- Keep verification and change analysis aligned with the active worktree state",
		);
	}

	if (profileName === "planner") {
		lines.push(
			"",
			`Your response will be saved automatically to \`${getRelativePlanPath(cwd)}\` as a draft plan.`,
			"The user must approve it with `/plan approve` before builder can edit files.",
		);
	}

	if (profileName === "builder") {
		lines.push("");
		if (!plan || plan.status !== "approved") {
			lines.push(
				"Builder gate: no approved plan is available.",
				`Stay read-only and explain that implementation is blocked until a plan is approved with \`/plan approve\`.`,
			);

			if (plan) {
				lines.push(`Current plan status: ${plan.status} at \`${getRelativePlanPath(cwd)}\`.`);
			} else {
				lines.push(`No plan file exists yet. Ask the user to switch to planner or run \`/plan new\` to create one.`);
			}
		} else {
			lines.push(
				`Approved plan source: \`${getRelativePlanPath(cwd)}\``,
				"Execute the approved plan below with focused, minimal edits:",
				"",
				plan.body.trim(),
			);
		}
	}

	if (profileName === "reviewer") {
		lines.push(
			"",
			"Review workflow:",
			"- Findings must come first",
			"- Use command output as evidence when you run checks",
			"- If you find no issues, say so explicitly and mention remaining risk",
		);
	}

	if (profileName === "verifier" && verificationContext) {
		lines.push("", buildVerificationSection(verificationContext));
	}

	if (plan && profileName !== "builder") {
		lines.push("", `Current plan status: ${plan.status} at \`${getRelativePlanPath(cwd)}\`.`);
	}

	lines.push(
		"",
		"Workflow commands:",
		"- `/persona` to switch persona",
		"- `/plan` to inspect, create, edit, approve, or remove the active plan",
		"- `/effort` to inspect or override reasoning effort",
	);

	return lines.join("\n");
}

function renderPlanSummary(cwd: string, plan: PlanDocument): string {
	return [
		"# Active Plan",
		"",
		`- Path: \`${getRelativePlanPath(cwd)}\``,
		`- Status: \`${plan.status}\``,
		plan.updatedAt ? `- Updated: \`${plan.updatedAt}\`` : undefined,
		plan.approvedAt ? `- Approved: \`${plan.approvedAt}\`` : undefined,
		plan.sourceProfile ? `- Source profile: \`${plan.sourceProfile}\`` : undefined,
		"",
		plan.body.trim(),
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

function getLatestCustomEntryData<T>(ctx: ExtensionContext, customType: string): T | undefined {
	const entry = ctx.sessionManager
		.getEntries()
		.filter((item: { type: string; customType?: string }) => item.type === "custom" && item.customType === customType)
		.pop() as { data?: T } | undefined;

	return entry?.data;
}

function getExecutionCwd(ctx: ExtensionContext): string {
	const worktreeState = getLatestCustomEntryData<WorktreeState>(ctx, WORKTREE_STATE_TYPE);
	if (!worktreeState?.enabled || !worktreeState.path || !existsSync(worktreeState.path)) {
		return ctx.cwd;
	}
	return worktreeState.path;
}

function formatWorkspacePath(baseCwd: string, executionCwd: string): string {
	const relPath = relative(baseCwd, executionCwd);
	if (!relPath || relPath.length === 0) return ".";
	return relPath.startsWith("..") ? executionCwd : relPath;
}

export default function personaExtension(pi: ExtensionAPI): void {
	let loadedProfiles: LoadedProfiles = {
		defaultProfile: DEFAULT_PROFILE,
		profiles: {},
	};
	let loadedGuardrails: GuardrailsFile = {};
	let loadedModels: LoadedModels = {
		routing: {},
	};
	let activeProfileName = DEFAULT_PROFILE;
	let effortMode: EffortMode = "auto";
	let verifierCommandsThisTurn: string[] = [];

	function getCurrentProfile(): ProfileDefinition | undefined {
		return getProfile(loadedProfiles, activeProfileName);
	}

	async function applyModelAndThinking(
		profileName: string,
		profile: ProfileDefinition,
		ctx: ExtensionContext,
	): Promise<ModelRoute> {
		const route = resolveModelRoute(profileName, profile, loadedModels);

		if (route.provider && route.model) {
			const model = ctx.modelRegistry.find(route.provider, route.model);
			if (model) {
				const success = await pi.setModel(model);
				if (!success) {
					ctx.ui.notify(`No credentials available for ${route.provider}/${route.model}`, "warning");
				}
			} else {
				ctx.ui.notify(`Model ${route.provider}/${route.model} not found`, "warning");
			}
		}

		const thinkingLevel = resolveEffectiveThinkingLevel(route, effortMode);
		if (thinkingLevel) {
			pi.setThinkingLevel(thinkingLevel);
		}

		return route;
	}

	async function applyProfile(
		profileName: string,
		ctx: ExtensionContext,
		options?: { notify?: boolean; persist?: boolean },
	): Promise<boolean> {
		const profile = getProfile(loadedProfiles, profileName);
		if (!profile) return false;

		activeProfileName = profileName;

		const plan = readPlan(ctx.cwd);
		const allToolNames = pi.getAllTools().map((tool) => tool.name);
		pi.setActiveTools(getAllowedTools(profileName, profile, plan, allToolNames));
		const route = await applyModelAndThinking(profileName, profile, ctx);

		updateStatus(ctx);

		if (options?.persist) {
			pi.appendEntry(PROFILE_STATE_TYPE, { name: profileName });
		}

		if (options?.notify) {
			const effectiveMode = getEffectivePermissionMode(profileName, profile, plan);
			const routeLabel = formatModelRoute(route);
			const currentThinkingLevel = pi.getThinkingLevel();
			const routeMessage = routeLabel ? `, ${routeLabel}` : "";
			ctx.ui.notify(
				`Persona: ${profileName} (${effectiveMode}${routeMessage}, effort ${currentThinkingLevel})`,
				"info",
			);
		}

		if (
			profileName === "builder" &&
			getEffectivePermissionMode(profileName, profile, plan) === "read-only"
		) {
			ctx.ui.notify("Builder is locked to read-only until the active plan is approved.", "warning");
		}

		return true;
	}

	async function setEffortMode(
		nextMode: EffortMode,
		ctx: ExtensionContext,
		options?: { notify?: boolean; persist?: boolean },
	): Promise<void> {
		effortMode = nextMode;

		const profile = getCurrentProfile();
		if (profile) {
			await applyModelAndThinking(activeProfileName, profile, ctx);
		}

		updateStatus(ctx);

		if (options?.persist) {
			pi.appendEntry(EFFORT_STATE_TYPE, { mode: nextMode });
		}

		if (options?.notify) {
			const effectiveLevel = pi.getThinkingLevel();
			const label = nextMode === "auto" ? `auto (effective: ${effectiveLevel})` : `${nextMode} (effective: ${effectiveLevel})`;
			ctx.ui.notify(`Effort: ${label}`, "info");
		}
	}

	function updateStatus(ctx: ExtensionContext): void {
		const profile = getCurrentProfile();
		if (!profile) return;

		const plan = readPlan(ctx.cwd);
		const mode = getEffectivePermissionMode(activeProfileName, profile, plan);
		const currentThinkingLevel = pi.getThinkingLevel();
		ctx.ui.setStatus(PERSONA_STATUS_KEY, ctx.ui.theme.fg("accent", `${activeProfileName}:${mode}`));

		const effortLabel =
			effortMode === "auto" ? `effort:auto/${currentThinkingLevel}` : `effort:${currentThinkingLevel}`;
		ctx.ui.setStatus(EFFORT_STATUS_KEY, ctx.ui.theme.fg("muted", effortLabel));

		if (activeProfileName === "verifier") {
			const verificationContext = inferVerificationContext(getExecutionCwd(ctx), plan);
			ctx.ui.setStatus(VERIFY_STATUS_KEY, ctx.ui.theme.fg("warning", `verify:${formatVerificationLabel(verificationContext)}`));
		} else {
			ctx.ui.setStatus(VERIFY_STATUS_KEY, undefined);
		}

		if (!plan) {
			ctx.ui.setStatus(PLAN_STATUS_KEY, ctx.ui.theme.fg("dim", "plan:none"));
			return;
		}

		const color = plan.status === "approved" ? "success" : "warning";
		ctx.ui.setStatus(PLAN_STATUS_KEY, ctx.ui.theme.fg(color, `plan:${plan.status}`));
	}

	async function handlePlanCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const action = args.trim().toLowerCase() || "status";
		const existingPlan = readPlan(ctx.cwd);

		if (action === "path") {
			ctx.ui.notify(getRelativePlanPath(ctx.cwd), "info");
			return;
		}

		if (action === "status") {
			if (!existingPlan) {
				ctx.ui.notify(`No active plan. Expected at ${getRelativePlanPath(ctx.cwd)}`, "info");
				return;
			}
			ctx.ui.notify(`Plan ${existingPlan.status} at ${getRelativePlanPath(ctx.cwd)}`, "info");
			return;
		}

		if (action === "show") {
			if (!existingPlan) {
				ctx.ui.notify("No active plan to show", "warning");
				return;
			}

			pi.sendMessage(
				{
					customType: "pi-plan",
					content: renderPlanSummary(ctx.cwd, existingPlan),
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		if (action === "approve") {
			if (!existingPlan) {
				ctx.ui.notify("No active plan to approve", "warning");
				return;
			}

			const now = new Date().toISOString();
			writePlan(ctx.cwd, {
				status: "approved",
				updatedAt: now,
				approvedAt: now,
				sourceProfile: existingPlan.sourceProfile,
				body: existingPlan.body,
			});
			await applyProfile(activeProfileName, ctx);
			ctx.ui.notify(`Plan approved: ${getRelativePlanPath(ctx.cwd)}`, "info");
			return;
		}

		if (action === "draft") {
			if (!existingPlan) {
				ctx.ui.notify("No active plan to mark as draft", "warning");
				return;
			}

			writePlan(ctx.cwd, {
				status: "draft",
				updatedAt: new Date().toISOString(),
				sourceProfile: existingPlan.sourceProfile,
				body: existingPlan.body,
			});
			await applyProfile(activeProfileName, ctx);
			ctx.ui.notify("Plan marked as draft", "info");
			return;
		}

		if (action === "remove") {
			if (!removePlan(ctx.cwd)) {
				ctx.ui.notify("No active plan to remove", "warning");
				return;
			}

			await applyProfile(activeProfileName, ctx);
			ctx.ui.notify(`Plan removed: ${getRelativePlanPath(ctx.cwd)}`, "info");
			return;
		}

		if (action === "new") {
			if (!ctx.hasUI) {
				ctx.ui.notify("Creating a new plan requires interactive mode", "error");
				return;
			}

			const editedBody = await ctx.ui.editor("Create new active plan", buildEmptyPlanTemplate());
			if (editedBody === undefined) return;
			if (isEmptyPlanBody(editedBody)) {
				ctx.ui.notify("Plan was not saved because it is empty", "warning");
				return;
			}

			writePlan(ctx.cwd, {
				status: "draft",
				updatedAt: new Date().toISOString(),
				sourceProfile: activeProfileName === "planner" ? "planner" : "manual",
				body: editedBody.trim(),
			});
			await applyProfile(activeProfileName, ctx);
			ctx.ui.notify(`New draft plan saved to ${getRelativePlanPath(ctx.cwd)}`, "info");
			return;
		}

		if (action === "edit") {
			if (!ctx.hasUI) {
				ctx.ui.notify("Plan editing requires interactive mode", "error");
				return;
			}

			const currentBody = existingPlan?.body ?? buildEmptyPlanTemplate();
			const editedBody = await ctx.ui.editor("Edit active plan", currentBody);
			if (editedBody === undefined) return;
			if (isEmptyPlanBody(editedBody)) {
				ctx.ui.notify("Plan was not saved because it is empty", "warning");
				return;
			}

			const wasApproved = existingPlan?.status === "approved";
			writePlan(ctx.cwd, {
				status: "draft",
				updatedAt: new Date().toISOString(),
				sourceProfile: existingPlan?.sourceProfile ?? "planner",
				body: editedBody.trim(),
			});
			await applyProfile(activeProfileName, ctx);
			ctx.ui.notify(
				wasApproved
					? `Plan saved as draft and approval revoked: ${getRelativePlanPath(ctx.cwd)}`
					: `Plan saved to ${getRelativePlanPath(ctx.cwd)}`,
				"info",
			);
			return;
		}

		ctx.ui.notify(`Unknown /plan action "${action}". Try: ${PLAN_COMMANDS.join(", ")}`, "error");
	}

	pi.registerFlag("persona", {
		description: "Persona profile to start with",
		type: "string",
	});

	pi.registerFlag("effort", {
		description: "Reasoning effort override (auto|off|minimal|low|medium|high|xhigh)",
		type: "string",
	});

	pi.registerCommand("persona", {
		description: "Switch persona profile",
		getArgumentCompletions: (prefix) => getProfileArgumentCompletions(loadedProfiles, prefix),
		handler: async (args, ctx) => {
			const requested = args.trim();
			let targetProfile = requested;

			if (!requested) {
				if (!ctx.hasUI) {
					ctx.ui.notify(`Active persona: ${activeProfileName}`, "info");
					return;
				}

				targetProfile = await ctx.ui.select("Select persona", getProfileOrder(loadedProfiles)) ?? "";
			}

			if (!getProfile(loadedProfiles, targetProfile)) {
				const available = getProfileOrder(loadedProfiles).join(", ");
				ctx.ui.notify(`Unknown persona "${targetProfile}". Available: ${available}`, "error");
				return;
			}

			await applyProfile(targetProfile, ctx, { notify: true, persist: true });
		},
	});

	pi.registerCommand("plan", {
		description: "Show, create, edit, approve, or remove the active plan",
		getArgumentCompletions: (prefix) => getPlanArgumentCompletions(prefix),
		handler: async (args, ctx) => {
			await handlePlanCommand(args, ctx);
		},
	});

	pi.registerCommand("effort", {
		description: "Show or override reasoning effort",
		getArgumentCompletions: (prefix) => getEffortArgumentCompletions(prefix),
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (!requested) {
				const effective = pi.getThinkingLevel();
				const label = effortMode === "auto" ? `auto (effective: ${effective})` : `${effortMode} (effective: ${effective})`;
				ctx.ui.notify(`Effort: ${label}`, "info");
				return;
			}

			const normalized = normalizeEffortMode(requested);
			if (!normalized) {
				ctx.ui.notify(`Usage: /effort ${EFFORT_LEVELS.join("|")}`, "error");
				return;
			}

			await setEffortMode(normalized, ctx, { notify: true, persist: true });
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		loadedProfiles = loadProfiles(ctx.cwd);
		loadedGuardrails = loadGuardrails(ctx.cwd);
		loadedModels = loadModels(ctx.cwd);

		const personaFlag = pi.getFlag("persona");
		const flaggedProfile = typeof personaFlag === "string" ? personaFlag.trim() : "";
		const storedProfile = getLatestCustomEntryData<{ name?: string }>(ctx, PROFILE_STATE_TYPE);
		const initialProfile =
			(flaggedProfile && getProfile(loadedProfiles, flaggedProfile) && flaggedProfile) ||
			(storedProfile?.name && getProfile(loadedProfiles, storedProfile.name) && storedProfile.name) ||
			loadedProfiles.defaultProfile;

		if (flaggedProfile && !getProfile(loadedProfiles, flaggedProfile)) {
			ctx.ui.notify(`Unknown persona "${flaggedProfile}", using ${loadedProfiles.defaultProfile}`, "warning");
		}

		const effortFlag = pi.getFlag("effort");
		const flaggedEffort = typeof effortFlag === "string" ? normalizeEffortMode(effortFlag.trim()) : undefined;
		const storedEffort = normalizeEffortMode(getLatestCustomEntryData<{ mode?: string }>(ctx, EFFORT_STATE_TYPE)?.mode);
		if (typeof effortFlag === "string" && !flaggedEffort) {
			ctx.ui.notify(`Unknown effort "${effortFlag}", using ${storedEffort ?? "auto"}`, "warning");
		}
		effortMode = flaggedEffort ?? storedEffort ?? "auto";

		await applyProfile(initialProfile, ctx);
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive") return { action: "continue" as const };

		const suggested = suggestProfile(loadedProfiles, event.text);
		if (!suggested || suggested === activeProfileName) {
			return { action: "continue" as const };
		}

		if (!ctx.hasUI) {
			return { action: "continue" as const };
		}

		const confirmed = await ctx.ui.confirm(
			"Switch persona?",
			`This request looks like ${suggested}. Switch from ${activeProfileName} to ${suggested}?`,
		);

		if (!confirmed) {
			return { action: "continue" as const };
		}

		await applyProfile(suggested, ctx, { notify: true, persist: true });
		return { action: "continue" as const };
	});

	pi.on("tool_call", async (event, ctx) => {
		const profile = getCurrentProfile();
		if (!profile) return;

		const plan = readPlan(ctx.cwd);
		const mode = getEffectivePermissionMode(activeProfileName, profile, plan);
		const allowedTools = getAllowedTools(activeProfileName, profile, plan, pi.getAllTools().map((tool) => tool.name));

		if (!allowedTools.includes(event.toolName)) {
			return {
				block: true,
				reason: `${activeProfileName} (${mode}) does not allow the ${event.toolName} tool.`,
			};
		}

		if (event.toolName !== "bash") return;

		const command = event.input.command;
		const modeBlockReason = explainBashBlock(activeProfileName, mode, command);
		if (modeBlockReason) {
			return {
				block: true,
				reason: modeBlockReason,
			};
		}

		const deniedRule = getGuardrailMatch(loadedGuardrails.deny, command);
		if (deniedRule) {
			return {
				block: true,
				reason: deniedRule.message,
			};
		}

		const confirmRule = getGuardrailMatch(loadedGuardrails.confirm, command);
		if (!confirmRule) {
			if (activeProfileName === "verifier" && typeof command === "string") {
				verifierCommandsThisTurn.push(command);
			}
			return;
		}

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `${confirmRule.message}\nInteractive confirmation is required in this mode.`,
			};
		}

		const confirmed = await ctx.ui.confirm("Confirm command", `${confirmRule.message}\n\n${command}`);
		if (!confirmed) {
			return {
				block: true,
				reason: `Command cancelled by user.\n${command}`,
			};
		}

		if (activeProfileName === "verifier" && typeof command === "string") {
			verifierCommandsThisTurn.push(command);
		}
		return;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const profile = getCurrentProfile();
		if (!profile) return;

		const plan = readPlan(ctx.cwd);
		const allToolNames = pi.getAllTools().map((tool) => tool.name);
		const route = resolveModelRoute(activeProfileName, profile, loadedModels);
		const executionCwd = getExecutionCwd(ctx);
		const verificationContext = activeProfileName === "verifier" ? inferVerificationContext(executionCwd, plan) : undefined;

		if (activeProfileName === "verifier") {
			verifierCommandsThisTurn = [];
		}

		pi.setActiveTools(getAllowedTools(activeProfileName, profile, plan, allToolNames));
		updateStatus(ctx);

		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildWorkflowSection(
				ctx.cwd,
				executionCwd,
				activeProfileName,
				profile,
				getEffectivePermissionMode(activeProfileName, profile, plan),
				plan,
				route,
				effortMode,
				pi.getThinkingLevel(),
				verificationContext,
			)}`,
		};
	});

	pi.on("turn_start", async () => {
		if (getCurrentProfile()) {
			pi.appendEntry(PROFILE_STATE_TYPE, { name: activeProfileName });
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (activeProfileName === "planner") {
			const lastAssistantMessage = [...event.messages].reverse().find(isAssistantMessage);
			if (!lastAssistantMessage) return;

			const body = getAssistantText(lastAssistantMessage);
			if (!body) return;

			writePlan(ctx.cwd, {
				status: "draft",
				updatedAt: new Date().toISOString(),
				sourceProfile: "planner",
				body,
			});
			updateStatus(ctx);
			ctx.ui.notify(`Draft plan saved to ${getRelativePlanPath(ctx.cwd)}`, "info");
			return;
		}

		if (activeProfileName !== "verifier") return;

		const lastAssistantMessage = [...event.messages].reverse().find(isAssistantMessage);
		const body = lastAssistantMessage ? getAssistantText(lastAssistantMessage) : "";

		if (verifierCommandsThisTurn.length === 0) {
			ctx.ui.notify("Verifier finished without running executable checks.", "warning");
		}

		if (body && !/\bVERDICT:\s*(PASS|FAIL|PARTIAL)\b/i.test(body)) {
			ctx.ui.notify("Verifier response did not include a VERDICT line.", "warning");
		}

		updateStatus(ctx);
	});
}
