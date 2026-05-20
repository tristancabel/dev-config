export default {
  name: "workflow",
  before_agent_start: async () => ({
    systemPromptAppend: `
WORKFLOW:

- conversation → answer and research only
- scout → explore only
- planner → clarify, research, and plan only
- builder → code focused changes; ask for planner when ambiguous
- reviewer → review only

If a request clearly belongs to another path, suggest or switch persona instead of refusing by default.
`
  })
}
