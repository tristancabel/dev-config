import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readdirSync } from "node:fs";
import { join } from "node:path";

type LanguageKey = "python" | "cpp";
type OverrideState = "auto" | "on" | "off";

type DetectionState = {
	python: boolean;
	cpp: boolean;
	compileCommands: boolean;
	pixi: boolean;
};

const STATUS_KEY = "pi-lang";
const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_ENTRIES = 600;

function scanDirectory(
	root: string,
	depth = 0,
	state: DetectionState = { python: false, cpp: false, compileCommands: false, pixi: false },
	counters: { entries: number } = { entries: 0 },
): DetectionState {
	if (depth > MAX_SCAN_DEPTH || counters.entries >= MAX_SCAN_ENTRIES) {
		return state;
	}

	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return state;
	}

	for (const entry of entries) {
		counters.entries += 1;
		if (counters.entries >= MAX_SCAN_ENTRIES) break;
		if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".pixi") continue;

		if (entry.isFile()) {
			if (entry.name.endsWith(".py") || entry.name === "pyproject.toml") state.python = true;
			if (entry.name.match(/\.(c|cc|cpp|cxx|h|hpp)$/) || entry.name === "CMakeLists.txt") state.cpp = true;
			if (entry.name === "compile_commands.json") state.compileCommands = true;
			if (entry.name === "pixi.toml") state.pixi = true;
			continue;
		}

		if (entry.isDirectory()) {
			scanDirectory(join(root, entry.name), depth + 1, state, counters);
		}
	}

	return state;
}

function resolveEnabled(detected: boolean, override: OverrideState): boolean {
	if (override === "on") return true;
	if (override === "off") return false;
	return detected;
}

export default function langControlExtension(pi: ExtensionAPI): void {
	let detected: DetectionState = { python: false, cpp: false, compileCommands: false, pixi: false };
	let overrides: Record<LanguageKey, OverrideState> = {
		python: "auto",
		cpp: "auto",
	};

	function updateStatus(ctx: ExtensionContext) {
		const python = resolveEnabled(detected.python, overrides.python);
		const cpp = resolveEnabled(detected.cpp, overrides.cpp);
		const parts = [python ? "py" : undefined, cpp ? "cpp" : undefined].filter((part): part is string => Boolean(part));
		ctx.ui.setStatus(STATUS_KEY, parts.length > 0 ? ctx.ui.theme.fg("muted", `lang:${parts.join(",")}`) : undefined);
	}

	pi.registerCommand("lang", {
		description: "Show or override language hints",
		getArgumentCompletions: (prefix) => {
			const tokens = prefix.trim().split(/\s+/).filter(Boolean);
			if (tokens.length <= 1) {
				return ["python", "cpp"].filter((item) => item.startsWith(tokens[0] ?? "")).map((item) => ({
					value: item,
					label: item,
				}));
			}
			if (tokens.length === 2) {
				return ["on", "off", "auto"].filter((item) => item.startsWith(tokens[1])).map((item) => ({
					value: `${tokens[0]} ${item}`,
					label: item,
				}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const [language, state] = args.trim().split(/\s+/).filter(Boolean) as [LanguageKey | undefined, OverrideState | undefined];

			if (!language) {
				const python = resolveEnabled(detected.python, overrides.python);
				const cpp = resolveEnabled(detected.cpp, overrides.cpp);
				ctx.ui.notify(
					`Python: ${python} (${overrides.python}) | C++: ${cpp} (${overrides.cpp}) | compile_commands.json: ${detected.compileCommands} | pixi.toml: ${detected.pixi}`,
					"info",
				);
				return;
			}

			if (!["python", "cpp"].includes(language)) {
				ctx.ui.notify("Usage: /lang <python|cpp> <on|off|auto>", "error");
				return;
			}

			if (!state || !["on", "off", "auto"].includes(state)) {
				ctx.ui.notify("Usage: /lang <python|cpp> <on|off|auto>", "error");
				return;
			}

			overrides[language] = state;
			updateStatus(ctx);
			ctx.ui.notify(`${language}: ${state}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		detected = scanDirectory(ctx.cwd);
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		updateStatus(ctx);

		const python = resolveEnabled(detected.python, overrides.python);
		const cpp = resolveEnabled(detected.cpp, overrides.cpp);
		const lines = [
			"## Language Hints",
			`- Python enabled: ${python} (override: ${overrides.python}, detected: ${detected.python})`,
			`- C++ enabled: ${cpp} (override: ${overrides.cpp}, detected: ${detected.cpp})`,
			`- compile_commands.json detected: ${detected.compileCommands}`,
			`- pixi.toml detected: ${detected.pixi}`,
		];

		if (python) {
			lines.push(
				"",
				"Python rules:",
				"- Prefer safe, minimal edits",
				"- Preserve imports and indentation",
				"- Assume linting and tests matter",
			);
		}

		if (cpp) {
			lines.push(
				"",
				"C++ rules:",
				"- Keep headers and sources consistent",
				"- Be conservative when compile_commands.json is missing",
				"- Respect the existing build structure",
			);
		}

		if (detected.pixi) {
			lines.push(
				"",
				"Pixi rules:",
				"- Prefer pixi-managed commands when running project tooling",
				"- Avoid ad hoc global package installation",
			);
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${lines.join("\n")}`,
		};
	});
}
