export default {
  name: "workflow",
  before_agent_start: async () => ({
    systemPromptAppend: `
WORKFLOW:

- conversation → answer and research only
- scout → explore only
- dev-planner → clarify, research, and plan only
- builder → code focused changes; ask for dev-planner when ambiguous
- reviewer → review only

PATH COMMANDS:

- /path conversation → Q&A and web research
- /path dev → dev-planner-first development workflow
- /workflow status → show path, persona, plan status, web tools, and builder mode

If a request clearly belongs to another path, suggest or switch persona instead of refusing by default.
`
  })
}
