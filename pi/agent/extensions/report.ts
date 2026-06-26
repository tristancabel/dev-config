import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

type SessionEntryLike = {
	type: string;
	id?: string;
	timestamp?: string;
	message?: unknown;
	provider?: string;
	modelId?: string;
	customType?: string;
	data?: unknown;
};

type UsageTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cost: number;
};

type PromptDetail = {
	index: number;
	timestamp?: string;
	text: string;
	chars: number;
	words: number;
};

type LlmCall = {
	index: number;
	timestamp?: string;
	provider?: string;
	model?: string;
	api?: string;
	stopReason?: string;
	usage: UsageTotals;
	outputWords: number;
	toolCalls: number;
};

type TurnSummary = {
	index: number;
	start?: Date;
	end?: Date;
	prompt: string;
	llmCalls: number;
	toolCalls: number;
	usage: UsageTotals;
};

type ReportOptions = {
	scope: "branch" | "all";
	destination: "show" | "save" | "copy";
};

const REPORT_OUTPUT_DIR = join(homedir(), ".pi", "agent", "pi-reports");
const REPORT_COMMANDS = ["save", "show", "copy", "all", "branch"];

function emptyUsage(): UsageTotals {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
		cost: 0,
	};
}

function addUsage(left: UsageTotals, right: UsageTotals): UsageTotals {
	return {
		input: left.input + right.input,
		output: left.output + right.output,
		cacheRead: left.cacheRead + right.cacheRead,
		cacheWrite: left.cacheWrite + right.cacheWrite,
		total: left.total + right.total,
		cost: left.cost + right.cost,
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseTimestamp(value: unknown): Date | undefined {
	if (typeof value !== "string" || value.trim().length === 0) return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatNumber(value: number): string {
	return Math.round(value).toLocaleString();
}

function formatCost(value: number): string {
	return value === 0 ? "0" : value.toFixed(6);
}

function formatDate(date: Date | undefined): string {
	return date ? date.toISOString() : "unknown";
}

function formatDuration(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "unknown";
	const totalSeconds = Math.round(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function formatHumanTime(minutes: number): string {
	if (!Number.isFinite(minutes) || minutes <= 0) return "unknown";
	if (minutes < 60) return `${Math.round(minutes)} min`;
	const hours = minutes / 60;
	if (hours < 10) return `${hours.toFixed(1)} h`;
	return `${Math.round(hours)} h`;
}

function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function truncateText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars).trimEnd()}\n[truncated: ${formatNumber(text.length - maxChars)} chars omitted]`;
}

function fencedText(text: string): string {
	return truncateText(text, 6000).replace(/```/g, "'''");
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const item of content) {
		const block = asRecord(item);
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
			parts.push(block.text.trim());
		}
	}
	return parts.join("\n").trim();
}

function extractToolCallCount(content: unknown): number {
	if (!Array.isArray(content)) return 0;
	return content.filter((item) => asRecord(item)?.type === "toolCall").length;
}

function extractUsage(message: Record<string, unknown>): UsageTotals {
	const usage = asRecord(message.usage);
	const cost = asRecord(usage?.cost);
	return {
		input: asNumber(usage?.input),
		output: asNumber(usage?.output),
		cacheRead: asNumber(usage?.cacheRead),
		cacheWrite: asNumber(usage?.cacheWrite),
		total: asNumber(usage?.totalTokens),
		cost: asNumber(cost?.total),
	};
}

function usageHasValues(usage: UsageTotals): boolean {
	return usage.input > 0 || usage.output > 0 || usage.cacheRead > 0 || usage.cacheWrite > 0 || usage.total > 0;
}

function modelLabel(provider?: string, model?: string): string {
	if (provider && model) return `${provider}/${model}`;
	return model ?? provider ?? "unknown";
}

function getEntries(ctx: ExtensionCommandContext, scope: "branch" | "all"): SessionEntryLike[] {
	if (scope === "all") {
		return ctx.sessionManager.getEntries() as SessionEntryLike[];
	}

	const leafId = ctx.sessionManager.getLeafId();
	if (!leafId) return ctx.sessionManager.getEntries() as SessionEntryLike[];
	return ctx.sessionManager.getBranch(leafId) as SessionEntryLike[];
}

function getTimestampRange(entries: SessionEntryLike[], headerTimestamp?: string): { start?: Date; end?: Date } {
	const dates = entries.map((entry) => parseTimestamp(entry.timestamp)).filter((date): date is Date => Boolean(date));
	const headerDate = parseTimestamp(headerTimestamp);
	const start = headerDate ?? dates[0];
	const end = dates.length > 0 ? dates[dates.length - 1] : headerDate;
	return { start, end };
}

function extractModelChanges(entries: SessionEntryLike[]): string[] {
	const changes: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "model_change") continue;
		changes.push(`${entry.timestamp ?? "unknown"}: ${modelLabel(entry.provider, entry.modelId)}`);
	}
	return changes;
}

function summarizeTurns(entries: SessionEntryLike[], callsByEntry: Map<string, LlmCall>): TurnSummary[] {
	const turns: TurnSummary[] = [];
	let current: TurnSummary | undefined;

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = asRecord(entry.message);
		if (!message) continue;
		const role = message.role;

		if (role === "user") {
			if (current) turns.push(current);
			current = {
				index: turns.length + 1,
				start: parseTimestamp(entry.timestamp),
				end: parseTimestamp(entry.timestamp),
				prompt: extractTextFromContent(message.content),
				llmCalls: 0,
				toolCalls: 0,
				usage: emptyUsage(),
			};
			continue;
		}

		if (!current) continue;
		current.end = parseTimestamp(entry.timestamp) ?? current.end;

		if (role === "assistant" && entry.id) {
			const call = callsByEntry.get(entry.id);
			if (call) {
				current.llmCalls += 1;
				current.toolCalls += call.toolCalls;
				current.usage = addUsage(current.usage, call.usage);
			}
		}
	}

	if (current) turns.push(current);
	return turns;
}

function buildReport(ctx: ExtensionCommandContext, options: ReportOptions): string {
	const entries = getEntries(ctx, options.scope);
	const header = ctx.sessionManager.getHeader();
	const range = getTimestampRange(entries, header?.timestamp);
	const prompts: PromptDetail[] = [];
	const llmCalls: LlmCall[] = [];
	const callsByEntry = new Map<string, LlmCall>();
	const modelTotals = new Map<string, { calls: number; usage: UsageTotals }>();
	let toolResultCount = 0;
	let totalToolCalls = 0;
	let assistantOutputWords = 0;

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = asRecord(entry.message);
		if (!message) continue;

		const role = message.role;
		if (role === "user") {
			const text = extractTextFromContent(message.content);
			prompts.push({
				index: prompts.length + 1,
				timestamp: entry.timestamp,
				text,
				chars: text.length,
				words: countWords(text),
			});
			continue;
		}

		if (role === "toolResult") {
			toolResultCount += 1;
			continue;
		}

		if (role !== "assistant") continue;

		const text = extractTextFromContent(message.content);
		const usage = extractUsage(message);
		const provider = typeof message.provider === "string" ? message.provider : undefined;
		const model = typeof message.model === "string" ? message.model : undefined;
		const toolCalls = extractToolCallCount(message.content);
		const llmCall: LlmCall = {
			index: llmCalls.length + 1,
			timestamp: entry.timestamp,
			provider,
			model,
			api: typeof message.api === "string" ? message.api : undefined,
			stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
			usage,
			outputWords: countWords(text),
			toolCalls,
		};

		llmCalls.push(llmCall);
		if (entry.id) callsByEntry.set(entry.id, llmCall);
		totalToolCalls += toolCalls;
		assistantOutputWords += llmCall.outputWords;

		const key = modelLabel(provider, model);
		const existing = modelTotals.get(key) ?? { calls: 0, usage: emptyUsage() };
		modelTotals.set(key, {
			calls: existing.calls + 1,
			usage: addUsage(existing.usage, usage),
		});
	}

	const turns = summarizeTurns(entries, callsByEntry);
	const totalUsage = llmCalls.reduce((acc, call) => addUsage(acc, call.usage), emptyUsage());
	const firstPromptAt = prompts.length > 0 ? parseTimestamp(prompts[0].timestamp) : undefined;
	const lastEntryAt = range.end;
	const workDuration = firstPromptAt && lastEntryAt ? lastEntryAt.getTime() - firstPromptAt.getTime() : undefined;
	const elapsedDuration = range.start && range.end ? range.end.getTime() - range.start.getTime() : undefined;
	const contextUsage = ctx.getContextUsage();
	const modelChanges = extractModelChanges(entries);

	const manualMin = prompts.length * 10 + llmCalls.length * 12 + totalToolCalls * 3 + (assistantOutputWords / 180) * 2;
	const manualMax = prompts.length * 20 + llmCalls.length * 30 + totalToolCalls * 8 + (assistantOutputWords / 120) * 3;
	const actualMinutes = workDuration === undefined ? undefined : workDuration / 60000;
	const speedup =
		actualMinutes && actualMinutes > 0
			? `${(manualMin / actualMinutes).toFixed(1)}x-${(manualMax / actualMinutes).toFixed(1)}x`
			: "unknown";

	const sessionId = header?.id ?? ctx.sessionManager.getSessionId();
	const lines: string[] = [
		"# Pi Session Report",
		"",
		"## Scope",
		`- Session: ${sessionId || "unknown"}`,
		`- Scope: ${options.scope === "all" ? "full session file" : "current branch"}`,
		`- CWD: ${header?.cwd ?? ctx.cwd}`,
		`- Started: ${formatDate(range.start)}`,
		`- Last event: ${formatDate(range.end)}`,
		`- Elapsed session time: ${formatDuration(elapsedDuration)}`,
		`- Work time from first prompt: ${formatDuration(workDuration)}`,
		"",
		"## Model",
	];

	if (modelTotals.size === 0 && modelChanges.length === 0) {
		lines.push("- Model: unknown");
	} else {
		for (const [model, stats] of [...modelTotals.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
			lines.push(`- ${model}: ${stats.calls} LLM call(s), ${formatNumber(stats.usage.input)} input / ${formatNumber(stats.usage.output)} output tokens`);
		}
		if (modelChanges.length > 0) {
			lines.push("", "Model changes:");
			for (const change of modelChanges) {
				lines.push(`- ${change}`);
			}
		}
	}

	lines.push(
		"",
		"## Tokens",
		`- Input tokens: ${formatNumber(totalUsage.input)}`,
		`- Output tokens: ${formatNumber(totalUsage.output)}`,
		`- Cache read tokens: ${formatNumber(totalUsage.cacheRead)}`,
		`- Cache write tokens: ${formatNumber(totalUsage.cacheWrite)}`,
		`- Total tokens: ${formatNumber(totalUsage.total || totalUsage.input + totalUsage.output + totalUsage.cacheRead + totalUsage.cacheWrite)}`,
		`- Cost: ${formatCost(totalUsage.cost)}`,
	);

	if (contextUsage) {
		const contextLabel =
			contextUsage.tokens === null || contextUsage.percent === null
				? "unknown"
				: `${formatNumber(contextUsage.tokens)} / ${formatNumber(contextUsage.contextWindow)} (${Math.round(contextUsage.percent)}%)`;
		lines.push(`- Current context usage: ${contextLabel}`);
	}

	lines.push(
		"",
		"## Calls And Prompts",
		`- LLM calls: ${formatNumber(llmCalls.length)}`,
		`- User prompts: ${formatNumber(prompts.length)}`,
		`- Tool calls requested by the model: ${formatNumber(totalToolCalls)}`,
		`- Tool results: ${formatNumber(toolResultCount)}`,
		"",
		"## Time Without LLM",
		`- Estimated manual time for similar work: ${formatHumanTime(manualMin)} to ${formatHumanTime(manualMax)}`,
		`- Estimated speedup vs recorded work time: ${speedup}`,
		"- Method: heuristic based on prompt count, LLM calls, tool calls, and generated output length. Treat as an order-of-magnitude estimate, not accounting data.",
		"",
		"## LLM Call Detail",
	);

	if (llmCalls.length === 0) {
		lines.push("- No assistant messages with usage metadata found.");
	} else {
		lines.push("| # | Time | Model | Input | Output | Total | Tool calls | Stop |");
		lines.push("|---|---|---|---:|---:|---:|---:|---|");
		for (const call of llmCalls) {
			const total = call.usage.total || call.usage.input + call.usage.output + call.usage.cacheRead + call.usage.cacheWrite;
			lines.push(
				`| ${call.index} | ${call.timestamp ?? "unknown"} | ${modelLabel(call.provider, call.model)} | ${formatNumber(call.usage.input)} | ${formatNumber(call.usage.output)} | ${formatNumber(total)} | ${formatNumber(call.toolCalls)} | ${call.stopReason ?? ""} |`,
			);
		}
	}

	lines.push("", "## Turn Detail");
	if (turns.length === 0) {
		lines.push("- No user turns found.");
	} else {
		lines.push("| # | Duration | LLM calls | Tool calls | Input | Output | Prompt preview |");
		lines.push("|---|---:|---:|---:|---:|---:|---|");
		for (const turn of turns) {
			const duration = turn.start && turn.end ? formatDuration(turn.end.getTime() - turn.start.getTime()) : "unknown";
			const preview = truncateText(turn.prompt.replace(/\s+/g, " "), 120).replace(/\|/g, "\\|");
			lines.push(
				`| ${turn.index} | ${duration} | ${formatNumber(turn.llmCalls)} | ${formatNumber(turn.toolCalls)} | ${formatNumber(turn.usage.input)} | ${formatNumber(turn.usage.output)} | ${preview} |`,
			);
		}
	}

	lines.push("", "## Prompt Detail");
	if (prompts.length === 0) {
		lines.push("- No user prompts found.");
	} else {
		for (const prompt of prompts) {
			lines.push(
				"",
				`### Prompt ${prompt.index}`,
				`- Time: ${prompt.timestamp ?? "unknown"}`,
				`- Size: ${formatNumber(prompt.chars)} chars, ${formatNumber(prompt.words)} words`,
				"",
				"```text",
				fencedText(prompt.text),
				"```",
			);
		}
	}

	if (!usageHasValues(totalUsage)) {
		lines.push(
			"",
			"## Limits",
			"- Token usage metadata was not found in assistant messages. This can happen for old sessions, unsupported providers, or messages created before usage tracking was available.",
		);
	}

	return `${lines.join("\n")}\n`;
}

function slug(value: string): string {
	const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
	return cleaned || "unknown";
}

function reportFilename(ctx: ExtensionCommandContext): string {
	const header = ctx.sessionManager.getHeader();
	const cwd = header?.cwd ?? ctx.cwd;
	const sessionId = (header?.id ?? ctx.sessionManager.getSessionId() ?? "unknown").slice(0, 8);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${slug(basename(cwd))}_pi_report_${stamp}_${sessionId}.md`;
}

function parseReportOptions(args: string): ReportOptions {
	const tokens = args.trim().split(/\s+/).filter(Boolean).map((token) => token.toLowerCase());
	return {
		scope: tokens.includes("all") ? "all" : "branch",
		destination: tokens.includes("show") ? "show" : tokens.includes("copy") ? "copy" : "save",
	};
}

function getReportCompletions(prefix: string) {
	const tokens = prefix.trim().split(/\s+/).filter(Boolean);
	const current = tokens[tokens.length - 1] ?? "";
	return REPORT_COMMANDS.filter((command) => command.startsWith(current)).map((command) => ({
		value: command,
		label: command,
	}));
}

export default function reportExtension(pi: ExtensionAPI): void {
	pi.registerCommand("report", {
		description: "Extract a Pi session report with model, token usage, prompts, timing, and estimated manual effort",
		getArgumentCompletions: (prefix) => getReportCompletions(prefix),
		handler: async (args, ctx) => {
			const options = parseReportOptions(args);
			const report = buildReport(ctx, options);

			if (options.destination === "copy") {
				try {
					execSync("pbcopy", { input: report });
					ctx.ui.notify(`Report copied to clipboard (${options.scope})`, "info");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Failed to copy report: ${message}`, "error");
				}
				return;
			}

			if (options.destination === "save") {
				try {
					if (!existsSync(REPORT_OUTPUT_DIR)) mkdirSync(REPORT_OUTPUT_DIR, { recursive: true });
					const outputPath = join(REPORT_OUTPUT_DIR, reportFilename(ctx));
					writeFileSync(outputPath, report, "utf-8");
					ctx.ui.notify(`Markdown report saved: ${outputPath}`, "info");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Failed to save report: ${message}`, "error");
				}
				return;
			}

			pi.sendMessage(
				{
					customType: "pi-report",
					content: report,
					display: true,
				},
				{ triggerTurn: false },
			);
		},
	});
}
