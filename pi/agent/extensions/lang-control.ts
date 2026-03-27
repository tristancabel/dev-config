import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function lang(pi: ExtensionAPI) {
  pi.registerCommand("lang", {
    description: "Toggle language",
    handler: async (args, ctx) => {
      const [l, s] = args.split(" ");
      const key = `PI_LANG_${l.toUpperCase()}`;

      if (!["python", "cpp"].includes(l)) {
        ctx.ui.notify("python|cpp", "error");
        return;
      }

      process.env[key] = s === "on" ? "1" : "0";
      ctx.ui.notify(`${l}: ${s}`, "info");
    }
  });
}
