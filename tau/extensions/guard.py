"""Tool safeguards, not an OS sandbox. All shell commands require approval."""
import json
from pathlib import Path
from tau_coding.extensions import ToolCallHookResult


def file_problem(raw, cwd, tau_home):
    if not isinstance(raw, str) or not raw:
        return 'Missing file path.'
    root = Path(cwd).resolve()
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root):
        return 'File access is restricted to the current project.'
    protected = {'.git', '.tau', '.agents', '.ssh', '.aws', '.gnupg', '.kube'}
    for path in (candidate, resolved):
        if path.is_relative_to(Path(tau_home).resolve()):
            return 'Tau configuration and runtime data are protected.'
        if any(p.lower() in protected for p in path.parts):
            return 'Protected configuration or credential directory.'
        name = path.name.lower()
        if (name == '.env' or name.startswith('.env.') or
                name in {'credentials.json', 'auth.json', 'id_rsa', 'id_ed25519', '.netrc', '.npmrc'} or
                path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}):
            return 'Potential secret file; inspect it manually.'
    return None


def setup(tau):
    mode = 'code'

    def set_mode(args, context):
        nonlocal mode
        requested = args.strip()
        if requested in {'code', 'chat'}:
            mode = requested
        elif requested:
            return 'Usage: /mode code|chat'
        return f'Mode: {mode}. Shell always asks; chat blocks shell and file changes.'

    tau.register_command('mode', set_mode, description='Show or change code/chat safeguards')

    @tau.on('tool_call')
    async def guard(event, context):
        name, args = event.tool_name, event.arguments
        if name in {'read', 'write', 'edit'}:
            reason = file_problem(args.get('path'), context.cwd, context.paths.home)
            if reason:
                return ToolCallHookResult(block=True, reason=reason)
            if mode == 'chat' and name != 'read':
                return ToolCallHookResult(block=True, reason='Chat mode blocks file changes.')
            return None
        if name == 'bash' and mode == 'chat':
            return ToolCallHookResult(block=True, reason='Chat mode blocks shell execution.')
        if name in {'web_search', 'memory_read', 'memory_save', 'funes_recall'}:
            return None  # These reviewed extensions enforce narrow inputs/confirmation.
        if not context.has_ui:
            return ToolCallHookResult(block=True, reason='This tool requires interactive approval.')
        approved = await context.ui.confirm(
            f'Allow {name} once?',
            f'Working directory: {context.cwd}\nRuns with your user permissions, outside a sandbox.\n\n'
            + json.dumps(dict(args), ensure_ascii=False, indent=2),
        )
        return ToolCallHookResult(block=not approved, reason=None if approved else 'Not approved.')
