import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

type PermissionMode = "read-only" | "edit-allowed" | "review-runner";

type ProfileDefinition = {
	description?: string;
	provider?: string;
	model?: string;
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

type LoadedProfiles = {
	defaultProfile: string;
	profiles: Record<string, ProfileDefinition>;
};

type PlanDocument = {
	path: string;
	status: "draft" | "approved";
	updatedAt: string;
	approvedAt?: string;
	sourceProfile?: string;
	body: string;
};

const PROFILE_STATE_TYPE = "pi-profile-state";
const DEFAULT_PROFILE = "builder";
const PERSONA_STATUS_KEY = "pi-persona";
const PLAN_STATUS_KEY = "pi-plan";
const PLAN_DIRECTORY = join(".pi", "plans");
const PLAN_FILE_NAME = "active-plan.md";
const PLAN_COMMANDS = ["status", "show", "approve", "draft", "edit", "path"];
const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];
const DEFAULT_PERSONA_PRIORITY = ["reviewer", "planner", "scout", "builder"];
const GLOBAL_PROFILES_PATH = fileURLToPath(new URL("../profiles.json", import.meta.url));
const GLOBAL_GUARDRAILS_PATH = fileURLToPath(new URL("../../guardrails.json", import.meta.url));

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

function buildWorkflowSection(
	cwd: string,
	profileName: string,
	profile: ProfileDefinition,
	mode: PermissionMode,
	plan: PlanDocument | undefined,
): string {
	const lines = [
		"## Pi Workflow",
		`Active persona: ${profileName}`,
		buildPermissionModeSection(mode),
		"",
		profile.instructions.trim(),
	];

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
				lines.push(`No plan file exists yet. Ask the user to switch to planner or run \`/plan edit\` to create one.`);
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

	if (plan && profileName !== "builder") {
		lines.push("", `Current plan status: ${plan.status} at \`${getRelativePlanPath(cwd)}\`.`);
	}

	lines.push(
		"",
		"Workflow commands:",
		"- `/persona` to switch persona",
		"- `/plan` to inspect, edit, or approve the active plan",
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

export default function personaExtension(pi: ExtensionAPI): void {
	let loadedProfiles: LoadedProfiles = {
		defaultProfile: DEFAULT_PROFILE,
		profiles: {},
	};
	let loadedGuardrails: GuardrailsFile = {};
	let activeProfileName = DEFAULT_PROFILE;

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

		if (profile.provider && profile.model) {
			const model = ctx.modelRegistry.find(profile.provider, profile.model);
			if (model) {
				const success = await pi.setModel(model);
				if (!success) {
					ctx.ui.notify(`No credentials available for ${profile.provider}/${profile.model}`, "warning");
				}
			} else {
				ctx.ui.notify(`Model ${profile.provider}/${profile.model} not found`, "warning");
			}
		}

		updateStatus(ctx);

		if (options?.persist) {
			pi.appendEntry(PROFILE_STATE_TYPE, { name: profileName });
		}

		if (options?.notify) {
			const effectiveMode = getEffectivePermissionMode(profileName, profile, plan);
			ctx.ui.notify(`Persona: ${profileName} (${effectiveMode})`, "info");
		}

		if (
			profileName === "builder" &&
			getEffectivePermissionMode(profileName, profile, plan) === "read-only"
		) {
			ctx.ui.notify("Builder is locked to read-only until the active plan is approved.", "warning");
		}

		return true;
	}

	function updateStatus(ctx: ExtensionContext): void {
		const profile = getProfile(loadedProfiles, activeProfileName);
		if (!profile) return;

		const plan = readPlan(ctx.cwd);
		const mode = getEffectivePermissionMode(activeProfileName, profile, plan);
		ctx.ui.setStatus(PERSONA_STATUS_KEY, ctx.ui.theme.fg("accent", `${activeProfileName}:${mode}`));

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

		if (action === "status" || action === "path") {
			if (!existingPlan) {
				ctx.ui.notify(`No active plan. Expected at ${getRelativePlanPath(ctx.cwd)}`, "info");
				return;
			}
			const message =
				action === "path"
					? getRelativePlanPath(ctx.cwd)
					: `Plan ${existingPlan.status} at ${getRelativePlanPath(ctx.cwd)}`;
			ctx.ui.notify(message, "info");
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

		if (action === "edit") {
			if (!ctx.hasUI) {
				ctx.ui.notify("Plan editing requires interactive mode", "error");
				return;
			}

			const currentBody = existingPlan?.body ?? buildEmptyPlanTemplate();
			const editedBody = await ctx.ui.editor("Edit active plan", currentBody);
			if (editedBody === undefined) return;

			const nextStatus = existingPlan?.status ?? "draft";
			writePlan(ctx.cwd, {
				status: nextStatus,
				updatedAt: new Date().toISOString(),
				approvedAt: nextStatus === "approved" ? existingPlan?.approvedAt : undefined,
				sourceProfile: existingPlan?.sourceProfile ?? "planner",
				body: editedBody.trim(),
			});
			await applyProfile(activeProfileName, ctx);
			ctx.ui.notify(`Plan saved to ${getRelativePlanPath(ctx.cwd)}`, "info");
			return;
		}

		ctx.ui.notify(`Unknown /plan action "${action}". Try: ${PLAN_COMMANDS.join(", ")}`, "error");
	}

	pi.registerFlag("persona", {
		description: "Persona profile to start with",
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
		description: "Show, edit, or approve the active plan",
		getArgumentCompletions: (prefix) => getPlanArgumentCompletions(prefix),
		handler: async (args, ctx) => {
			await handlePlanCommand(args, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		loadedProfiles = loadProfiles(ctx.cwd);
		loadedGuardrails = loadGuardrails(ctx.cwd);

		const personaFlag = pi.getFlag("persona");
		const flaggedProfile = typeof personaFlag === "string" ? personaFlag.trim() : "";
		const storedProfile = ctx.sessionManager
			.getEntries()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === PROFILE_STATE_TYPE)
			.pop() as { data?: { name?: string } } | undefined;

		const initialProfile =
			(flaggedProfile && getProfile(loadedProfiles, flaggedProfile) && flaggedProfile) ||
			(storedProfile?.data?.name && getProfile(loadedProfiles, storedProfile.data.name) && storedProfile.data.name) ||
			loadedProfiles.defaultProfile;

		if (flaggedProfile && !getProfile(loadedProfiles, flaggedProfile)) {
			ctx.ui.notify(`Unknown persona "${flaggedProfile}", using ${loadedProfiles.defaultProfile}`, "warning");
		}

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
		const profile = getProfile(loadedProfiles, activeProfileName);
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
		if (!confirmRule) return;

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
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const profile = getProfile(loadedProfiles, activeProfileName);
		if (!profile) return;

		const plan = readPlan(ctx.cwd);
		const allToolNames = pi.getAllTools().map((tool) => tool.name);
		pi.setActiveTools(getAllowedTools(activeProfileName, profile, plan, allToolNames));
		updateStatus(ctx);

		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildWorkflowSection(
				ctx.cwd,
				activeProfileName,
				profile,
				getEffectivePermissionMode(activeProfileName, profile, plan),
				plan,
			)}`,
		};
	});

	pi.on("turn_start", async () => {
		if (getProfile(loadedProfiles, activeProfileName)) {
			pi.appendEntry(PROFILE_STATE_TYPE, { name: activeProfileName });
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (activeProfileName !== "planner") return;

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
	});
}
