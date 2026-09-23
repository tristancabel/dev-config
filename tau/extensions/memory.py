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

    async def recall(tool_call_id, arguments, signal=None, on_update=None):
        query = arguments.get('query', '')
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 1000:
            return result('Supply a query of 1–1000 characters.')
        binary = shutil.which('funes')
        if not binary:
            return result('Funes is not installed. Local fact memory still works.')
        process = await asyncio.create_subprocess_exec(
            binary, 'recall', '--memory', 'local', '-k', '5', '--', query,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            output, _ = await asyncio.wait_for(process.communicate(), timeout=45)
        except BaseException:
            if process.returncode is None:
                process.kill()
            await process.wait()
            raise
        if process.returncode:
            return result('Funes recall failed. Check `funes status` and the local index manually.')
        return result(output.decode(errors='replace')[:24000] or 'No memories found.')

    for name, fn, description, properties, required in (
        ('memory_read', read, 'Read reviewed global and current-project facts.', {}, []),
        ('memory_save', save, 'Save one durable fact after explicit interactive confirmation.',
         {'fact': {'type': 'string'}, 'scope': {'type': 'string', 'enum': ['project', 'global']}}, ['fact']),
        ('funes_recall', recall, 'Search local Funes session history; no indexing or publishing.',
         {'query': {'type': 'string'}}, ['query']),
    ):
        tau.register_tool(AgentTool(
            name=name, label=name, description=description,
            parameters={'type': 'object', 'properties': properties, 'required': required},
            execute_fn=fn, prompt_snippet=description,
        ))
