# Models and cost

Lucy uses two kinds of models:

- **Claude**, the "real brain". It runs through Claude Code (the Agent SDK or the `claude` CLI) with tools, your memory vault and the Lucy persona. It handles chat and the agents on the board.
- **Lanes**: cheap or free models from OpenAI-compatible providers (Groq, Gemini, OpenRouter…). Lucy uses them for lightweight chat, routing, background chores, and as a fallback when Claude runs out.

Everything is declared in one file, `agent-machine/src/llm-lane.ts`. A generated JSON copy (`agent-machine/config/model-catalog.json`) lets the Telegram bridge still list models when the coordinator is offline.

## Claude models

The current catalog (`CLAUDE_CHAT_MODELS`):

| Key | Model ID | Tier | Notes |
|---|---|---|---|
| `claude:opus` | `claude-opus-5-5` | deep 🧠 | Strongest. Flagged `default: true` in the catalog. |
| `claude:sonnet` | `claude-sonnet-5-5` | balanced ✦ | Fast and balanced. What chat actually starts on. |
| `claude:fable` | `claude-fable-5-1` | deep 🧠 | Fifth generation. |
| `claude:haiku` | `claude-haiku-5-5` | fast ⚡ | Light and cheap, for simple jobs. |

::: tip Which one is the default?
The catalog marks Opus 5.5 as `default: true`, but neither chat front-end reads that flag today. A new Telegram chat or hub chat runs on **`claude:sonnet`** (Sonnet 5.5) until you pick something else. `/fan`, `/auto` and `/orch` also use Sonnet unless the goal starts with `opus`.
:::

Every Claude call goes through one resolver, so `sonnet`, `opus`, `fable` and `haiku` (or `claude:<name>`) map to the IDs above. Any other string is passed to Claude unchanged.

### Switching Claude models

| Where | How |
|---|---|
| Telegram | `/model` shows buttons. You can also type `/model opus`, `/model claude:haiku`, etc. Prefix one message with `!o ` to use Opus for just that message. See [Telegram](./telegram#picking-a-model). |
| Web hub | The model picker in the chat input bar has a **Claude · có tool + vault** group, an **Auto** entry and a **Lane · chat thuần** group. See [Web hub](./web-hub). |

In Telegram, switching between Claude models keeps the conversation; the live session changes model in place. In the hub's chat server, choosing Opus runs Opus, and any other Claude entry currently runs as Sonnet.

## Lanes: cheap and free providers

Lanes talk to each provider's OpenAI-compatible `/chat/completions` endpoint directly with Node's `fetch`. Claude Code is not involved. Lanes are used for:

- Telegram or hub chat when you pick a lane model, or when **Auto** routes you there
- the router that decides "Claude or lane?"
- card executors on the board when the token guard is in soft mode
- small jobs such as Prompt Architect (`ds-chat`) and session summaries
- the fallback brain when Claude is out of quota

### Providers

API keys go in `.env.llm` at the repo root (or the file named by `LLM_ENV_FILE`). Values in this file override the process environment.

| Provider | Env var | Catalog models | Free in catalog? |
|---|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | `or-nemotron-super`, `or-gptoss-120b` (free); `ds-v4-flash`, `ds-v4-pro`, `ds-chat` (paid); plus auto-discovered free models | mixed |
| Groq | `GROQ_API_KEY` | `groq-gptoss-120b`, `groq-llama-70b` | yes |
| Gemini | `GEMINI_API_KEY` | `gemini-flash` (Gemini 3 Flash) | yes |
| Cerebras | `CEREBRAS_API_KEY` | `cerebras-glm-47`, `cerebras-gptoss` (8K context cap) | yes |
| Mistral | `MISTRAL_API_KEY` | `devstral-med`, `codestral`, `mistral-large` | yes |
| OpenCode Zen | `OPENCODE_ZEN_API_KEY` | `ds-v4-flash-free`, `mimo-v2.5-free` (free); `minimax-m3-free` (free promotion ended, don't route) | mostly |
| Nous Portal | `NOUS_API_KEY` | Aggregator on Nous credits: `nous-opus`, `nous-opus-fast`, `nous-sonnet`, `nous-fable`, `nous-haiku`, `nous-nemotron-ultra`, `nous-hermes-405b`, `nous-ds-v4-pro`, `nous-qwen3-coder`, `nous-gpt-oss-120b`; `nous-nemotron-free` is free | mostly paid |
| Z.ai | `ZAI_API_KEY` | Provider defined, no models in the catalog | — |

"Free" is the `free` flag on each catalog entry. It means the model is free or on a free tier with that provider; it doesn't mean unlimited. You only need keys for providers you want to use. Lucy skips any provider without a key.

**Several keys per provider.** Add `GEMINI_API_KEY_2` … `_8`, or put a comma-separated list in the main variable. When a key gets a `429`, it cools down for the `Retry-After` time (5 minutes by default) and the next key is tried. A key that returns `401`/`403` is benched for 30 minutes.

**OpenRouter auto-discovery.** When the coordinator starts, it fetches OpenRouter's model list and adds every free, non-Anthropic model it doesn't already know as an `or-disc-…` key. Models that support tools get the `executor` role; the rest get `content`.

### Roles, fallbacks and the route table

Each catalog model has a **role** (`executor`, `reasoning`, `fast`, `content`). If a call fails or returns empty, Lucy tries the rest of that role's **fallback chain**:

| Role | Fallback chain |
|---|---|
| executor | `mimo-v2.5-free` → `ds-v4-flash-free` → `or-nemotron-super` → `devstral-med` → `or-gptoss-120b` → `ds-v4-flash` → `codestral` |
| reasoning | `ds-v4-pro` → `ds-v4-flash` → `groq-gptoss-120b` |
| fast | `groq-gptoss-120b` → `cerebras-glm-47` → `groq-llama-70b` |
| content | `gemini-flash` → `mistral-large` → `groq-gptoss-120b` |

**Auto** routing uses a separate `ROUTE_TABLE` (in `agent-machine/src/chat-lane.ts`). A router model reads your message and returns a role plus `needsTools`. If `needsTools` is true, the message goes to Claude. Otherwise Lucy picks a model from that role's list, preferring models with good past outcomes once there is enough data.

| Route role | Models (in preference order) |
|---|---|
| router | `or-nemotron-super`, `ds-v4-flash-free`, `groq-gptoss-120b`, `gemini-flash` |
| agentic-code | `devstral-med`, `or-nemotron-super`, `ds-v4-flash-free`, `codestral` |
| reasoning | `ds-v4-flash-free`, `or-nemotron-super`, `groq-gptoss-120b` |
| long-context | `or-nemotron-super`, `ds-v4-flash-free` |
| tool-calling | `gemini-flash`, `or-nemotron-super`, `groq-gptoss-120b` |
| fast-classify | `cerebras-glm-47`, `groq-llama-70b`, `groq-gptoss-120b` |
| content | `gemini-flash`, `mistral-large` |

The router model is `or-nemotron-super` unless you set `LUCY_ROUTER_MODEL=<key>`. If the router fails, or isn't confident, the message goes to Claude.

### Rate limits across processes

When any Lucy process gets a `429` from a provider, it records that provider in `~/.lucy/rate-guard.json` (or under `LUCY_STATE_DIR`) until the retry time. Every other process checks that file first and skips the provider instead of piling on more requests. If a whole chain is rate-limited, the call is parked with back-off rather than failed. Lucy also reads `x-ratelimit-*` and credit headers into `quota.json`. The coordinator exposes both at `GET /llm/guard`.

### Claude out of quota: fallback to lanes

If Claude reports a usage, rate or quota limit, or the token guard's hard limit is reached, Telegram chat switches to the best lane that still has a key and shows a `⚠️ Claude hết token…` banner. The order and details are in [Telegram](./telegram#when-claude-runs-out).

## Adding a provider or model

Everything lives in `agent-machine/src/llm-lane.ts`.

1. **New provider** (must speak the OpenAI `/chat/completions` format): add its ID to the `ProviderId` type and an entry to `PROVIDERS`:

   ```ts
   'myprov': { id: 'myprov', baseUrl: 'https://api.example.com/v1', envKey: 'MYPROV_API_KEY', label: 'My Provider' },
   ```

2. **New lane model**: add a line to `MODEL_CATALOG`:

   ```ts
   { key: 'myprov-fast', label: 'Example Fast', provider: 'myprov', model: 'example-fast-1', role: 'fast', free: true, note: 'what it is good at' },
   ```

   If you want it used automatically, also add the key to `FALLBACKS` in the same file or to `ROUTE_TABLE` in `chat-lane.ts`.

3. **New Claude model**: add a line to `CLAUDE_CHAT_MODELS`. The Telegram buttons and the hub picker pick it up automatically:

   ```ts
   { key: 'claude:newmodel', label: 'Claude New', model: 'claude-newmodel-1', tier: 'balanced', note: '…' },
   ```

   You can then switch to it with `/model claude:newmodel`. Only `sonnet`, `opus`, `fable` and `haiku` have short aliases.

4. Put the API key in `.env.llm`, then regenerate the catalog and restart:

   ```bash
   cd agent-machine
   npm run gen:catalog        # validates keys, writes config/model-catalog.json
   pm2 restart lucy-coordinator lucy-bridge lucy-hub
   ```

`gen:catalog` refuses to write the file if `FALLBACKS` or `ROUTE_TABLE` mention a key that isn't in `MODEL_CATALOG`. Don't edit `model-catalog.json` by hand.

## Token and cost accounting

Model calls from every part of Lucy are reported to the coordinator's ledger with `POST /spend`, including its source (`bridge`, `lane`, `hub`, `worker`, `cron`…), model, input, output, cache-read and cache-write tokens. The coordinator works out USD in one place (`agent-machine/src/pricing.ts`):

| Model family | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| Fable | $10 | $50 | $1.00 | $12.50 |
| Opus | $5 | $25 | $0.50 | $6.25 |
| Sonnet | $3 | $15 | $0.30 | $3.75 |
| Haiku | $1 | $5 | $0.10 | $1.25 |

Prices are USD per million tokens. They are a hard-coded fallback table, matched by family name. Lane models are priced from OpenRouter's public model list, refreshed at most once an hour; models with an unknown price count as $0. On a Claude subscription, these USD figures are an API-equivalent estimate, not what you are billed.

In Telegram, `/token` shows today's Telegram usage (UTC day) and the shared guard. The hub dashboard's overview reads the same ledger.

## Token guard

The token guard is a shared daily token budget across hub, Telegram, worker and autopilot. "Used" means the sum of input, cache and output tokens in today's ledger. The day rolls over at midnight in UTC+`LUCY_TZ_OFFSET` (default `7`).

| Limit | Env var (`agent-machine/.env`) | Default | When reached |
|---|---|---|---|
| Soft | `AM_DAY_TOKEN_SOFT` | 800,000,000 | Board **executor** cards are moved to the cheapest available lane model. Reviewers, architects and cards with an explicit Opus/Sonnet override stay on Claude. |
| Hard | `AM_DAY_TOKEN_HARD` | 1,500,000,000 | The board stops starting card work and asks you to raise the limit or wait for the next day. Telegram skips Claude and answers from a fallback lane. |

The defaults are high on purpose: cache reads count, and a busy day of chat and builds easily burns tens of millions of tokens. Set your own values and restart the coordinator:

```ini
# agent-machine/.env
AM_DAY_TOKEN_SOFT=50000000
AM_DAY_TOKEN_HARD=100000000
```

## pxpipe: the token-compression proxy

[pxpipe](https://github.com/teamchong/pxpipe) (`pxpipe-proxy` on npm) is an optional local proxy. It sits between Claude Code and Anthropic and renders the bulky parts of each request (system prompt, tool docs, older history) as compact images, which cost fewer input tokens than the same text. Recent turns stay as text, and responses are never touched.

In Lucy it runs as the PM2 app `lucy-pxpipe` on `127.0.0.1:47821`:

```js
// ecosystem.config.cjs
PXPIPE_MODELS: 'claude-fable-5,claude-fable-5-1,claude-sonnet-5,claude-sonnet-5-5,gpt-5.6'
```

Only requests for the models in `PXPIPE_MODELS` are compressed. Anything else, including Opus, passes through byte-for-byte. `PXPIPE_MODELS=off` disables imaging.

**Who uses it.** Any process whose environment has `ANTHROPIC_BASE_URL=http://127.0.0.1:47821`. `ecosystem.config.cjs` merges `bridge/.env` into every process's environment, and the example `bridge/.env` sets that variable. So the coordinator, worker, autopilot and hub all send their Claude traffic through pxpipe. `pxpipe/setup-pxpipe-lucy.sh` and `source pxpipe/on.sh` wire it into running processes and check each one.

**Telegram chat bypasses it.** The bridge removes `ANTHROPIC_BASE_URL` before every Claude call (chat, `/fan`, `/orch`, `/auto`) and talks to Anthropic directly. There are two reasons:

- Compression rendered the appended Lucy persona into an image and the model lost it. Lucy started answering "I'm Claude" instead of staying in character.
- Chat turns are short and already prompt-cached, so the savings are small, while pxpipe is lossy on byte-exact details such as IDs and hashes.

Large, persona-free background jobs are where it pays off.

::: warning
- Run `npm install` inside `pxpipe/` before starting `lucy-pxpipe`. Otherwise the binary is missing and PM2 restarts it in a tight loop.
- Don't just stop pxpipe while processes still point `ANTHROPIC_BASE_URL` at it. Their Claude calls will fail. Remove the variable first (or set `PXPIPE_MODELS=off`), then restart those processes.
- The dashboard at `http://127.0.0.1:47821/` has no auth. Keep it on localhost and reach it with an SSH tunnel: `ssh -L 47821:127.0.0.1:47821 <user>@<your-server>`.
:::

## Anthropic authentication

Lucy never calls the Anthropic API with its own code. Every Claude call goes through Claude Code (the `claude` CLI or the Claude Agent SDK, which runs the CLI), so Lucy uses whatever credentials Claude Code has on the server:

| Option | How | Billing |
|---|---|---|
| **Claude subscription** | Run `claude login` on the server once, as the user that runs PM2. Credentials are stored under `~/.claude`. | Counts against your Claude plan's usage limits. When you hit them, Lucy falls back to lanes. |
| **API key** | Put `ANTHROPIC_API_KEY=<your-key>` in one of the env files (e.g. `.env.runtime`). Processes don't inherit your shell's environment (`filter_env`), so it must be in a file. Then restart. | Pay-as-you-go per token on your Anthropic Console account. |

A subscription login is meant for **your own personal use** of your own Lucy. If other people will use your instance, or you run it as a service, use an API key, and check Anthropic's current terms. Test either setup with `claude -p "hi" --output-format json`.

Related: [Telegram](./telegram) · [Agents](./agents) · [Configuration](./configuration) · [Operations](./operations)
