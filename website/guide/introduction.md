# Introduction

Lucy is a self-hosted personal AI agent. It runs on your own Linux server, talks to you through Telegram and a web cockpit, keeps a long-term memory in plain Markdown files, and does larger jobs by handing them to a board of specialist agents. The thinking is done by Claude, through the Claude Code CLI and the Claude Agent SDK.

Lucy is built for one owner. Every entry point is locked to you: the Telegram bot answers only your user ID, and the web hub sits behind a password with optional two-factor login.

## What Lucy can do

| Area | What you get |
|---|---|
| **Chat** | Talk to Lucy from Telegram or the web hub. Replies stream in as they are written. Send a new message mid-reply to redirect her, or `/stop` to cut the reply off. Send photos and documents (PDF, DOCX, XLSX, CSV, …) and Lucy opens them with her tools. |
| **Memory** | A Markdown vault (Obsidian-compatible) is Lucy's brain. Before each turn she searches it for relevant notes (full-text search, plus optional vector search and reranking through Jina). Conversation turns are logged for cross-session recall, and a nightly "dream" job consolidates new signals into stable preferences. |
| **Agents & board** | Big jobs become *cards* on a Kanban-style board. A coordinator moves each card through a pipeline (for example engineering, research, blog) and hands each stage to a persona (engineer, reviewer, researcher, writer, …). A worker process runs the stages; an optional autopilot approves routine gates for you. |
| **Tools, skills & MCP** | In chat Lucy uses Claude Code's native tools (read/write files, shell, web). Agents can mount MCP servers: filesystem, web, read-only git, memory, and with credentials GitHub, Google (Gmail/Calendar/Drive/YouTube, read-only), Notion and market data. A library of Agent Skills lives in `skills/`. |
| **Automations** | Scheduled prompts from the hub (results can be pushed to Telegram), the nightly memory dream via cron, the autopilot for the board, and a token guard that throttles spending. |
| **Cheap model lanes** | Besides Claude, Lucy can route work to OpenAI-compatible providers (OpenRouter, Groq, Gemini, Cerebras, Mistral, Z.ai, Nous, OpenCode Zen). Personas can be pinned to a cheap "lane" model, and the token guard drops executors to a cheap lane when the daily soft limit is reached. |

## Architecture

All processes are declared in `ecosystem.config.cjs` and run under PM2. Each one listens only on `127.0.0.1`; nginx is the only thing exposed to the internet.

```text
                    ┌──────────────────────────── your server ───────────────────────────────┐
                    │                                                                        │
 Telegram ──────────┼─► lucy-bridge (Python) ── Claude Agent SDK ──► Anthropic API           │
 (you)              │       │   one live Claude session per chat     (direct, no proxy)      │
                    │       │                                                                │
                    │       ├──► lucy-coordinator :8780 ◄──── lucy-vps-worker ──► Claude /    │
                    │       │      recall index, board,  ◄──── lucy-autopilot     cheap lanes │
                    │       │      token guard, personas            │                         │
                    │       │             │                         ▼                         │
                    │       │             ▼                  lucy-pxpipe :47821 ──► Anthropic │
                    │       └──────► lucy-vault/  (Markdown memory, its own git repo)         │
                    │                     ▲                                                  │
 Browser ── nginx ──┼─► lucy-hub :8800 ───┘  (web cockpit: chat, board, brain, schedules)    │
   (HTTPS)          │                                                                        │
                    │  cron 02:00 ─► bridge/cron_dream.sh (consolidate memory + reindex)    │
                    └────────────────────────────────────────────────────────────────────────┘
```

### How a Telegram message flows

1. **Poll.** `lucy-bridge` long-polls Telegram (`getUpdates`). Messages from anyone other than `LUCY_ALLOWED_USER_ID` are dropped. `/stop` and `/restart` are handled immediately; everything else goes into a per-chat queue.
2. **Recall.** In parallel, the bridge asks the coordinator's `/recall` endpoint for relevant vault notes. A cheap gate skips recall for corrections and pure follow-ups ("no, I meant…", "option 2"), and hits below a relevance score are dropped.
3. **Think.** The message, the recall block and a few per-turn hints go to a *persistent* Claude session for that chat (Claude Agent SDK client, `claude_code` system preset plus `bridge/persona.md`). The vault is added as an extra working directory, so Lucy can read and write notes with her normal tools.
4. **Stream.** Text deltas are streamed back by editing the Telegram message in place.
5. **Remember.** The turn is logged to the coordinator (episodic memory) and its token usage is reported to the shared token guard. When a session fills about 70% of the context window, the bridge rotates to a fresh session and carries the recent thread over.

The web hub follows a similar path with its own chat history, and adds the board, the memory views and the schedules.

::: tip Why chat bypasses pxpipe
`lucy-pxpipe` is a local token-compression proxy for the high-volume worker and autopilot traffic. Chat deliberately goes straight to Anthropic: compression was found to strip the persona that is appended to the system prompt. See [Operations](./operations#lucy-forgets-who-she-is).
:::

## Components

| Process (PM2 name) | Directory | Port | Role |
|---|---|---|---|
| `lucy-bridge` | `bridge/` | — | Telegram ↔ Claude. Persistent session per chat, recall prefetch, file intake, commands. |
| `lucy-coordinator` | `agent-machine/` | 8780 | Central API: memory recall and indexing, board (cards, projects, pipelines), personas, model lanes, token guard. |
| `lucy-vps-worker` | `agent-machine/` | — | Claims card stages from the coordinator and runs them with Claude or a cheap lane. |
| `lucy-autopilot` | `agent-machine/` | — | Approves, rejects or answers routine card gates (never deploy/security gates). |
| `lucy-hub` | `hub/server/` | 8800 | Web cockpit: serves the built React UI and the `/api` used by it. |
| `lucy-pxpipe` | `pxpipe/` | 47821 | Token-compression proxy used by the worker, autopilot and hub. |
| `noteflow-view` | `agent-machine/` | 8090 | Static viewer for one card workspace. Specific to the original install; you can drop it. |

| Data | Default location | Contents |
|---|---|---|
| Vault | `~/lucy/lucy-vault` | Markdown memory. Search index in `.index/memory.db` (rebuildable). |
| Coordinator data | `AM_DATA` | Board state, token ledger. |
| Hub state | `LUCY_STATE` (`~/.lucy-hub`) | 2FA secret, schedules, event log, chat history. |
| Bridge state | `~/.lucy-bridge-*.json` | Chat→session map, Telegram offset, per-chat preferences, status. |

## Telegram commands

| Command | Effect |
|---|---|
| *(plain message)* | Chat with Lucy. |
| `/new` | Start a fresh session (forget the current thread). |
| `/stop` | Clear queued messages and interrupt the reply in progress. |
| `/model`, `/persona` | Choose the chat model (a Claude model, a cheap lane, or `auto`) or a persona overlay for this chat. |
| `/think on\|off` | Show or hide the reasoning block of lane models that expose it. |
| `/prompt <task>` | Have the Prompt Architect turn a rough request into a polished prompt. |
| `/fan`, `/orch`, `/auto` | Run tasks in parallel, as plan → sub-agents → synthesis, or in an autonomous loop. |
| `/ctx`, `/info`, `/token`, `/id` | Inspect context usage, engine, token usage, your chat and user ID. |
| `/restart` | Restart the bridge through PM2. |

More in [Telegram](./telegram).

## Where to go next

- [Installation](./installation) — set up a server from scratch.
- [Configuration](./configuration) — every environment variable.
- [Operations & troubleshooting](./operations) — PM2, logs, updates, backups, common failures.
- [Memory](./memory), [Agents & board](./agents), [Models](./models), [Skills & MCP](./skills-mcp) — how the parts work.
- [Security](./security) — what is locked down and what you should know before exposing Lucy.
