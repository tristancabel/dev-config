"""Forward interactive Tau lifecycle events to the installed Peon Ping hook."""
import asyncio
import json
import os
import shutil
from uuid import uuid4


def setup(tau):
    fallback_id = 'tau-' + uuid4().hex

    async def emit(name, context):
        if not context.has_ui or os.environ.get('TAU_PEON_PING', '1') == '0':
            return
        binary = shutil.which('peon')
        if not binary:
            return
        payload = json.dumps({
            'hook_event_name': name,
            'session_id': 'tau-' + str(context.session_id) if getattr(context, 'session_id', None) else fallback_id,
            'cwd': str(context.cwd),
            'source': 'tau',
        }).encode()
        try:
            process = await asyncio.create_subprocess_exec(
                binary, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
        except OSError:
            return
        try:
            await asyncio.wait_for(process.communicate(payload), timeout=3)
        except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
            if process.returncode is None:
                process.kill()
            await process.wait()
            if isinstance(exc, asyncio.CancelledError):
                raise

    for event, hook in (
        ('session_start', 'SessionStart'),
        ('agent_start', 'UserPromptSubmit'),
        ('agent_end', 'Stop'),
        ('session_shutdown', 'SessionEnd'),
    ):
        async def handler(event, context, hook=hook):
            await emit(hook, context)
        tau.on(event)(handler)
