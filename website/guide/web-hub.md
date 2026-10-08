# Web hub

The web hub is Lucy's browser cockpit. It is a React app served by the `lucy-hub` process (Express, default port `8800`) and works on desktop and mobile. It shares Lucy's memory vault and persona with the Telegram bridge, so both front ends talk to the same "brain".

::: info UI language
Sidebar labels and most UI text are in Vietnamese. This page gives each tab's real label followed by an English description.
:::

## What the hub needs

| Piece | Needed for | How to set it |
|---|---|---|
| `LUCY_HUB_PASSWORD` | Logging in at all. With no password set, every login is rejected | `.env.runtime` |
| `claude` CLI, logged in | Chat, schedules, Tasks, VPS cleanup | `CLAUDE_BIN` if it is not on `PATH` |
| Coordinator (`AM_COORD_URL`) | Dashboard, Memory, Neural galaxy, Experts, Projects board, Connections, Skills, model picker, memory recall in chat | `.env.runtime`, e.g. `http://127.0.0.1:8780` |
| `LUCY_HUB_HOST=127.0.0.1` | Keeping the hub private behind nginx | `.env.runtime`. The code defaults to `0.0.0.0` if this is unset |
| Optional feature flags | Prompt Architect, persona chat, MCP, skill learning | See the table in [Tabs at a glance](#tabs-at-a-glance) |

When the coordinator is not configured or is offline, the tabs that depend on it show an "Agent-Machine chưa cấu hình (AM_COORD_URL)" or "offline" notice. Chat keeps working on Claude Sonnet, but it has no memory recall.

## Signing in

1. Open the hub URL, e.g. `https://hub.example.com`.
2. Enter the password from `LUCY_HUB_PASSWORD` and click **ĐĂNG NHẬP** (sign in).
3. If two-factor authentication is on, the form then asks for the 6-digit code from your authenticator app. Click **XÁC NHẬN** (confirm).

How sessions work:

- A successful login sets an `httpOnly` cookie (`lucy_token`, `SameSite=Lax`, `Secure` when served over HTTPS) that is valid for **7 days**.
- Sessions are held in memory, so restarting `lucy-hub` signs everyone out.
- Five failed attempts (wrong password or wrong 2FA code) from one IP within 15 minutes block that IP for the rest of the window. The server returns HTTP 429 and logs `login bị chặn tạm`.

### Turning on 2FA

1. Go to **Settings**, then the **XÁC THỰC 2 LỚP (2FA)** card.
2. Click **Bật 2FA** (enable 2FA). A QR code and the secret appear.
3. Scan the QR code with any TOTP app (Google Authenticator, Aegis, 1Password…). It shows up as issuer "Lucy Hub".
4. Type the current 6-digit code and click **Xác nhận & bật** (confirm and enable).

To turn 2FA off, enter a current code in the same card and click **Tắt 2FA**. The TOTP secret is stored at `$LUCY_STATE/twofa.json` (default `~/.lucy-hub/`). If you lose your authenticator, stop the hub, delete that file and start the hub again. That turns 2FA off.

See [Security](./security) for the full login hardening.

## Layout

- **Sidebar.** Tabs are grouped as *Tổng quan* (Overview), *Trí tuệ* (Intelligence), *Việc* (Work) and *Hệ thống* (System). Below the groups is the list of board projects ("Dự án"). **+** creates a project and 🗑 moves one to the trash.
- **Command palette.** <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> jumps to any tab or project. Search works without Vietnamese diacritics.
- **HUD rail.** On wide screens a right-hand column shows context for the current tab, running lanes and a live activity feed from the board. On smaller screens, open it with the 📡 button.
- **Mobile.** A bottom bar gives quick access to Dashboard, Chat, Bộ não and Dự án, and **Menu** opens the full sidebar.

## Tabs at a glance

Listed in sidebar order. "Coordinator" means the tab needs `AM_COORD_URL`.

| Group | Sidebar label | What it is | Needs | Status |
|---|---|---|---|---|
| Overview | Reactor | Hero home page with live metrics | Coordinator; toggle in Settings | Experimental, off by default |
| Overview | Dashboard | Cost, providers, agent insights | Coordinator | Core |
| Intelligence | Chat | Talk to Lucy | `claude` CLI (coordinator optional) | Core |
| Intelligence | Bộ não | Memory: recall, learned preferences, dream | Coordinator | Core |
| Intelligence | Tinh hà | Neural galaxy: graph views of memory, VPS, code, files | Coordinator for galaxy/HUD modes | Core, some modes optional |
| Intelligence | Experts | Expert personas | Coordinator; `LUCY_PERSONA_CHAT=1` for chat/routing | Core |
| Intelligence | Prompt Architect | Turns rough context into a structured prompt | `LUCY_PROMPT_ARCHITECT=1` on the hub, lane provider keys | Optional, hidden when off |
| Work | Dự án | Projects workspace: Kanban board, project Lucy, channels | Coordinator, worker | Core |
| Work | Mã nguồn | Read-only source browser | `LUCY_PROJECTS_ROOT` | Core |
| Work | Tasks | Hub jobs, running and done | — | Core |
| Work | Auto-Task | Read-only view of external auto-task/auto-build runs | Scripts not shipped in this repo | Legacy, usually empty |
| Work | Schedule | Daily scheduled prompts | `claude` CLI; Telegram vars for push | Core |
| System | Kết nối | MCP server status | Coordinator; `LUCY_MCP=1` on the worker | Read-only |
| System | Kỹ năng | Skill library and proposed skills | Coordinator; `LUCY_SKILL_LEARN=1` for learning | Read-only |
| System | Draw | Free-hand canvas | — (browser only) | Extra |
| System | Aki | Push reports to Discord via a companion bot | `RADIANT_BOT_API_URL`, `RADIANT_BOT_AGENT_SECRET` | Optional |
| System | VPS | Server status and agent cleanup buttons | Linux, `pm2` | Core |
| System | Logs | Hub event log | — | Core |
| System | Settings | Effects, 2FA, providers, model catalog | Coordinator for the provider sections | Core |
| System | Design | Design-system reference page | — | Developer page |

## Reactor

An optional home page with an "arc reactor" hero and rings driven by real metrics (tokens, lanes, cards, cost). To turn it on, go to **Settings → HIỆU ỨNG & TRỢ NĂNG** and switch on **Trang chủ Reactor ⚛️ (thử nghiệm)**, then reload the page. The setting lives in the browser (`localStorage` key `lucy.reactorHome`). When it is on, Reactor becomes the first tab and the default landing page.

## Dashboard

The default landing tab. It has three inner tabs and refreshes on its own every 10–30 seconds.

- **Overview.** Tokens per day and month, cost today and this month (USD, from the coordinator's spend ledger across all sources), a token/cost trend, model and provider status, cost by model and by agent, token sources, and live board cards.
- **Agent Insights.** Board agents' reports and an error breakdown from the turn log (by category, agent and model), plus per-agent fail/rework/ask/done bars and a "motive timeline".
- **Cho Lucy** (for Lucy). Cards waiting for you, the token runway (burn rate per hour against the token guard's soft cap), the autopilot's night log, and what Lucy learned today (new memory signals waiting for dream).

Needs the coordinator. Without it the panels show zeros.

## Chat

The main conversation with Lucy. Replies stream in as they are written.

### Conversations

- **☰** opens the conversation list. Each entry can be renamed (✎) or deleted (🗑).
- **＋ mới** / **✨ mới** starts a new conversation. The title is taken from the first message.
- Conversations are stored on the server in `$LUCY_STATE/chats/<id>.json` and keep the latest 400 messages. The view shows the last 200.
- The server saves the full answer even if you close the tab mid-reply. When you come back to the tab, the history syncs again.
- Each conversation keeps its own Claude session, so context carries over between turns. If resuming a stale session fails, the hub retries once with a fresh session.

### Model picker

The button next to the 🎤 icon opens the picker. It has three sections:

| Section | What happens |
|---|---|
| **Claude · có tool + vault** | Runs Claude through the Agent SDK with full tools, the persona, and the vault as an extra directory. The list (Opus, Sonnet, Fable, Haiku) comes from the coordinator. Each entry runs the model you pick (`claude:opus` → `claude-opus-5-5`, `claude:sonnet` → `claude-sonnet-5-5`, `claude:fable` → `claude-fable-5-1`, `claude:haiku` → `claude-haiku-5-5`). |
| **Auto — router tự chọn** | The coordinator's router picks a model. If the conversation already has a Claude session, or the prompt needs tools, it stays on Claude Sonnet. With no coordinator it falls back to Sonnet. |
| **Lane · chat thuần** | Cheaper third-party models served by the coordinator (keys in `.env.llm`). Tool-capable lanes run an agentic loop (web search/fetch, read, bash); the others are plain chat. Lanes are stateless, so the hub sends the persona plus a compressed recent history (about a 5,000-token budget). |

New chats start on Claude Sonnet. See [Models](./models) for the catalog.

### While Lucy answers

- **Thinking** (💭 Suy nghĩ) and every **tool call** (🔧 with parameters and result) appear as collapsible blocks.
- A badge under each Claude answer shows the prompt-cache hit rate, context used out of 1M, and output tokens.
- **Memory recall.** Before each Claude turn the hub asks the coordinator for relevant vault notes and prepends up to 5 short hits (with file and age) to the prompt. Turn this off with `LUCY_RECALL_PREFETCH=0`. Each turn is also logged to episodic memory after secrets are scrubbed (`LUCY_EPISODIC=0` turns that off).
- Claude in hub chat also gets a `consult_expert` tool that asks one of the expert personas for a second opinion.

### Queue, stop and voice

- Pressing Enter while Lucy is busy **queues** the message ("⏳ N tin chờ"). Queued messages run one after another. Shift+Enter adds a new line.
- **■ Dừng** (stop) cancels the stream in your browser and clears the queue. The server-side run is not killed: it finishes and its full answer is saved to the conversation.
- **🎤** dictates through the browser's Web Speech API (Chrome; language fixed to Vietnamese).
- The hub composer has **no attachment button**. To send images or documents, use [Telegram](./telegram).

Every chat turn also shows up in the **Tasks** tab.

## Bộ não (Memory)

A window into Lucy's long-term memory (see [Memory](./memory)). Needs the coordinator.

- **Recall search** (top bar) runs full-text search over the vault and shows hits with highlighted snippets plus related notes. Click a hit to read the note.
- **↻ Reindex** rebuilds the full-text index.
- **🗑 Junk scan** finds empty notes, notes with only frontmatter, exact duplicates and sync-conflict files. After you confirm, they are **moved** to `<vault>/.trash/<timestamp>/`, not deleted.
- **🌙 Dream** runs the preference "dream" on demand (the same consolidation the nightly cron does; see [Automations](./automations)).
- **Đã học** (learned) lists learned preferences with a confidence bar and status (unconfirmed, confirmed, stale, rebutted, expired). 👍 marks a preference as applied, 👎 as violated, and 📌 pins it so it is never auto-retired.
- **Inbox · chờ dream** lists raw signals waiting for the next dream. **Vault** is a file list.
- **Mở Tinh hà** jumps to the galaxy view.

## Tinh hà (Neural galaxy)

Visual views of what Lucy knows and runs. Switch modes with the buttons at the top right:

| Mode | Shows | Data source |
|---|---|---|
| ✦ HUD (default) | Constellation with Lucy's core in the centre and memory nodes by zone. Hover to see facts | Coordinator `/brain/graph` |
| 🌌 3D | 3D galaxy of the memory graph. Click a node to recall or read it | Coordinator |
| 🌳 Cây (tree) | Folder-style knowledge tree with four sources (below) | Hub server |
| ⚡ Live | Running hub jobs and declared integrations as a live graph | Hub `/api/telemetry` + `LUCY_INTEGRATIONS_FILE` (default `<projects root>/integrations.json`) |

Sources in tree mode:

- **🧠 Tri thức.** Vault folders `Brain`, `Projects`, `Context`, `Reference`, `Skills` and `Reports` (optionally `Daily`), with `[[wiki-links]]` drawn as cross edges. Capped at about 900 nodes.
- **🖥️ VPS.** PM2 services and their ports, nginx sites and routes, cron lines, CPU/RAM/swap/disk, top processes and folders, open ports, systemd services and Docker containers.
- **🧬 Code.** A code graph built from GitNexus indexes. It needs the `gitnexus` CLI and the repos at the paths hard-coded in the server (`/root/lucy/agent-machine`, `/root/lucy/bridge`, `/root/lucy/hub`). On a different layout it stays empty. The first build takes about a minute.
- **🗂️ Files.** A directory tree of `/root/lucy` and `/var/www`, 4 levels deep (fixed paths).

## Experts

Manage the expert personas that Lucy and the board can consult (see [Agents & board](./agents)). Needs the coordinator.

- **+ Expert mới** creates a persona. Fields: `id`, display name, system prompt, kind (*specialist*, *orchestrator* or *executor*), Claude tier (`sonnet`/`opus`), optional `laneModel` (a cheaper model), realm, tags, allowed tools (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch), `maxTurns` and `timeoutSec`.
- **🔮 Lucy tự chọn chuyên gia.** Describe a task and Lucy picks the best-matching expert, with a confidence score and a reason.
- **💬 Nhắn tin** opens a multi-turn chat with that expert.

Routing and expert chat need `LUCY_PERSONA_CHAT=1` in the coordinator's environment. Otherwise the coordinator replies that the feature is off.

## Prompt Architect

Shown only when the hub process has `LUCY_PROMPT_ARCHITECT=1` (also accepts `true`/`on`).

Paste rough context. The architect either asks clarifying questions or returns a sectioned prompt with a **📋 Copy prompt** button. Options:

- **Target model:** automatic, Claude, GPT, Gemini, or DeepSeek/small models. The prompt style is tuned to that family.
- **⇄ 2 biến thể** builds two variants to compare side by side.
- **⬆️ Escalate bằng Claude** asks Claude to rebuild the prompt when the cheap model's draft is not good enough, with an old-vs-new comparison.

It runs on a cheap lane model (needs provider keys in `.env.llm`). It never executes anything: the core calls the model without tools. Session history is stored in a sidecar database in the vault, with secrets scrubbed.

## Dự án (Projects workspace)

The work area for the [agent board](./agents). Needs the coordinator and a running worker.

**Creating a project:** a name, an optional repo URL (agents clone and edit that repo), an optional description or goal, and an optional project SKILL (paste a `SKILL.md` that every agent in the project will follow).

Inside a project, inner tabs:

| Inner tab | What it does |
|---|---|
| 📋 Kanban | Cards by status: backlog (ĐỂ SAU), queued, working, waiting for you (CHỜ BẠN DUYỆT), hold, rate-limited, done, failed. Approve, reject with feedback, or answer questions on waiting cards. Includes the planner (describe a goal and Lucy drafts cards), a dependency graph and a lanes setting (concurrency) |
| ✨ Lucy | A long-running per-project conversation. When the idea is clear enough, Lucy proposes cards with a **Create** button. It runs separately from the main chat: each turn gets the project transcript, and the history is stored with the project |
| 💬 Channels | Discord-style project channels where agents and the autopilot post |
| 🧩 Flow | Pipeline editor. Each step is a persona, and 🔒 marks a gate that needs your approval |
| 🗺 Mindmap · 🎨 Draw · 📝 Notes | Per-project scratch tools, saved only in this browser's `localStorage` |

Trashed projects can be restored or purged.

## Mã nguồn (Code)

A read-only file browser rooted at `LUCY_PROJECTS_ROOT` (defaults to `LUCY_WORKDIR`). Dotfiles and `node_modules` are hidden from the listing, binaries are not shown, and text files over 500 KB are skipped. Paths outside the root are refused.

## Tasks

Every hub job: chat turns, scheduled runs, project-Lucy messages and VPS cleanups. There are two columns, running (⏳) and done (✓). Click a card to see the full result, which refreshes live while the job runs. **Chạy lại** (re-run) sends the same prompt again on the same tier. Note that a re-run goes into the main chat conversation.

Jobs live in memory (the latest 30 are listed) and disappear when the hub restarts.

## Auto-Task

A read-only view of an external task runner. It reads projects from `~/lucy/tasks/projects/<slug>/` (`project.md`, `state.json`, `queue/`, `doing/`, `done/`, `failed/`, `research/`, `sprints/`) and status panels for **Auto-Build**, **Auto-Build Free** and **Auto-Task** from log files under `LUCY_REPO` (default `~/lucy`).

::: warning Legacy
The scripts that produce this data (`auto-task.py`, `auto-build*.py`) are not part of this repository, so on a fresh install the tab is empty. For background work, use the [agent board](./agents) and [autopilot](./automations#agent-autopilot) instead.
:::

## Schedule

Daily prompts that Lucy runs by herself, and a read-only view of the server's crontab. Full details are in [Automations](./automations#scheduled-prompts-in-the-hub).

## Kết nối (Connections / MCP)

A read-only list of the MCP servers available to board agents, with their state: **live**, **waiting for credentials**, **disabled by flag**, **master off**, or **tripped** (circuit breaker after errors). Nothing can be toggled here. MCP is controlled by environment flags on the worker:

```bash
# in the worker's env file, then restart the worker
LUCY_MCP=1              # master switch
LUCY_MCP_<ID>=on        # each server separately
pm2 restart lucy-vps-worker
```

See [Skills & MCP](./skills-mcp).

## Kỹ năng (Skills)

A searchable, read-only skill library: Lucy's internal skills, the general library, and **proposed** skills that Lucy wrote herself (in `skills/_proposed/`). The status chip shows whether self-learning is on (`LUCY_SKILL_LEARN=1`) or in dry-run. Proposed skills are **not loaded** until you approve them by moving them into the library and adding a line to `INDEX.md`.

## Draw

A free-hand canvas with colours, brush size, an eraser and a clear button. The drawing is saved in this browser's `localStorage` only.

## Aki

An optional bridge to a companion Discord bot. It shows "chưa cấu hình" (not configured) until both variables are set on the hub:

```ini
RADIANT_BOT_API_URL=https://bot.example.com
RADIANT_BOT_AGENT_SECRET=<shared-secret>
```

Once connected you can push a report to a channel (by name or ID) and create a text channel or a thread, with an optional opening message. Requests are signed with HMAC-SHA256 (`x-lucy-signature`). The bot itself is a separate project that must expose `/api/agent/post` and `/api/agent/channel`.

## VPS

A live server status page that refreshes every 5 seconds: CPU load against core count, RAM, swap, disk on `/`, uptime, and the PM2 process list (status, CPU, memory, restarts, listening port, and the public URL found in `/etc/nginx/sites-enabled`).

**Cleanup buttons** each start a Claude Sonnet job with a fixed prompt. Only one cleanup runs at a time, and the result appears in the panel and in Tasks.

| Button | Allowed actions in the prompt |
|---|---|
| Dọn log pm2 + journal | `pm2 flush`, `journalctl --vacuum-size=100M`, list (not delete) `.log` files over 50 MB |
| Dọn cache (apt/npm/pip) | `apt-get clean`, `npm cache clean --force`, `pip cache purge` |
| Dọn /tmp cũ | Delete items in `/tmp` not accessed for more than 7 days |
| Phân tích disk (không xoá) | `df`/`du` report with suggestions, no deletion |

::: warning
The allow-list and the "never touch the vault, source, databases, `/etc`, `.env`" rules are **instructions in the prompt**, not a sandbox. Claude runs these jobs with `bypassPermissions`. Read [Security](./security).
:::

## Logs

The hub's own event log: logins, jobs, schedules, chat, Aki, VPS cleanups, Prompt Architect and graph builds. It shows the last 200 events, refreshes every 3 seconds, and can be filtered by type or paused. Events are kept in memory (800) and appended to `$LUCY_STATE/log.jsonl`. For process logs, use `pm2 logs` (see [Operations](./operations)).

## Settings

| Card | What it does |
|---|---|
| HIỆU ỨNG & TRỢ NĂNG | **Reduce effects** (no animation, solid panels, no blur) and the **Reactor** home toggle. Both are stored per browser. System reduced-motion settings are always respected |
| XÁC THỰC 2 LỚP (2FA) | Enable or disable TOTP (see [above](#turning-on-2fa)) |
| NGUỒN API | Which LLM providers have a key configured (from the coordinator) |
| MODEL CATALOG | Models by role: Executor, Reasoning, Fast, Content |
| EXECUTOR MẶC ĐỊNH | Pick a default executor model. Stored in this browser's `localStorage` only; nothing else in the hub reads it yet |

## Design

A design-system reference page that renders the UI tokens and components (colours, cards, buttons, chips, empty and error states). It is meant for development and visual QA, and has no backend.
