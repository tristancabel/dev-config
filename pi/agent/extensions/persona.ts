import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function persona(pi: ExtensionAPI) {
  const roles = ["scout", "planner", "builder", "reviewer"];

  pi.registerCommand("persona", {
    description: "Switch persona",
    handler: async (args, ctx) => {
      let choice = args.trim();

      if (!roles.includes(choice)) {
        choice = await ctx.ui.select("Select persona", roles);
        if (!choice) return;
      }

      process.env.PI_MODE = choice;

      await ctx.agent.sendMessage({
        role: "system",
        content: `Switch to ${choice.toUpperCase()} mode`
      });

      ctx.ui.notify(`Persona: ${choice}`, "info");
    }
  });
}
