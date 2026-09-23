# Simple Tau setup

For **Hugging Face Tau (`tau-ai`) 0.4.4**, verified against the locally installed
package on 2026-09-23. This directory is prepared to become `~/.tau`; nothing here
installs software, creates symlinks, starts servers, or changes your existing Pi setup.
Run `./install.sh tau` from the repository root to install Tau and Funes (reusing
existing installations) and link configuration where destinations do not already exist.
Use `./install.sh tau --no-links` to manage symlinks yourself. The installer
preserves existing configuration directories; migrate them as described below.

## What changes from Pi

One assistant handles coding and conversation. There are no persona routers,
mandatory planning/acceptance loops, automatic subagents, automatic server launches,
or overlapping plugin stacks. Keep useful project instructions in `AGENTS.md` and
use the existing session history for unfinished work.

| Need | Implementation |
| --- | --- |
| Coding | Tau's read/write/edit/bash tools; existing Pixi conventions |
| Conversation | Normal chat; `/mode chat` disables shell and file changes |
| Web search | `web_search`: five Brave results with URLs and snippets |
| Durable facts | `memory_read` and confirmed `memory_save`, project/global scope |
| Old-session recall | Optional `funes_recall`, local index only |
| Safeguards | Project file boundary, protected paths, approval for every shell command |

My recommendation from the current upstream direction is to use a small harness,
a few focused tools, and explicit retrieval rather than recreate the Pi workflow
engine. This is a design recommendation, not a claim that a particular approach is
universally dominant. Tau explicitly favors small layers and ordinary tools;
Funes separates historical retrieval from the agent that reasons over it.
Sources: [Tau](https://github.com/huggingface/tau),
[Tau extensions](https://twotimespi.dev/guides/extensions/),
[Funes](https://github.com/huggingface/funes).

## Link it

**Your existing `~/.tau` contains credentials, sessions, and a custom `seraphim`
catalog. Keep it.** The least disruptive option is to link only these two resources
and retain all existing authentication/model settings:

```bash
# From this repository; commands intentionally refuse existing targets.
ln -s "$PWD/tau/extensions" "$HOME/.tau/extensions"
ln -s "$PWD/tau/APPEND_SYSTEM.md" "$HOME/.tau/APPEND_SYSTEM.md"
```

If either target already exists, inspect and back it up first; do not force the link.
In this arrangement facts remain in the existing `~/.tau/memory/` directory.
Your existing `seraphim` provider remains usable.

To link the **whole folder**, instead, back up the current directory and create the
link yourself (choose an unused backup name):

```bash
# From this repository; first check that ~/.tau.before-switch does not exist.
mv "$HOME/.tau" "$HOME/.tau.before-switch"
ln -s "$PWD/tau" "$HOME/.tau"
```

The old sessions and authentication remain in that backup, not the new Tau home.
To retain them, copy `sessions/` and `credentials.json` into the new home manually.
To retain provider preferences, first merge the backup's `catalog.toml` provider
entries into this catalog, then copy `providers.json`. Do not overwrite the new
catalog blindly. These runtime files and facts are ignored by Git.

Start from the project directory, not your home directory:

```bash
cd /path/to/project
tau
```

Use `/model` to select a provider/model. With the full-directory link, this catalog
adds `omlx` at `http://127.0.0.1:8000/v1`, with the model IDs from your current Pi
configuration. Start oMLX yourself and confirm that its served IDs match; the two
old Tau/Pi configurations used different names. Export `OMLX_API_KEY` if your
server requires authentication. Alternatively use Tau's `/login` and `/model` for
a hosted provider. No key is stored in the committed configuration.

## Everyday use

- `/mode` shows the guard state; `/mode code` is the startup default.
- `/mode chat` permits project reads, web search and memory, but blocks shell and edits.
- Ask normally: “Fix this test”, “Search for current documentation”, or
  “Remember that this project uses Pixi.”
- Saving a fact shows its exact text for approval, including in chat mode.
- Mode is session-local and resets to code on reload/new runtime. Check `/mode`
  after `/reload`, `/new`, or resuming a session.

### Search

Set `BRAVE_API_KEY` in your shell environment or secret manager before starting
Tau. Obtain a key from [Brave Search API](https://brave.com/search/api/); review its
current plan/pricing. This extension needs no Python dependencies beyond Tau.
Queries go to Brave; results are snippets, not fetched full pages. Missing keys or
network errors produce explicit tool messages. No arbitrary URL-fetch tool is
included. [API reference](https://api-dashboard.search.brave.com/app/documentation/web-search).

### Memory

Facts are small plain-text Markdown files under `~/.tau/memory/`, ignored by Git:
`global.md` for cross-project preferences, and a hash of the canonical working
directory for each project's facts. Launch from the same project root to reuse
its facts. Nothing is saved until you confirm it. The model retrieves facts on
demand through `memory_read`; they are not all injected into every prompt.

To correct or forget something, edit/delete its Markdown entry manually. A file
stops accepting additions at roughly 20 KB so it remains easy to curate. Existing
facts are historical data, not instructions. No automatic transcript recording,
embedding downloads, indexing, or cloud sync is added by these extensions.

Funes provides a second layer for **session evidence**, not the fact store.
The Tau installer installs its CLI using the [official installer](https://github.com/huggingface/funes#get-funes),
or reuses it when already installed. It does not automatically index or publish
sessions. For manual installation, follow the [official instructions](https://github.com/huggingface/funes).
Ensure `~/.local/bin` (or your `FUNES_INSTALL_DIR`) is on your shell PATH, then
deliberately index your Pi history:

```bash
funes index --harness pi
funes status
```

`funes_recall` invokes a fixed, read-only `funes recall --memory local` command
and supports `half_life=0` for reference material without recency bias.
`funes_get` opens the source turns behind a hit; `funes_status` checks index status.
Tau is instructed to retrieve relevant saved knowledge before repeating research,
verify important hits in context, and cite their provenance. These tools also work
in chat mode. No index is injected wholesale into the prompt.

If you index with a custom `FUNES_HOME`, export the same value before launching
Tau so it reads the same index. Otherwise it uses Funes's default `~/.funes`.
Restart Tau or run `/reload` after updating the extensions and prompt.
Try: “Use my indexed research on X, check the source context, and summarize it.”

All Funes tools run
without a shell. They never index or publish data. First Funes use may download
its retrieval models. Retrieved passages are supplied to whichever model provider
you selected, so “local index” does not imply a hosted model never sees excerpts.

There is currently no documented `funes add tau` or native Tau-session parser.
The extension can retrieve previously indexed Pi sessions, but **does not index
new Tau sessions**. Funes now provides a generic `.funes.jsonl` import contract;
a reviewed exporter would be the next step only if full session recall proves
useful. Start with explicit facts to keep this migration small.
Sources: [supported integrations](https://github.com/huggingface/funes/blob/main/docs/add.md),
[indexing/import contract](https://github.com/huggingface/funes/blob/main/docs/index.md),
[recall](https://github.com/huggingface/funes/blob/main/docs/recall.md).

## Safety boundary

The guard checks every model-issued tool call. File tools stay inside the resolved
current directory, including symlink resolution; known credential filenames and
configuration directories are denied. Regular project edits are allowed in code
mode. This is a conservative filename policy, not a secret detector.

**Every shell command asks**, including tests and apparently read-only commands.
Approval is once per call. Unknown tools also ask. Headless mode denies these
calls and memory writes because there is no interactive approval. No regex tries
to prove arbitrary shell code safe. Inspect commands before approving them:
a test, interpreter, script, Git hook, or package manager can execute other code.

This is **not an OS sandbox**. Approved shell commands inherit your filesystem,
network access, and environment. Direct terminal commands, trusted extensions,
Tau's own resource loading, `/login`, and other application actions are outside
this hook. Symlink races are not eliminated. Disabling extensions disables the
guard; extension load errors must be fixed before use. Keep project extensions
disabled and review global extensions before installing them. For untrusted repos
or unattended execution, use a container/VM with only the project mounted, no host
credentials, and restricted network access. That stronger isolation is not
configured here. [Tau's trust limitations](https://twotimespi.dev/guides/extensions/).

## Validation

Run with the Python interpreter from your Tau environment. For your current uv install:

```bash
~/.local/share/uv/tools/tau-ai/bin/python -B -m unittest discover -s tau/tests -v
```

Tests cover the real Tau extension loader/catalog schema, path traversal and
symlinks, protected files, interactive/headless shell gating, chat mode, memory
approval/persistence, and search configuration. Live provider responses, Brave
requests, and Funes execution require separately configured services and are not
part of these offline tests. Re-run after Tau upgrades.
