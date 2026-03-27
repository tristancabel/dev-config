export default {
  name: "ast-python",
  before_agent_start: async () => {
    if (process.env.PI_LANG_PYTHON !== "1") return {};

    return {
      systemPromptAppend: `
PYTHON RULES:
- Prefer libcst-style safe edits
- Avoid breaking imports/indentation
- Keep diffs minimal
- Assume ruff validation
`
    };
  }
}
