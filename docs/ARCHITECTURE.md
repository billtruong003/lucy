# Architecture

[Tiếng Việt](vi/ARCHITECTURE.md)

## Goals

1. **One install, one process.** `lucy start` runs everything a single user needs. Splitting processes (e.g. a remote worker) is an option, never a requirement.
2. **Assistant and agent engine are both first-class.** Chat with memory is the everyday surface. The card engine is a library you can drive from chat, the web board, or your own code.
3. **Everything personal is data, not code.** Owner name, persona, language, vault layout, schedules and model catalog live in config and the vault, never in source.
4. **Safe by default.** Binds to localhost, refuses unknown chat users, and does not run Claude with bypassed permissions unless you opt in.
5. **Bilingual.** Every user-facing string and system prompt exists in `en` and `vi`.

## Stack

TypeScript everywhere (Node 20+, ESM), managed as a pnpm workspace.

Lucy used to run a Python Telegram bridge beside TypeScript services. The rebuild ports the bridge to TypeScript for three reasons. It gives one install and one config schema. Channels can call `core` and `memory` in-process instead of over HTTP. And the Claude Agent SDK is first-class in TypeScript.

Storage is SQLite (`better-sqlite3` + `sqlite-vec`) for indexes, sessions and the board, plus the Markdown vault for memory. There is no external database to run.

## Layout

```
packages/
  config/    schema (zod) + loader: lucy.config.yaml + .env → typed Config
  i18n/      message catalogs and prompt templates (en, vi)
  core/      Claude session manager (persistent SDK clients, interrupt, rotation),
             personas, prompt assembly, permission policy, usage accounting
  memory/    vault I/O, recall (FTS5 + vector + rerank), signals/evidence,
             dream (consolidation), redaction; embedder is pluggable
  engine/    cards, board, pipelines, workers, autopilot, budgets, token guard
  llm/       one OpenAI-compatible adapter + user-defined catalog + router
  server/    HTTP API (routes per feature), auth/sessions, SSE, scheduler
apps/
  cli/       lucy init | start | doctor | dream | reindex
  web/       React app
  telegram/  channel adapter
plugins/     opt-in integrations (google, discord, market data, …)
vault-template/
deploy/      docker-compose, systemd, pm2 and nginx examples
```

### Dependency direction

```
config, i18n  ←  memory, llm  ←  core  ←  engine  ←  server  ←  apps/*
                                                     plugins → (public package APIs only)
```

Packages only import each other's public `index.ts`. Apps never reach into another package's `src/`. Plugins register through the plugin API, never by path.

## Runtime

```
lucy start
 ├─ server        HTTP :8800 (127.0.0.1 by default), web assets, SSE
 ├─ channels      telegram (long-poll), web; each implements ChannelAdapter
 ├─ worker(s)     claim cards from the board in-process (concurrency configurable)
 ├─ scheduler     cron-style automations; nightly dream
 └─ memory index  file watcher → incremental reindex
```

A message from any channel follows one path:

1. Channel adapter → `core.handle(turn)`.
2. Recall gate decides whether memory is needed, then `memory.recall` returns ranked snippets.
3. Prompt assembly: persona + language + recalled context + session.
4. A Claude session (persistent per conversation) streams the reply back through the adapter.
5. Post-turn: usage is recorded and signals are written to the vault inbox for the next dream.

Larger jobs become cards (`engine.createCard`), and their progress is posted back to the originating conversation.

## Configuration

- `lucy.config.yaml` holds non-secret settings: owner, language, persona, vault path, channels, models, budgets, schedules, plugins.
- `.env` holds secrets only (Telegram token, web password hash, provider keys).
- `lucy doctor` validates both against the schema and explains every missing or invalid value.

The old code had about 130 scattered `LUCY_*`/`AM_*` flags. The rebuild keeps a small documented set. Experimental behaviour goes behind `experimental:` in config, not env flags.

## Security model

- The server binds `127.0.0.1`. Public exposure goes through a reverse proxy with TLS (examples in `deploy/`).
- Web auth uses a hashed password, server-side sessions with expiry, rate-limited login and optional TOTP.
- Channels only answer allow-listed user IDs.
- Claude permission policy defaults to an explicit tool allow-list per persona. `bypassPermissions` is an opt-in per persona with a startup warning.
- Workers run cards in per-card git worktrees.
- Secrets are redacted before anything is written to the vault or logs.

## Carried over from the private Lucy

| Kept and refactored | From |
|---|---|
| Persistent Claude session engine (interrupt, rotation, carry-over) | `bridge/lucy_bridge.py` (port to TS) |
| Recall (FTS5 + vector + rerank), dream, signals/evidence, redaction, consolidation | `agent-machine/src/{recall,dream,signal,evidence,redact,consolidate}.ts` |
| Card engine, workers, autopilot, budgets, token guard | `agent-machine/src/{engine,worker,runner,autopilot,budget,token-guard}.ts` |
| Lane router (collapsed to one adapter) | `agent-machine/src/{llm-lane,chat-lane,lane-chat,lane-runner}.ts` |
| Chat, memory, schedule, settings UI (redesigned) | `hub/web` |
| Lucy-original skills | `skills/lucy`, `skills/web-composition` |

Dropped: personal briefs and trading, client projects, the Hermes plugin, the legacy portal, the VPS-cleaning UI, the drawing canvas, and the vendored third-party skills (users install skills themselves; Lucy ships a curated few with attribution).
