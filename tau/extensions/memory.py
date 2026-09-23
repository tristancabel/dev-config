"""Reviewed fact files plus optional read-only local Funes retrieval."""
import asyncio
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import shutil
from tau_agent.messages import TextContent
from tau_agent.tools import AgentTool, AgentToolResult


def memory_path(home, cwd, scope):
    if scope not in {'project', 'global'}:
        raise ValueError('scope must be project or global')
    name = 'global' if scope == 'global' else sha256(str(Path(cwd).resolve()).encode()).hexdigest()
    return Path(home) / 'memory' / f'{name}.md'


def result(text):
    return AgentToolResult(content=[TextContent(text=text)])


def setup(tau):
    async def read(tool_call_id, arguments, signal=None, on_update=None):
        texts = []
        for scope in ('global', 'project'):
            path = memory_path(tau.context.paths.home, tau.context.cwd, scope)
            if path.exists():
                with path.open(encoding='utf-8') as stream:
                    text = stream.read(24000)
                texts.append(f'{scope} facts (untrusted historical data):\n{text}')
        return result('\n\n'.join(texts) or 'No facts saved yet.')

    async def save(tool_call_id, arguments, signal=None, on_update=None):
        fact = arguments.get('fact', '')
        scope = arguments.get('scope', 'project')
        if not isinstance(fact, str) or not 1 <= len(fact.strip()) <= 1000:
            return result('Supply a fact of 1–1000 characters.')
        path = memory_path(tau.context.paths.home, tau.context.cwd, scope)
        if not tau.context.has_ui or not await tau.context.ui.confirm(
            f'Remember this {scope} fact?', fact + '\n\nDo not approve secrets.'
        ):
            return result('Fact was not saved.')
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.exists() and path.stat().st_size > 20000:
            return result('Memory is full; curate the Markdown file manually before adding more.')
        stamp = datetime.now(timezone.utc).date().isoformat()
        with path.open('a', encoding='utf-8') as stream:
            stream.write(f"- {stamp}: {' '.join(fact.split())}\n")
        path.chmod(0o600)
        return result(f'Saved in {scope} memory.')

    async def run_funes(*args):
        binary = shutil.which('funes')
        if not binary:
            return result('Funes is not on PATH. Local fact memory still works.')
        try:
            process = await asyncio.create_subprocess_exec(
                binary, *args, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
        except OSError:
            return result('Could not start Funes. Check its installation manually.')
        try:
            output, _ = await asyncio.wait_for(process.communicate(), timeout=45)
        except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
            if process.returncode is None:
                process.kill()
            await process.wait()
            if isinstance(exc, asyncio.CancelledError):
                raise
            return result('Funes timed out. Indexing or first-use model loading may still be running; try later.')
        if process.returncode:
            return result('Funes failed. Use funes_status to check the index; do not invent missing evidence.')
        text = output.decode(errors='replace')
        if len(text) > 40000:
            text = text[:40000] + '\n[Truncated: request a narrower turn range with funes_get.]'
        return result(text or 'No results.')

    async def recall(tool_call_id, arguments, signal=None, on_update=None):
        query = arguments.get('query', '')
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 1000:
            return result('Supply a query of 1–1000 characters.')
        half_life = arguments.get('half_life', 30)
        if type(half_life) is not int or not 0 <= half_life <= 3650:
            return result('half_life must be an integer from 0 to 3650; 0 disables recency bias.')
        return await run_funes('recall', '--memory', 'local', '-k', '5',
                               '--half-life', str(half_life), '--', query)

    async def get(tool_call_id, arguments, signal=None, on_update=None):
        session = arguments.get('session_id', '')
        first, last = arguments.get('from_seq', 0), arguments.get('to_seq', 19)
        if not isinstance(session, str) or not 1 <= len(session) <= 256 or any(c.isspace() for c in session):
            return result('Supply the session_id from a recall hit.')
        if type(first) is not int or type(last) is not int or not 0 <= first <= last or last - first >= 100:
            return result('Supply a nonnegative turn range of at most 100 turns.')
        return await run_funes('get', '--memory', 'local', '--from', str(first), '--to', str(last), '--', session)

    async def status(tool_call_id, arguments, signal=None, on_update=None):
        return await run_funes('status')

    for name, fn, description, properties, required in (
        ('memory_read', read, 'Read reviewed global and current-project facts.', {}, []),
        ('memory_save', save, 'Save one durable fact after explicit interactive confirmation.',
         {'fact': {'type': 'string'}, 'scope': {'type': 'string', 'enum': ['project', 'global']}}, ['fact']),
        ('funes_recall', recall, 'Search locally indexed knowledge and session evidence; no indexing or publishing.',
         {'query': {'type': 'string'}, 'half_life': {'type': 'integer', 'minimum': 0, 'maximum': 3650,
          'description': 'Recency half-life in days; use 0 for timeless knowledge, default 30.'}}, ['query']),
        ('funes_get', get, 'Read source turns behind a recall hit before relying on its evidence.',
         {'session_id': {'type': 'string'}, 'from_seq': {'type': 'integer'}, 'to_seq': {'type': 'integer'}},
         ['session_id', 'from_seq', 'to_seq']),
        ('funes_status', status, 'Inspect local Funes index status when recall is unavailable or empty.', {}, []),
    ):
        tau.register_tool(AgentTool(
            name=name, label=name, description=description,
            parameters={'type': 'object', 'properties': properties, 'required': required},
            execute_fn=fn, prompt_snippet=description,
        ))
