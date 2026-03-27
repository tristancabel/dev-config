import { readdirSync, existsSync } from "fs";
import { join } from "path";

function detect(root: string) {
  const files = readdirSync(root);

  return {
    python: files.some(f => f.endsWith(".py")),
    cpp: files.some(f => f.match(/\.(c|cpp|cc|cxx|h|hpp)$/)),
    compile: existsSync(join(root, "compile_commands.json"))
  };
}

export default {
  name: "lang-detect",
  before_agent_start: async () => {
    const d = detect(process.cwd());

    process.env.PI_LANG_PYTHON = d.python ? "1" : "0";
    process.env.PI_LANG_CPP = d.cpp ? "1" : "0";
    process.env.PI_HAS_COMPILE_COMMANDS = d.compile ? "1" : "0";

    return {
      systemPromptAppend: `
LANGUAGES:
- Python: ${d.python}
- C++: ${d.cpp}
- compile_commands.json: ${d.compile}
`
    };
  }
}
