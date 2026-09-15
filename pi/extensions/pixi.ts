import { existsSync } from "fs";
import { join } from "path";

export default {
  name: "pixi-integration",
  before_agent_start: async () => {
    const hasPixi = existsSync(join(process.cwd(), "pixi.toml"));
    if (!hasPixi) return {};

    return {
      systemPromptAppend: `
This project uses Pixi.

STRICT:
- ALWAYS use "pixi run"
- NEVER use pip/python/apt directly

ENFORCEMENT:
- Any invalid command must be rewritten
`
    };
  }
}
