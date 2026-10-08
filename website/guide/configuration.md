# Configuration

Lucy is configured entirely through environment variables. This page lists every variable in the four example env files, plus the optional `LUCY_*` and `AM_*` flags the code reads.

## How configuration is loaded

`ecosystem.config.cjs` reads four files, merges them in this order, and passes the result to **every** PM2 process:

| Order | File | Typical contents | Template |
|---|---|---|---|
| 1 | `.env.llm` | LLM provider keys, Jina, MCP credentials | `.env.llm.example` |
| 2 | `agent-machine/.env` | Coordinator/worker token, budgets, concurrency | `agent-machine/.env.example` |
| 3 | `bridge/.env` | Telegram token, allowed user, persona, Claude CLI path | `bridge/.env.example` |
| 4 | `.env.runtime` | Hub password, vault and state paths, feature flags | `.env.runtime.example` |

Rules worth knowing:

- **A later file wins, even with an empty value.** `AM_TOKEN=` in `bridge/.env` blanks the token set in `agent-machine/.env`. Set shared variables (`AM_TOKEN`, `LUCY_SESSION_SUMMARY`) to the same value everywhere, or delete the empty line.
- **Shell variables are ignored.** Processes run with `filter_env: true`, so `export FOO=1` before `pm2 start` has no effect.
- **Some processes have fixed overrides** in `ecosystem.config.cjs`: the worker gets `AM_RUNNER=claude`, the autopilot `AM_AUTOPILOT_MAX=50`, pxpipe `HOST`, `PORT` and `PXPIPE_MODELS`, the bridge `PYTHONUNBUFFERED=1`.
- **A few components also read files directly.** The agent machine re-reads `~/lucy/.env.llm` (or `LLM_ENV_FILE`) and lets it override existing values. The bridge reads `bridge/.env` and the hub reads `hub/server/.env`, but those only fill in variables that are not already set.
- **PM2 only reads env at start.** After editing a file, recreate the process: `pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>`. See [Operations](./operations#after-changing-configuration).

Boolean flags accept `1`/`true`/`on` and `0`/`false`/`off`. Note the defaults: some flags are on unless you turn them off, others are off unless you turn them on.

**Required** variables are marked ✅.

## `.env.llm` — providers, memory, MCP

### Cheap model lanes

Keys for OpenAI-compatible providers used by the cheap lanes, persona lanes and the router. All optional: a lane is only offered when its key is present.

| Variable | Default | What it does |
|---|---|---|
| `OPENROUTER_API_KEY` | — | OpenRouter key. |
| `GROQ_API_KEY` | — | Groq key. |
| `GEMINI_API_KEY` | — | Google Gemini key (OpenAI-compatible endpoint). |
| `GEMINI_API_KEY_2` | — | Extra key for the same provider. Any provider key can have `_2` … `_8` variants, and each may hold comma-separated keys; they form a rotation pool. |
| `CEREBRAS_API_KEY` | — | Cerebras key. |
| `MISTRAL_API_KEY` | — | Mistral key. |
| `ZAI_API_KEY` | — | Z.ai key. |
| `NOUS_API_KEY` | — | Nous Portal key. |
| `OPENCODE_ZEN_API_KEY` | — | OpenCode Zen key. |

### Vector memory (Jina)

| Variable | Default | What it does |
|---|---|---|
| `JINA_API_KEY` | — | Enables vector search over the vault (hybrid with full-text search) and, with `LUCY_RERANK=1`, reranking. Without it recall is full-text only. |
| `JINA_EMBED_MODEL` | `jina-embeddings-v5-omni-nano` | Embedding model. |
| `JINA_EMBED_DIM` | `768` | Embedding dimension. Changing it requires a full reindex. |
| `JINA_RERANK_MODEL` | `jina-reranker-v2-base-multilingual` | Reranker model (not in the example file). |

### MCP servers for agents

These control the MCP servers mounted for agent runs (the worker). Chat uses Claude Code's native tools instead; see `LUCY_CHAT_MCP` below.

| Variable | Default | What it does |
|---|---|---|
| `LUCY_MCP` | off | Master switch. Nothing is mounted unless this is on. |
| `LUCY_MCP_<ID>` | depends | Per-server switch. Servers marked *live* default to on: `FS`, `WEB`, `GIT`, `MEMORY`, `GOOGLE`, `BINANCE`, `COINGECKO`. Servers marked *scaffold* default to off: `GITHUB`, `NOTION`, `TWELVEDATA`, `REGISTRY`. A server that needs credentials stays off until they are present. |
| `LUCY_MCP_GITHUB` | off | GitHub MCP server (via `npx @modelcontextprotocol/server-github`), code personas only. Needs `GITHUB_TOKEN`. |
| `GITHUB_TOKEN` | — | GitHub personal access token for the GitHub MCP server. |
| `LUCY_MCP_TWELVEDATA` | off | Twelve Data MCP (stocks, forex, gold), finance personas only. Needs `TWELVEDATA_API_KEY`. |
| `TWELVEDATA_API_KEY` | — | Twelve Data API key. |
| `LUCY_MCP_GOOGLE` | on | Read-only Google tools (Gmail search/read, Calendar, Drive search, YouTube). Needs `GOOGLE_REFRESH_TOKEN` and an OAuth client file. |
| `GOOGLE_REFRESH_TOKEN` | — | OAuth refresh token for the Google tools. |
| `GOOGLE_ACCESS_TOKEN` | — | Optional initial access token; it is refreshed automatically. |

Not in the example file but read by the code:

| Variable | Default | What it does |
|---|---|---|
| `GCP_OAUTH_FILE` | `~/lucy/.gcp-oauth.json` | Google OAuth client file (desktop client JSON). |
| `NOTION_TOKEN` | — | Notion internal integration token; enable with `LUCY_MCP_NOTION=on`. |
| `TWELVEDATA_MCP_URL` | `https://mcp.twelvedata.com/mcp` | Twelve Data MCP endpoint. |
| `COINGECKO_MCP_URL` | `https://mcp.api.coingecko.com/sse` | CoinGecko MCP endpoint (keyless). |
| `BINANCE_REST_URL` | `https://api.binance.com` | Binance public REST host (keyless). |
| `LLM_ENV_FILE` | `~/lucy/.env.llm` | Where the agent machine looks for this file. |

## `agent-machine/.env` — coordinator, worker, budgets

| Variable | Default (code) | Example | What it does |
|---|---|---|---|
| `AM_TOKEN` ✅ | — | — | Shared secret. Every coordinator endpoint except `/health` requires it in the `x-worker-token` header; the worker, autopilot, hub and bridge send it. If empty, the coordinator runs **without auth**. |
| `AM_PORT` | `8780` | `8780` | Coordinator port. |
| `AM_DATA` | `agent-machine/.data` | `/root/.agent-machine` | Board state and token ledger. |
| `AM_CAP_USD` | `20` | `9999` | Spend cap per budget window. |
| `AM_WEEKLY_CAP_USD` | `120` | `9999` | Weekly spend cap. |
| `AM_PER_CARD_USD` | `2` | `9999` | Spend limit per card (tripled for cards marked thorough). |
| `AM_CARD_HARD_USD` | `8` | `9999` | Per-card ceiling the autopilot respects when deciding whether a card may continue. |
| `AM_MAX_LANES` | `3` | `1` | Maximum cards in progress at the same time. |
| `AM_WORKER_CONCURRENCY` | `1` | `1` | Jobs run in parallel by one worker. |
| `AM_LEASE_MS` | `1200000` (20 min) | `3000000` | How long a worker holds a job before it is considered abandoned and requeued. |
| `LUCY_SESSION_SUMMARY` | off | `1` | Session summaries: when a chat session closes (`/new` or rotation), the bridge writes a compact summary note to `Brain/episodes/`. Must be on in both the bridge and the coordinator. |

::: tip The example disables the budgets
The example sets the dollar caps to `9999`, effectively turning them off and relying on the daily token guard instead. Lower them if you pay per token.
:::

Other agent-machine variables:

| Variable | Default | What it does |
|---|---|---|
| `AM_HOST` | `127.0.0.1` | Coordinator bind address. Keep it local. |
| `AM_CONFIG` | `agent-machine/config` | Personas, pipelines and model catalog. |
| `AM_WINDOW_MS` | 5 h | Length of the budget window for `AM_CAP_USD`. |
| `AM_SOFT_USD` | `14` | Soft spend warning within a window. |
| `AM_MAX_STAGE_VISITS` | `3` | How many times a card may revisit a stage (rework loops) before asking you. |
| `AM_TICK_MS` | `800` | Coordinator scheduling tick. |
| `AM_DAY_TOKEN_SOFT` | `800000000` | Daily token soft limit: executors drop to the cheapest lane and you are notified. |
| `AM_DAY_TOKEN_HARD` | `1500000000` | Daily token hard limit: no new cards; the bridge falls back to cheap lanes. |
| `AM_RUNNER` | `mock` | Worker mode. `claude` = Claude plus cheap lanes per persona (set by the ecosystem), `lane` = cheap lanes only, `mock` = no tokens, plumbing test. |
| `AM_POLL_MS` | `800` | Worker poll interval. |
| `AM_AUTOPILOT_MAX` | `100` (ecosystem: `50`) | Maximum autopilot decisions per process run. |
| `AM_AUTOPILOT_POLL_MS` | `6000` | Autopilot poll interval. |
| `AM_DIRECTOR_MODEL` | `opus` | Model the autopilot and triage use to decide. |
| `AM_SALVAGE_MODEL` | `sonnet` | Model that infers the outcome of a stage whose agent forgot to return the expected JSON result. |
| `AM_RATELIMIT_PARK_MS` | 5 min | How long a rate-limited lane is parked when the provider gives no `Retry-After`. |
| `AM_TURNS_LOG` | — | Directory for per-turn JSONL logs. Unset = no turn log. Also feeds `npm run stats:errors`. |
| `AM_SERVE_HOST`, `AM_SERVE_PORT`, `AM_SERVE_DIR` | `127.0.0.1`, `8090`, `.` | Settings for the `noteflow-view` static server. |

## `bridge/.env` — Telegram bridge

| Variable | Default | What it does |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` ✅ | — | Bot token from @BotFather. The bridge will not start without it. The hub and the dream cron also use it to push messages. |
| `LUCY_ALLOWED_USER_ID` ✅ | — | Your numeric Telegram user ID. **If empty, the bot answers everyone.** Also the default target for notifications. |
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI. Use the absolute path (`which claude`), because PM2 does not pass your shell `PATH`. |
| `LUCY_WORKDIR` | `~/lucy-workspace` | Working directory for chat sessions; downloaded photos and documents land here. |
| `LUCY_PERSONA` | `~/lucy/bridge/persona.md` | Persona appended to Claude's system prompt. |
| `LUCY_CLAUDE_TIMEOUT` | `900` | Seconds before a Claude turn is abandoned. Also used by the hub. |
| `RADIANT_BOT_API_URL`, `RADIANT_BOT_AGENT_SECRET` | — | Optional integration with an external Discord bot service (the hub's "Aki" tab). Leave empty. |
| `LUCY_BRIEF_DISCORD_CHANNEL`, `LUCY_TECH_DISCORD_CHANNEL`, `LUCY_TECH_DISCORD_THREAD` | — | Not read by the code in this repository. Leave empty. |
| `LUCY_TG_PROXY` | — | Proxy for Telegram API calls only, for networks that block Telegram (for example `socks5h://127.0.0.1:40000`). SOCKS needs `pip install requests[socks]`. |
| `LUCY_SESSION_SUMMARY` | off | See the agent-machine table. |
| `ANTHROPIC_BASE_URL` | — | Example: `http://127.0.0.1:47821` (pxpipe). Because the env is shared, this sends the worker, autopilot and hub through pxpipe. Bridge chat always removes it and goes direct. Delete it if you don't run pxpipe. |
| `AM_TOKEN` ✅ | — | Same value as in `agent-machine/.env`. Without it, recall and token reporting get `401`. |

### Bridge behaviour flags

All optional. Change them in `bridge/.env` (or `.env.runtime`) and recreate `lucy-bridge`.

| Variable | Default | What it does |
|---|---|---|
| `LUCY_BRIDGE_ENGINE` | `persist` | `persist` = one live Claude SDK client per chat (fastest). `sdk` = one-shot SDK call per message with session resume. `spawn` = run `claude -p` per message. Use these as rollback steps. |
| `LUCY_CHAT_MCP` | off | Load Claude Code's global MCP servers in chat. Off by default, because loading them adds seconds to every reply. |
| `LUCY_SDK_IDLE_S` | `1800` | Close an idle persistent client after this many seconds to save RAM. |
| `LUCY_ROTATE_CTX_PCT` | `70` | Rotate to a fresh session when context usage reaches this percentage (`0` = off). |
| `LUCY_ROTATE_TURNS` | `120` | Rotate after this many turns regardless. |
| `LUCY_ROTATE_CHECK_EVERY` | `5` | Check context usage every N turns. |
| `LUCY_RECENT_MAX` | `6` | Recent messages kept in RAM to carry the thread across a rotation. |
| `LUCY_STICKY_MAX` | `6` | Corrections and "remember this" messages that always survive rotation. |
| `LUCY_REPLY_KEEP` | `900` | Characters of Lucy's last reply carried across a rotation. |
| `LUCY_POLL_WATCHDOG_S` | `240` | If no successful Telegram poll for this long, the bridge exits so PM2 restarts it (`0` = off). |
| `LUCY_TOKEN_REPORT` | on | Report chat token usage to the shared token guard. |
| `LUCY_TOOL_POLICY` | on | Add a one-line hint per turn about whether tools are expected (stops Lucy running tools when you just want an opinion). |
| `LUCY_WRITE_GATE` | on | Warn Lucy not to store hypotheticals, examples or other people's statements as durable memory. |
| `LUCY_MEM_AUTHORITY`, `LUCY_GATE_ORDER`, `LUCY_CARRY_REPLY` | on | Rollback switches for context-handling behaviours (memory as evidence not command, gate ordering, carrying the last reply across rotation). |
| `LUCY_BUDGET_PERSONA` | `24000` | Character cap for persona plus overlay in the system prompt. |
| `LUCY_BUDGET_SEED` | `4000` | Character cap for the previous-session summary seeded into a new session. |
| `LUCY_AUTO_COMPRESS` | off | Legacy auto-rollover for the spawn path (summarise and restart after `LUCY_COMPRESS_TURN_MAX` turns or a token threshold). |
| `LUCY_COMPRESS_TURN_MAX`, `LUCY_COMPRESS_TOKEN_MAX`, `LUCY_COMPRESS_HEADROOM` | `40`, `0` (auto), `25000` | Thresholds for `LUCY_AUTO_COMPRESS`. |
| `LUCY_FLUSH_BEFORE_COMPRESS` | off | Before dropping an old session, give Claude one turn to save durable memory. |
| `LUCY_CLAUDE_HIST_MAX`, `LUCY_LANE_HIST_MAX` | `80`, `60` | Messages kept in the local transcript buffers. |
| `LUCY_PERSONA_DIR` | `~/lucy/agent-machine/config/personas` | Persona overlays offered by `/persona`. |
| `LUCY_CATALOG_FILE` | `~/lucy/agent-machine/config/model-catalog.json` | Model catalog used when the coordinator is offline. |
| `LUCY_MODEL_CATALOG` | `~/lucy/.state/model-catalog.json` | Optional note on current model IDs appended to the persona. |
| `LUCY_STATUS_FILE` | `~/.lucy-bridge-status.json` | Status file read by `bridge/tg_diag.py`. |
| `LUCY_TG_TOKENS_FILE`, `LUCY_CLAUDE_HIST_FILE` | `~/.lucy-bridge-tokens.json`, `~/.lucy-claude-history.json` | Local state files. |

## `.env.runtime` — shared runtime

| Variable | Default (code) | Example | What it does |
|---|---|---|---|
| `LUCY_HUB_PASSWORD` ✅ | — | — | Hub login password. With no password, every login is refused. |
| `LUCY_HUB_HOST` | `0.0.0.0` | `127.0.0.1` | Hub bind address. Keep `127.0.0.1` behind nginx. |
| `LUCY_HUB_PORT` | `8800` | `8800` | Hub port. |
| `LUCY_VAULT` ✅ | `~/lucy/lucy-vault` | `/root/lucy/lucy-vault` | The memory vault. If the coordinator can't find it, all memory features are off. |
| `LUCY_STATE` | `~/.lucy-hub` | `/root/.lucy-hub` | Hub state: 2FA secret, schedules, event log, chat history. |
| `LUCY_PROJECTS_ROOT` | `LUCY_WORKDIR` | `/root/lucy` | Root of the hub's file-tree tab; `integrations.json` is read from here. |
| `AM_COORD_URL` | `http://127.0.0.1:8780` | same | Where the bridge, worker, autopilot and hub reach the coordinator. |
| `AM_TURNS_LOG` | — | `/root/lucy/agent-machine/.turns` | See above. |
| `LUCY_TZ_OFFSET` | `7` | `7` | Your timezone as hours from UTC. Used for hub schedules and the daily counters. |
| `LUCY_PERSONA_CHAT` | off | `1` | Enable multi-turn chat with expert personas over cheap lanes (hub "Experts"). |
| `LUCY_PROMPT_ARCHITECT` | off | `1` | Enable the Prompt Architect (`/prompt` in Telegram, hub tab). |
| `LUCY_SKILL_LEARN` | off | `1` | Let Lucy propose new skills from repeated work (drafts go to `skills/_proposed/`). |
| `CLAUDE_EFFORT` | — | `high` | Not read by Lucy's own code; passed through to child processes. |
| `IS_SANDBOX` | — | `1` | Tells Claude Code it runs in a sandbox, so `bypassPermissions` is allowed when running as root. Lucy also sets it for every Claude child process. |

Not in the example but useful here:

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Use an API key instead of a logged-in Claude Code subscription. |
| `LUCY_PUSH_CHAT_ID` | `LUCY_ALLOWED_USER_ID` | Telegram chat that receives hub schedule results. |
| `LUCY_INTEGRATIONS_FILE` | `<LUCY_PROJECTS_ROOT>/integrations.json` | Integration nodes shown on the hub dashboard. |
| `LUCY_REPO` | `~/lucy` | Repository root, used by the hub's build-status panels. |
| `LUCY_STATE_DIR` | `~/.lucy` | Provider quota and rate-limit state. |
| `LUCY_SKILLS` | `<repo>/skills` | Skill library location. |

## Memory and recall

These can go in `.env.runtime`. They affect the coordinator (indexing, search) and the bridge and hub (what is injected per turn).

| Variable | Default | What it does |
|---|---|---|
| `LUCY_INDEX_DIRS` | see below | Comma-separated vault folders to index. **Replaces** the default list: `Context, Projects, Skills, Daily, Knowledge, Reference, Reports, Brain/decisions, Brain/entities, Brain/claude-memory, Brain/episodes, Brain/proposals`. |
| `LUCY_RECALL_PREFETCH` | on | Search the vault before each chat turn. |
| `LUCY_RECALL_GATE2` | on | Skip recall for corrections and pure follow-ups. |
| `LUCY_RECALL_MAX` | `8` (bridge), `5` (hub) | Hits requested from the coordinator. |
| `LUCY_RECALL_HITS` | `5` | Hits injected into the prompt. |
| `LUCY_RECALL_BUDGET` | `800` | Character budget for the injected memory block. |
| `LUCY_RECALL_SNIPPET` | `200` | Characters per hit. |
| `LUCY_RECALL_TIMEOUT` | `4` | Seconds to wait for recall before answering without it. |
| `LUCY_RECALL_MIN_SCORE` | `0.35` | Minimum rerank score for a hit to be used. Applies only to reranked hits; others are filtered by keyword overlap. |
| `LUCY_RECALL_PROVENANCE` | on | Tag each hit with its file and age. |
| `LUCY_RECALL_FAILLOUD` | on | Log loudly when recall fails. |
| `LUCY_VECTOR` | on if `JINA_API_KEY` | Set `0` to force full-text only. |
| `LUCY_RERANK` | off | Rerank hits with Jina (needs `JINA_API_KEY`). Required for score-based filtering. |
| `LUCY_VECTOR_MAX_DIST` | `0.9` | Maximum vector distance for a vector hit. |
| `LUCY_EMBED_TIMEOUT_MS`, `LUCY_RERANK_TIMEOUT_MS` | `20000`, `15000` | Jina call timeouts. |
| `LUCY_EMBED_THROTTLE_MS` | `1200` | Pause between embedding batches. |
| `LUCY_EPISODIC` | on | Log conversation turns for cross-session recall. |
| `LUCY_EPISODIC_RETENTION_DAYS` | `90` | Episodic turns older than this are pruned. |
| `LUCY_CONSOLIDATE` | off | Run fact consolidation (dedupe, supersede) during the dream. Needs vector search. The dream cron turns it on. |
| `LUCY_CONSOLIDATE_APPLY` | off | Actually apply consolidation; otherwise it only writes a report. The dream cron turns it on. |
| `LUCY_CONSOLIDATE_SIM`, `LUCY_CONSOLIDATE_CLUSTER_SIM`, `LUCY_CONSOLIDATE_REFLECT_TRUST` | `0.86`, `0.78`, `5` | Consolidation thresholds. |
| `LUCY_BRAIN_DREAM` | on | Per-persona "brain" consolidation during the dream (`0` = off). |
| `LUCY_DISTILL` | on | Distil signals from agent runs into `Brain/inbox` (`0` = off). |
| `LUCY_DISTILL_MODEL` | `haiku` | Model for distillation and per-persona dreaming. |
| `LUCY_AUX` | on | Allow distillation to use a cheap auxiliary lane (`0` = always use Claude). |

## Agents, models and tools

| Variable | Default | What it does |
|---|---|---|
| `LUCY_ROUTER_MODEL` | `or-nemotron-super` | Lane model used to route messages in `auto` mode. Must be a key from the model catalog. |
| `LUCY_PROMPT_ARCHITECT_MODEL` | `ds-chat` | Lane for the Prompt Architect. |
| `LUCY_PROMPT_ARCHITECT_ESCALATE_MODEL` | `opus` | Model used when you escalate a prompt. |
| `LUCY_TOOL_REGISTRY` | off | Use the unified tool registry for lane tools (experimental). |
| `LUCY_JINA_READER` | off | Use Jina Reader/Search for web tools instead of keyless DuckDuckGo. |
| `LUCY_HOOKS` | off | Install a pre-tool guard for agent runs that blocks dangerous shell commands and logs tool use. Recommended. |
| `LUCY_HOOKS_LOG` | `AM_TURNS_LOG` | Where the hook writes its log. |

## pxpipe

Set in `ecosystem.config.cjs` for `lucy-pxpipe`:

| Variable | Value | What it does |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Keep it local: its dashboard has no auth. |
| `PORT` | `47821` | Port that `ANTHROPIC_BASE_URL` points to. |
| `PXPIPE_MODELS` | list of model IDs | Only requests for these models are compressed. |

## Hub-only `.env` (optional)

The hub also loads `hub/server/.env` via `dotenv`, for running it outside PM2 (see `hub/deploy.sh`). Values in the PM2 environment take precedence. With the root `ecosystem.config.cjs` you don't need this file.

## Other files

| File | Purpose |
|---|---|
| `.env.example` (repo root) | `TAVILY_API_KEY`, used only by `tools/tavily_search.py`. |
| `agent-machine/config/personas/*.json` | Agent personas (role, model, optional `laneModel`, allowed tools). |
| `agent-machine/config/pipelines/*.json` | Board pipelines (stages and gates). |
| `agent-machine/config/model-catalog.json` | Cheap-lane model catalog (`npm run gen:catalog`). |
| `bridge/persona.md` | Chat persona. |
| `~/.claude/settings.json` | Claude Code settings; set `autoMemoryDirectory` to the vault (see [Installation](./installation#_2-install-and-log-in-to-claude-code)). |
