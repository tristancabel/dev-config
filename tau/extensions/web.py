"""Brave search: a fixed HTTPS endpoint, no shell or arbitrary URL fetches."""
import asyncio
import json
import os
import urllib.parse
import urllib.request
from tau_agent.messages import TextContent
from tau_agent.tools import AgentTool, AgentToolResult


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def search(query):
    key = os.environ.get('BRAVE_API_KEY')
    if not key:
        return 'Set BRAVE_API_KEY in your shell before launching Tau to enable search.'
    url = 'https://api.search.brave.com/res/v1/web/search?' + urllib.parse.urlencode({'q': query, 'count': 5})
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'X-Subscription-Token': key})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=20) as response:
        payload = response.read(2_000_001)
    if len(payload) > 2_000_000:
        raise ValueError('Response too large')
    data = json.loads(payload)
    return json.dumps([
        {k: item.get(k, '') for k in ('title', 'url', 'description')}
        for item in data.get('web', {}).get('results', [])[:5]
    ], ensure_ascii=False)[:20000]


def setup(tau):
    async def execute(tool_call_id, arguments, signal=None, on_update=None):
        query = arguments.get('query', '')
        if (not isinstance(query, str) or not 1 <= len(query.strip()) <= 600
                or len(query.split()) > 75):
            text = 'Supply a query of 1–600 characters and at most 75 words.'
        else:
            try:
                text = await asyncio.to_thread(search, query)
            except Exception as exc:
                text = f'Search failed ({type(exc).__name__}); do not invent results.'
        return AgentToolResult(content=[TextContent(text=text)])
    tau.register_tool(AgentTool(
        name='web_search', label='Web search', description='Search public web via Brave; query leaves this machine.',
        parameters={'type': 'object', 'properties': {'query': {'type': 'string'}}, 'required': ['query']},
        execute_fn=execute, prompt_snippet='Search current public information and obtain source URLs.',
    ))
