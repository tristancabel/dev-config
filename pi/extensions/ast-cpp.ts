export default {
  name: "ast-cpp",
  before_agent_start: async () => {
    if (process.env.PI_LANG_CPP !== "1") return {};

    const hasDB = process.env.PI_HAS_COMPILE_COMMANDS === "1";

    return {
      systemPromptAppend: `
C++ RULES (clangd mindset):

${hasDB ? `
- compile_commands.json available
- Full project awareness
` : `
- No compile DB → be conservative
`}

- Keep headers and sources consistent
- Respect CMake structure
- Avoid blind edits
`
    };
  }
}
