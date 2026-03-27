import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function autoPersona(pi: ExtensionAPI) {
  pi.onUserMessage(async (msg, ctx) => {
    const t = msg.toLowerCase();

    let target = null;

    if (t.match(/analyze|explore/)) target = "scout";
    else if (t.match(/plan|design/)) target = "planner";
    else if (t.match(/implement|fix|code/)) target = "builder";
    else if (t.match(/review|audit/)) target = "reviewer";

    if (!target || process.env.PI_MODE === target) return;

    const ok = await ctx.ui.confirm(`Switch to ${target}?`);
    if (!ok) return;

    process.env.PI_MODE = target;

    await ctx.agent.sendMessage({
      role: "system",
      content: `Switch to ${target.toUpperCase()}`
    });
  });
}
