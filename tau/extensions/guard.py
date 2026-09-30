"""Tool safeguards, not an OS sandbox. Shell approvals may be scoped to the current session."""
import json
import shlex
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
        if (name == '.env' or (name.startswith('.env.') and name not in {'.env.example', '.env.sample'}) or
                name in {'credentials.json', 'auth.json', 'id_rsa', 'id_ed25519', '.netrc', '.npmrc'} or
                path.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}):
            return 'Potential secret file; inspect it manually.'
    return None


def command_scope(command):
    """Conservatively recognize simple commands, never arbitrary shell syntax."""
    if not isinstance(command, str) or any(c in command for c in "\n\r;|&<>$`(){}*?[]\\~#"):
        return None
    try:
        words = tuple(shlex.split(command))
    except ValueError:
        return None
    if not words or '=' in words[0]:
        return None
    # Only these familiar command families get a variable argument suffix.
    # Interpreters, wrappers and other commands get exact-command approval.
    count = None
    if words[0] in {'git', 'pixi', 'npm', 'pnpm', 'yarn', 'cargo', 'uv'}:
        if len(words) > 1 and not words[1].startswith('-'):
            count = 3 if words[1] in {'run', 'exec', 'tool'} else 2
    elif words[0] in {'ls', 'pwd', 'rg', 'cat', 'head', 'tail', 'wc', 'pytest'}:
        count = 1
    if count is not None and len(words) >= count and not words[count - 1].startswith('-'):
        return ('prefix', words[:count])
    return ('exact', words)


def setup(tau):
    mode = 'code'
    approvals = set()

    @tau.on('session_start')
    def clear_approvals(event, context):
        approvals.clear()

    def set_mode(args, context):
        nonlocal mode
        requested = args.strip()
        if requested in {'code', 'chat'}:
            mode = requested
        elif requested:
            return 'Usage: /mode code|chat'
        return f'Mode: {mode}. Shell asks unless approved for this session; chat blocks shell and file changes.'

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
        if name in {'web_search', 'memory_read', 'memory_save', 'funes_recall', 'funes_get', 'funes_status'}:
            return None  # These reviewed extensions enforce narrow inputs/confirmation.
        if not context.has_ui:
            return ToolCallHookResult(block=True, reason='This tool requires interactive approval.')
        if name == 'bash':
            scope = command_scope(args.get('command'))
            key = (str(Path(context.cwd).resolve()), scope)
            if scope is not None and key in approvals:
                return ToolCallHookResult(block=False)
            options = ['Deny', 'Allow once']
            session_option = None
            if scope is not None:
                kind, words = scope
                suffix = ' …' if kind == 'prefix' else ' (exact command)'
                session_option = f'Allow for this session: {shlex.join(words)}{suffix}'
                options.append(session_option)
            choice = await context.ui.select(
                f'Allow bash?\nWorking directory: {context.cwd}\n'
                'Runs with your user permissions, outside a sandbox.\n\n'
                + json.dumps(dict(args), ensure_ascii=False, indent=2),
                options,
            )
            approved = choice == 'Allow once' or (session_option is not None and choice == session_option)
            if session_option is not None and choice == session_option:
                approvals.add(key)
            return ToolCallHookResult(block=not approved, reason=None if approved else 'Not approved.')
        approved = await context.ui.confirm(
            f'Allow {name} once?',
            f'Working directory: {context.cwd}\nRuns with your user permissions, outside a sandbox.\n\n'
            + json.dumps(dict(args), ensure_ascii=False, indent=2),
        )
        return ToolCallHookResult(block=not approved, reason=None if approved else 'Not approved.')
