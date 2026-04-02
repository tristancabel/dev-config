import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

type LanguageKey = "python" | "cpp";
type OverrideState = "auto" | "on" | "off";

type DetectionState = {
	python: boolean;
	cpp: boolean;
	compileCommandsRoots: string[];
	pixiRoots: string[];
	pyprojectRoots: string[];
	cmakeRoots: string[];
	workspaceRoots: string[];
	projectRoots: string[];
	monorepo: boolean;
	scannedEntries: number;
	truncated: boolean;
};

type ScanAccumulator = {
	python: boolean;
	cpp: boolean;
	compileCommandsRoots: Set<string>;
	pixiRoots: Set<string>;
	pyprojectRoots: Set<string>;
	cmakeRoots: Set<string>;
	workspaceRoots: Set<string>;
	projectRoots: Set<string>;
	entries: number;
	truncated: boolean;
};

const STATUS_KEY = "pi-lang";
const MAX_SCAN_DEPTH = 5;
const MAX_SCAN_ENTRIES = 2400;
const SKIP_DIRECTORIES = new Set([
	".git",
	".hg",
	".svn",
	".idea",
	".vscode",
	".pixi",
	".venv",
	"venv",
	"node_modules",
	"dist",
	"build",
	"target",
	".next",
	".turbo",
	".mypy_cache",
	"__pycache__",
]);
const WORKSPACE_MANIFESTS = new Set(["package.json", "pnpm-workspace.yaml", "Cargo.toml", "go.mod"]);

function createAccumulator(): ScanAccumulator {
	return {
		python: false,
		cpp: false,
		compileCommandsRoots: new Set<string>(),
		pixiRoots: new Set<string>(),
		pyprojectRoots: new Set<string>(),
		cmakeRoots: new Set<string>(),
		workspaceRoots: new Set<string>(),
		projectRoots: new Set<string>(),
		entries: 0,
		truncated: false,
	};
}

function sortRoots(paths: Iterable<string>): string[] {
	return [...paths].sort((left, right) => {
		const leftDepth = left === "." ? 0 : left.split("/").length;
		const rightDepth = right === "." ? 0 : right.split("/").length;
		if (leftDepth !== rightDepth) return leftDepth - rightDepth;
		return left.localeCompare(right);
	});
}

function relativeRoot(cwd: string, root: string): string {
	const rel = relative(cwd, root);
	return !rel || rel.length === 0 ? "." : rel;
}

function recordRoot(set: Set<string>, cwd: string, root: string): void {
	set.add(relativeRoot(cwd, root));
}

function scanDirectory(cwd: string): DetectionState {
	const state = createAccumulator();

	function visit(root: string, depth: number): void {
		if (depth > MAX_SCAN_DEPTH || state.entries >= MAX_SCAN_ENTRIES) {
			state.truncated = true;
			return;
		}

		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(root, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (state.entries >= MAX_SCAN_ENTRIES) {
				state.truncated = true;
				return;
			}

			state.entries += 1;
			if (entry.isDirectory()) {
				if (SKIP_DIRECTORIES.has(entry.name)) continue;
				visit(join(root, entry.name), depth + 1);
				continue;
			}

			if (!entry.isFile()) continue;

			const localRoot = root;
			const fileName = entry.name;

			if (fileName.endsWith(".py") || fileName === "pyproject.toml" || fileName === "requirements.txt" || fileName === "setup.py") {
				state.python = true;
				recordRoot(state.projectRoots, cwd, localRoot);
			}

			if (fileName === "pyproject.toml") {
				recordRoot(state.pyprojectRoots, cwd, localRoot);
			}

			if (fileName === "pixi.toml") {
				state.python = true;
				recordRoot(state.pixiRoots, cwd, localRoot);
				recordRoot(state.projectRoots, cwd, localRoot);
			}

			if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(fileName) || fileName === "CMakeLists.txt") {
				state.cpp = true;
				recordRoot(state.projectRoots, cwd, localRoot);
			}

			if (fileName === "CMakeLists.txt") {
				recordRoot(state.cmakeRoots, cwd, localRoot);
			}

			if (fileName === "compile_commands.json") {
				state.cpp = true;
				recordRoot(state.compileCommandsRoots, cwd, localRoot);
				recordRoot(state.projectRoots, cwd, localRoot);
			}

			if (WORKSPACE_MANIFESTS.has(fileName)) {
				recordRoot(state.workspaceRoots, cwd, localRoot);
				recordRoot(state.projectRoots, cwd, localRoot);
			}
		}
	}

	visit(cwd, 0);

	const projectRoots = sortRoots(state.projectRoots);
	return {
		python: state.python,
		cpp: state.cpp,
		compileCommandsRoots: sortRoots(state.compileCommandsRoots),
		pixiRoots: sortRoots(state.pixiRoots),
		pyprojectRoots: sortRoots(state.pyprojectRoots),
		cmakeRoots: sortRoots(state.cmakeRoots),
		workspaceRoots: sortRoots(state.workspaceRoots),
		projectRoots,
		monorepo: projectRoots.length > 1,
		scannedEntries: state.entries,
		truncated: state.truncated,
	};
}

function resolveEnabled(detected: boolean, override: OverrideState): boolean {
	if (override === "on") return true;
	if (override === "off") return false;
	return detected;
}

function formatRootList(roots: string[], maxItems = 5): string {
	if (roots.length === 0) return "none";
	if (roots.length <= maxItems) return roots.join(", ");
	return `${roots.slice(0, maxItems).join(", ")}, +${roots.length - maxItems} more`;
}

function buildSummary(detected: DetectionState, overrides: Record<LanguageKey, OverrideState>): string {
	const python = resolveEnabled(detected.python, overrides.python);
	const cpp = resolveEnabled(detected.cpp, overrides.cpp);
	return [
		`Python: ${python} (${overrides.python}, detected ${detected.python})`,
		`C++: ${cpp} (${overrides.cpp}, detected ${detected.cpp})`,
		`Project roots: ${formatRootList(detected.projectRoots, 6)}${detected.monorepo ? " (nested/monorepo layout)" : ""}`,
		`pyproject.toml: ${formatRootList(detected.pyprojectRoots)}`,
		`pixi.toml: ${formatRootList(detected.pixiRoots)}`,
		`CMakeLists.txt: ${formatRootList(detected.cmakeRoots)}`,
		`compile_commands.json: ${formatRootList(detected.compileCommandsRoots)}`,
		`Workspace manifests: ${formatRootList(detected.workspaceRoots)}`,
		detected.truncated ? `Scan: truncated after ${detected.scannedEntries} entries` : `Scan: ${detected.scannedEntries} entries`,
	].join(" | ");
}

function buildPromptSection(detected: DetectionState, overrides: Record<LanguageKey, OverrideState>): string {
	const python = resolveEnabled(detected.python, overrides.python);
	const cpp = resolveEnabled(detected.cpp, overrides.cpp);
	const lines = [
		"## Project Detection",
		`- Python enabled: ${python} (override: ${overrides.python}, detected: ${detected.python})`,
		`- C++ enabled: ${cpp} (override: ${overrides.cpp}, detected: ${detected.cpp})`,
		`- Project roots: ${formatRootList(detected.projectRoots, 6)}${detected.monorepo ? " (nested/monorepo layout detected)" : ""}`,
		`- pyproject.toml roots: ${formatRootList(detected.pyprojectRoots)}`,
		`- pixi.toml roots: ${formatRootList(detected.pixiRoots)}`,
		`- CMakeLists.txt roots: ${formatRootList(detected.cmakeRoots)}`,
		`- compile_commands.json roots: ${formatRootList(detected.compileCommandsRoots)}`,
		`- Workspace manifests: ${formatRootList(detected.workspaceRoots)}`,
	];

	if (detected.truncated) {
		lines.push(`- Detection scan was truncated after ${detected.scannedEntries} filesystem entries, so treat results as best-effort`);
	}

	if (detected.monorepo) {
		lines.push("", "Project structure rules:", "- Choose the most relevant nested project root before running tooling or editing files", "- Do not assume repository-root commands are correct for every package or subproject");
	}

	if (python) {
		lines.push(
			"",
			"Python rules:",
			"- Prefer manifest-aware commands from the nearest Python root",
			"- Preserve imports, formatting, and local test conventions",
			"- If pixi.toml is present for the target area, prefer pixi-managed commands",
		);
	}

	if (cpp) {
		lines.push(
			"",
			"C++ rules:",
			"- Keep headers, sources, and build files consistent",
			"- Prefer the nearest CMake root instead of assuming a flat project layout",
			"- If compile_commands.json is present, use it to stay aligned with the actual build configuration",
		);
	}

	return lines.join("\n");
}

export default function langControlExtension(pi: ExtensionAPI): void {
	let detected: DetectionState = {
		python: false,
		cpp: false,
		compileCommandsRoots: [],
		pixiRoots: [],
		pyprojectRoots: [],
		cmakeRoots: [],
		workspaceRoots: [],
		projectRoots: [],
		monorepo: false,
		scannedEntries: 0,
		truncated: false,
	};
	let overrides: Record<LanguageKey, OverrideState> = {
		python: "auto",
		cpp: "auto",
	};
	let cachedPromptSignature = "";
	let cachedPromptSection = "";

	function clearPromptCache(): void {
		cachedPromptSignature = "";
		cachedPromptSection = "";
	}

	function getPromptSection(): string {
		const signature = JSON.stringify({ detected, overrides });
		if (signature === cachedPromptSignature) return cachedPromptSection;
		cachedPromptSignature = signature;
		cachedPromptSection = buildPromptSection(detected, overrides);
		return cachedPromptSection;
	}

	function refreshDetection(ctx: ExtensionContext): void {
		detected = scanDirectory(ctx.cwd);
		clearPromptCache();
		updateStatus(ctx);
	}

	function updateStatus(ctx: ExtensionContext): void {
		const python = resolveEnabled(detected.python, overrides.python);
		const cpp = resolveEnabled(detected.cpp, overrides.cpp);
		const parts = [python ? "py" : undefined, cpp ? "cpp" : undefined, detected.monorepo ? "mono" : undefined].filter(
			(part): part is string => Boolean(part),
		);
		ctx.ui.setStatus(STATUS_KEY, parts.length > 0 ? ctx.ui.theme.fg("muted", `lang:${parts.join(",")}`) : undefined);
	}

	pi.registerCommand("lang", {
		description: "Show or override language hints and refresh project detection",
		getArgumentCompletions: (prefix) => {
			const tokens = prefix.trim().split(/\s+/).filter(Boolean);
			if (tokens.length <= 1) {
				return ["python", "cpp", "refresh"].filter((item) => item.startsWith(tokens[0] ?? "")).map((item) => ({
					value: item,
					label: item,
				}));
			}
			if (tokens.length === 2 && ["python", "cpp"].includes(tokens[0] ?? "")) {
				return ["on", "off", "auto"].filter((item) => item.startsWith(tokens[1])).map((item) => ({
					value: `${tokens[0]} ${item}`,
					label: item,
				}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const [language, state] = args.trim().split(/\s+/).filter(Boolean) as [LanguageKey | "refresh" | undefined, OverrideState | undefined];

			if (!language) {
				ctx.ui.notify(buildSummary(detected, overrides), "info");
				return;
			}

			if (language === "refresh") {
				refreshDetection(ctx);
				ctx.ui.notify(`Project detection refreshed. ${buildSummary(detected, overrides)}`, "info");
				return;
			}

			if (!["python", "cpp"].includes(language)) {
				ctx.ui.notify("Usage: /lang [refresh|python <on|off|auto>|cpp <on|off|auto>]", "error");
				return;
			}

			if (!state || !["on", "off", "auto"].includes(state)) {
				ctx.ui.notify("Usage: /lang [refresh|python <on|off|auto>|cpp <on|off|auto>]", "error");
				return;
			}

			overrides[language] = state;
			clearPromptCache();
			updateStatus(ctx);
			ctx.ui.notify(buildSummary(detected, overrides), "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		refreshDetection(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		updateStatus(ctx);

		const promptSection = getPromptSection();
		if (!promptSection) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${promptSection}`,
		};
	});
}
