# Agents & the card engine

For bigger jobs Lucy uses a Kanban-style engine. Each job is a **card**. A card moves through the **stages** of a **pipeline**, and at each stage a specialist **persona** does the work. The engine keeps cards moving on its own and stops for you only at gates you define, or when something needs a decision.

## Moving parts

```
 ┌──────────── coordinator (always on, light) ────────────┐        ┌──── worker(s) ────┐
 │ board · cards · projects · pipelines · personas        │ claim  │ Claude Agent SDK  │
 │ channels · budget · token guard · recall/brain API     │◄───────│ or cheap LLM lane │
 │ HTTP on 127.0.0.1:8780 (token-protected)               │ result │ runs one stage    │
 └────────────────────────────────────────────────────────┘───────►└───────────────────┘
          ▲                         ▲
          │ hub "Projects" board    │ autopilot (optional): answers gates while you're away
```

- **Coordinator** (`npm run coordinator`) holds all state and decides what runs next. It never runs an agent itself.
- **Worker** (`npm run worker`) polls the coordinator, claims a job, runs one stage in an isolated folder and sends back the result. Workers can live on the same server or on another machine.
- **Autopilot** (`npm run autopilot`) is optional. It decides gates on your behalf, with hard exceptions (see [Autopilot](#autopilot)).

## Core concepts

| Concept | What it is | Where it lives |
|---|---|---|
| **Project** | Container for cards, with optional `repoUrl`/`branch` (agents work in a real clone), a description, a project `skill` text added to every agent prompt, and chat channels (default `general`) | coordinator data |
| **Pipeline** | Ordered list of stages. Each stage has a `personaId`, an optional `gate: true` (a human or the autopilot must approve) and an optional `verify` shell command | `config/pipelines/*.json`, plus custom pipelines from the hub |
| **Persona** | An agent role: system prompt, Claude `model` (`sonnet`/`opus`), optional `laneModel` (cheap model), `allowedTools`, `maxTurns`, `timeoutSec`, `kind` | `config/personas/*.json` |
| **Card** | One unit of work: title, brief, pipeline, current stage, status, cost, history, reports | coordinator data |
| **Channel** | Message stream per project, plus one thread per card (`card-<id>`) where agents post status and reports | coordinator data |

**Card statuses:** `backlog` (not started yet) · `queued` · `working` · `waiting_human` · `blocked` (waiting on other cards) · `parked` (rate-limited, resumes automatically) · `done` · `failed`.

**Why a card is `waiting_human`** (`waitKind`): `gate` (stage approval) · `decision` (the agent asked a question) · `cost` (per-card cost cap reached) · `loop` (too many reworks on one stage) · `stuck` (the triage step escalated it) · `size-gate` (task too large for an executor).

Every stage must end with a JSON **outcome**. `decision` is one of:

| Decision | Effect |
|---|---|
| `advance` | Go to the next stage. If this stage has `gate: true` → `waiting_human/gate`. |
| `done` | Card finished |
| `rework` | Run this stage again (counts toward the loop cap) |
| `needs_decision` | Ask a question → `waiting_human/decision` |
| `delegate` | Create a child card for another persona. The parent waits until it is done. |
| `fail` | Card failed |

If an agent finishes without the JSON, a short salvage call infers the outcome from its report.

## Card lifecycle

```
            create (hub / API / sprint)
                       │
     deferred? ──yes──► backlog ──"Run"──┐
                       │                 │
     blockedBy? ─yes─► blocked ──deps done─┤
                       ▼                 │
                    queued ◄─────────────┘◄──────────────────────────┐
                       │ tick: lanes free, budget ok,                 │
                       │ loop cap / size gate pass                    │
                       ▼                                              │
                    working ── worker runs stage (SDK or lane)        │
                       │                                              │
        ┌──────────────┼──────────────┬──────────────┬─────────────┐  │
        ▼              ▼              ▼              ▼             ▼  │
     advance         rework     needs_decision    delegate       fail │
        │              │              │              │             │  │
  verify cmd? ─fail──► └──────────────┼──────────────┼─────────────┼──┘
        │ pass                        ▼              ▼             ▼
  gate? ─yes─► waiting_human ──approve──► next stage / done     failed
        │       (gate/decision/cost/loop)  reject+feedback ──► queued (rework)
        no                                 answer ───────────► queued
        ▼
  next stage ─► queued … last stage ─► done
                                         │
                                         └─► session note in Daily/, lessons → Brain/
```

Other automatic moves:

- A `working` card that has not reported back within `AM_LEASE_MS` (20 min) is re-queued, in case the worker died.
- A rate-limited run parks the card and re-queues it when the wait is over.
- On restart, cards left in `working` are re-queued.

## Personas

These come from `agent-machine/config/personas/`. Display names are anime-style characters, which is flavour only. *Lane model* is the cheap model used when it is available. Personas without one always run on Claude.

| id | Name | Kind | Claude model | Lane model | Tools | What it does |
|---|---|---|---|---|---|---|
| `orchestrator` | Okabe · Orchestrator | orchestrator | opus | – | Read, Bash | Splits a big goal into subtasks and delegates them to the right persona. Does not code. Also writes sprints. |
| `architect` | Kurisu · Architect | specialist | opus | – | Read, Write, Bash | Surveys the repo and plans the simplest correct approach for large tasks |
| `builder` | Tanjiro · Builder | executor | sonnet | `ds-v4-flash-free` | Read, Write, Edit, Bash | Implements the task in the workspace (full-stack code) |
| `engineer` | Zenitsu · Engineer | executor | sonnet | `devstral-med` | Read, Edit, Bash | Small, focused subtasks: one bug fix, one small feature or refactor |
| `grinder` | Vương Lâm · Grinder | executor | sonnet | `ds-v4-flash-free` | Read, Edit, Bash | Bulk mechanical work: codemods, scaffolding, repetitive edits |
| `data` | Daru · Data | executor | sonnet | `ds-v4-flash-free` | Read, Write, Bash | Data scripts, parsing logs/metrics, scraping or calling APIs, summaries |
| `writer` | Tamayo · Writer | executor | sonnet | `ds-v4-flash-free` | Read, Write, Edit | Docs, READMEs, specs, course content |
| `designer` | Mitsuri · Designer | specialist | sonnet | – | Read, Write, Edit, Bash | UI/UX: layout, components, responsive design |
| `tester` | Shinobu · Tester | specialist | sonnet | – | Read, Write, Bash | Writes and runs tests, reproduces bugs |
| `reviewer-spec` | Giyu · Spec-Review | specialist | sonnet | – | Read, Bash | Spec compliance: does the output do what was asked? |
| `reviewer` | Rengoku · Reviewer | specialist | opus | – | Read, Bash | Strict quality review. Usually the gate stage. |
| `investigator` | Conan · Investigator | specialist | sonnet | – | Read, Bash | Root-cause analysis and codebase surveys. Reports findings, does not fix. |
| `security` | Gyomei · Security | specialist | opus | – | Read, Bash | Security review: finds and rates risks, does not "just fix" |
| `devops` | Tengen · DevOps | specialist | sonnet | – | Read, Bash | Build, deploy and release (pm2, nginx, CI, env, health checks) |
| `researcher` | Shiro · Researcher | specialist | sonnet | `or-nemotron-super` | Read, Bash | Deep research and synthesis with sources (expert consult) |
| `finance` | Eru · Finance | specialist | sonnet | `or-nemotron-super` | Read, Bash | Market and finance view: trends, risk, entry/exit zones (expert consult) |
| `marketing` | Mina · Marketing | specialist | sonnet | `or-nemotron-super` | Read, Bash | Positioning, channels, funnels, go-to-market (expert consult) |
| `prompt-architect` | Vivy · Prompt Architect | specialist | sonnet | `ds-chat` | none (1 turn) | Turns a rough idea into a complete prompt for another model. Does not execute it. |

You can add or edit personas in the hub's **Experts** tab (`GET/POST/DELETE /personas` on the coordinator) or by dropping a JSON file into `config/personas/`. A persona needs at least `id` (`a-z0-9-_`), `name` and `systemPrompt`.

## Pipelines

From `agent-machine/config/pipelines/`. A ⛔ marks a gate.

| id | Name | Stages |
|---|---|---|
| `feature` | Feature (repo) | architect (plan) → builder (code) → tester (tests) → reviewer-spec (spec check) → reviewer ⛔ |
| `ui` | UI / UX (frontend) | designer → builder → reviewer ⛔ |
| `research` | Research / Root-cause | investigator → architect ⛔ (plan from findings) |
| `eng` | Engineer subtask | engineer (single stage) |
| `blog` | Blog site | builder → reviewer ⛔ |
| `course` | Portal course | writer (draft) → reviewer ⛔ → writer (publish) |
| `secure-ship` | Secure → Ship | security ⛔ → devops ⛔ |

You can create custom pipelines from the hub's flow editor or with `POST /pipeline`. These are saved to `custom-pipelines.json` in the coordinator data folder and override config pipelines with the same id. A stage can carry a `verify` command, for example `npm test`. When the agent reports `advance` or `done`, the command runs in the card's workspace with a 120 s timeout. A non-zero exit sends the stage back for rework with the log attached.

## Creating work

### From the hub

Open the **Projects** tab (*Dự án*): Kanban board, Lucy chat and channels per project. Create a project, optionally with a git repo URL and branch. Then add a card with:

- title and brief (the brief should say what "done" means)
- pipeline, and optionally a different persona for the first stage
- model: default, `sonnet`, `opus`, or the persona's cheap lane model
- quality `thorough` (more turns, higher caps) or default `fast`
- "later": the card stays in `backlog` until you press Run
- dependencies (`blockedBy`): the card starts only after those cards are done

Approve, reject (with feedback) or answer waiting cards from the card drawer.

### From the API

The coordinator listens on `127.0.0.1:8780`. Every route except `/health` requires the `x-worker-token` header. The hub forwards the same calls under `/api/am/*` for logged-in users.

```bash
TOKEN=<AM_TOKEN>
# create a project that works on a real repo
curl -s -X POST 127.0.0.1:8780/project -H "x-worker-token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"My App","repoUrl":"https://github.com/<you>/<repo>.git","branch":"main"}'

# add a card
curl -s -X POST 127.0.0.1:8780/card -H "x-worker-token: $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Add /healthz endpoint","brief":"Done = GET /healthz returns 200 + JSON; test added.","pipelineId":"feature","projectId":"<projectId>"}'

# act on a waiting card
curl -s -X POST 127.0.0.1:8780/approve -H "x-worker-token: $TOKEN" -H 'content-type: application/json' -d '{"cardId":"<id>"}'
curl -s -X POST 127.0.0.1:8780/reject  -H "x-worker-token: $TOKEN" -H 'content-type: application/json' -d '{"cardId":"<id>","feedback":"Missing test for 500 case"}'
curl -s -X POST 127.0.0.1:8780/answer  -H "x-worker-token: $TOKEN" -H 'content-type: application/json' -d '{"cardId":"<id>","text":"Use option B"}'
```

Optional `/card` fields: `personaId`, `model` (`sonnet`/`opus`/`laneModel`), `quality` (`thorough`), `deferred` (bool), `blockedBy` (array of card ids). `model: "laneModel"` is rejected for a persona that has no lane model.

### Sprint: let the orchestrator write the cards

```bash
cd ~/lucy/agent-machine
AM_TOKEN=<AM_TOKEN> npm run sprint -- sprint <projectId> "Ship dark mode for the settings page"
```

The orchestrator (Claude opus, one shot) splits the goal into 3–7 independent cards, picks a pipeline for each from the ones that exist, avoids titles already on the board, and queues them.

### From Telegram

`/fan`, `/auto` and `/orch` in Telegram are **not** cards. They run Claude sessions directly from the bridge and reply in the chat:

| Command | What it does |
|---|---|
| `/fan` + one task per line (≥ 2) | Runs each line as a separate Claude session in parallel (up to 4 at a time) and replies per lane |
| `/auto <goal>` | Loops one Claude session until it reports `STATUS: DONE` (max 8 rounds) |
| `/orch <goal>` | Plans 2–5 independent subtasks, runs them in parallel, then writes one combined report |

They use sonnet. Start the goal with `opus` to use opus instead. Use the board when you want stages, review gates, cost tracking and a repo workspace.

## Workers and runners

```bash
# on the server (light), or on a stronger machine pointing at the coordinator
AM_COORD_URL=http://127.0.0.1:8780 AM_TOKEN=<AM_TOKEN> \
AM_RUNNER=claude AM_WORKER_CONCURRENCY=2 npm run worker
```

| `AM_RUNNER` | Behaviour |
|---|---|
| `mock` (default) | Does not call any model. Every stage just advances. Use it only to test the plumbing. |
| `claude` | **Composite.** If the persona has a `laneModel` and that provider's key is set → cheap lane. Otherwise → Claude Agent SDK. |
| `lane` | Cheap lane only |

- **Claude Agent SDK path.** The stage runs in-process with `query()`, using the persona's `model`, `allowedTools`, `maxTurns` (default 12) and `timeoutSec` (default 300). The vault is added as an extra directory, MCP servers are mounted per persona, and on rework the agent resumes its previous session for that stage instead of re-reading the whole project. It needs Claude credentials on the worker machine.
- **Cheap lane.** OpenAI-compatible providers (keys in `~/lucy/.env.llm`) run an agentic tool loop with read/write/edit/bash, limited by the persona's `allowedTools` and kept inside the workspace. See [Models](./models.md).

Each run's system prompt is built from: house rules → outcome contract → persona prompt → tool manifest → matched [skills](./skills-mcp.md) → `Brain/active.md` (learned preferences) → the persona's own lessons (`Brain/agents/<id>.md`).

`AM_WORKER_CONCURRENCY` sets how many stages one worker runs at once. The coordinator's `AM_MAX_LANES` (default 3) limits how many cards are `working` across all workers.

### Where workspaces and logs live

| What | Path |
|---|---|
| Coordinator state | `AM_DATA` (default `agent-machine/.data/`): `cards.json`, `projects.json`, `channels.jsonl`, `ledger.jsonl` (spend), `custom-pipelines.json`, `token-day.json` |
| Scratch workspace (project without repo) | `<worker cwd>/.worker/<cardId>/`. Every stage of a card shares it. |
| Repo workspace | `<worker cwd>/.worker/repos/<projectId>/`. It is cloned once, then `git pull --ff-only` on each run, and cards of one project are serialized. Missing `node_modules` are symlinked from a local source repo or installed. |
| Per-turn logs (opt-in) | Directory in `AM_TURNS_LOG` |
| Tool telemetry and danger guard (opt-in) | `LUCY_HOOKS=1`. Logs go to `LUCY_HOOKS_LOG` (or `AM_TURNS_LOG`). Blocks commands such as `git push`, `rm -rf /`, `curl … \| sh`. |

::: warning
Agents never push. Changes stay in the clone under `.worker/repos/`. Review the diff and push yourself, or use a `devops` stage that you approve.
:::

## Autopilot

The autopilot is a separate process that acts for you at checkpoints. It is designed for overnight runs.

```bash
AM_TOKEN=<AM_TOKEN> AM_AUTOPILOT_MAX=15 npm run autopilot
```

Every `AM_AUTOPILOT_POLL_MS` (6 s) it reads the board and handles cards in `waiting_human`:

| waitKind | Autopilot action |
|---|---|
| `gate` | A director (Claude, `AM_DIRECTOR_MODEL`, default `opus`) reads the reports and diff with the whole sprint as context, then decides: **approve**, **return** with concrete feedback, or **escalate** to you. If it cannot parse a decision twice, it escalates (it never returns work it could not read). |
| `decision` | Answers the agent's question, or escalates |
| `cost` | Cards at or above `AM_CARD_HARD_USD` ($8) are always escalated. Below that, the director decides between granting more budget and escalating. |

**It never approves:**

- gates where the stage persona is `devops` or `security`
- any card in the `secure-ship` pipeline
- cards waiting for `loop`, `stuck` or `size-gate`

These are left for you. Every action is posted to the project's `general` channel, prefixed with 🌙 and the current token status. The autopilot stops after `AM_AUTOPILOT_MAX` decisions (default 100); restart it to reset the count. Stop it with `pm2 stop lucy-autopilot`.

## Budgets and the token guard

Two independent limits protect your spending.

**Dollar budget** (coordinator, from SDK/lane cost reports):

| Variable | Default | Effect |
|---|---|---|
| `AM_WINDOW_MS` / `AM_CAP_USD` | 5 h / $20 | Spend in the rolling window reaches the cap → the engine **pauses dispatch** |
| `AM_SOFT_USD` | $14 | Posts a warning in the `coordination` channel |
| `AM_WEEKLY_CAP_USD` | $120 | Weekly cap → pause |
| `AM_PER_CARD_USD` | $2 | Card reaches it → `waiting_human/cost` (×3 for `thorough` cards) |
| `AM_MAX_STAGE_VISITS` | 3 | Visits to one stage above this → `waiting_human/loop` and an automatic triage (split into subtasks / upgrade to opus / escalate). `thorough`: ×2 + 2. |
| `AM_MAX_LANES` | 3 | Cards working at once |
| `AM_LEASE_MS` | 20 min | Re-queue cards whose worker went silent |

Executor personas on top-level cards also have a **size gate**. If title plus brief is longer than 1500 characters, the card waits for you to split it, or to approve it anyway.

Some limits can be changed while the coordinator is running: `POST /config` with `maxLanes`, `perCardMaxUsd`, `maxDepth`, `maxStageVisits`, `tokenSoft`, `tokenHard`.

**Token guard** (tokens per day, counted from the spend ledger; the day boundary is UTC+7):

| Variable | Default | Effect |
|---|---|---|
| `AM_DAY_TOKEN_SOFT` | 800,000,000 | Executor personas are moved to the cheapest available lane model. Reviewers and architects keep their model, and cards with an explicit model are left alone. |
| `AM_DAY_TOKEN_HARD` | 1,500,000,000 | New cards are created as `waiting_human` and the autopilot stops acting |

Chat traffic from Telegram and the hub is reported to the same ledger (`POST /spend`), so one counter covers everything. Check it with `GET /token-guard` and reset the day with `POST /token-guard/reset`.

## Watching progress

- **Hub → Projects:** board columns by status. The card drawer shows each stage's full report, changed files and diffstat, cost and history. The card thread shows live status messages.
- **Hub → Dashboard:** cost by source and model, provider status.
- **API:** `GET /state` (cards, projects, last 200 channel messages, limits, token guard), `GET /health`, `GET /metrics`, `GET /token-guard`.
- **Logs:** `pm2 logs lucy-coordinator`, `pm2 logs lucy-vps-worker`, `pm2 logs lucy-autopilot`.
- **Error stats:** `npm run stats:errors` summarizes failed or bounced runs from the turn logs.
- **Files:** `git -C .worker/repos/<projectId> diff` to see exactly what changed.
