export default {
  name: "workflow",
  before_agent_start: async () => ({
    systemPromptAppend: `
WORKFLOW:

- scout → explore only
- planner → plan only
- builder → code only
- reviewer → review only

If mismatch → refuse
`
  })
}
