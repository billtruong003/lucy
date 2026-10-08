# Chat on Telegram

Telegram is the main way to talk to Lucy. The `lucy-bridge` process (`bridge/lucy_bridge.py`) long-polls the Telegram Bot API. It passes each of your messages to Claude, running as Claude Code with its tools and your memory vault, and streams the answer back into the chat.

This page covers day-to-day use: commands, models, personas, files, sessions, memory and what happens when Claude runs out of quota.

## Setup recap

You do this once during [installation](./installation). The short version:

1. Create a bot with **@BotFather** in Telegram (`/newbot`). Copy the bot token.
2. Put the token and your Telegram user ID in `bridge/.env`:

   ```ini
   TELEGRAM_BOT_TOKEN=<your-bot-token>
   LUCY_ALLOWED_USER_ID=<your-telegram-user-id>
   ```

3. Start (or restart) the bridge: `pm2 restart lucy-bridge`.

Don't know your user ID yet? Start the bridge, send your bot `/id`, and it replies with `chat_id=… · user_id=…`. Copy the `user_id` into `.env` and restart.

::: warning Always set LUCY_ALLOWED_USER_ID
Lucy runs Claude with `bypassPermissions`: it reads, writes and runs commands without asking. The allow-list is the only gate. When `LUCY_ALLOWED_USER_ID` is set, messages and button presses from anyone else are dropped at the polling layer, and a stranger who reaches the handler gets `⛔ Không có quyền.`. When it is **empty**, the bot answers everyone. `/info` shows `uid=(mở!)` ("open!") in that case.
:::

Other useful bridge settings (all in `bridge/.env`):

| Variable | Default | What it does |
|---|---|---|
| `LUCY_TG_PROXY` | empty | Proxy for every Telegram API call, for networks that block Telegram (e.g. `socks5h://127.0.0.1:<port>`). Claude traffic is not affected. |
| `LUCY_WORKDIR` | `~/lucy-workspace` | Working directory for Claude. Downloads and long replies are saved here. |
| `LUCY_PERSONA` | `~/lucy/bridge/persona.md` | The base persona appended to Claude's system prompt. |
| `LUCY_CLAUDE_TIMEOUT` | `900` | Seconds before a Claude turn is abandoned. |
| `LUCY_BRIDGE_ENGINE` | `persist` | `persist` (one long-lived Claude client per chat, fastest, can be interrupted), `sdk` (one-shot Agent SDK call per message) or `spawn` (`claude -p` per message). |

## How a message is handled

Every chat has its own FIFO queue, so messages are never lost. Each message goes down one of two paths:

| Path | When | What Lucy can do |
|---|---|---|
| **Claude path** | Your model is a `claude:*` key (the default) | Full Claude Code: Read/Write/Edit/Bash/web tools, the memory vault (`--add-dir`), the Lucy persona, persistent sessions. |
| **Lane path** | You picked a cheap "lane" model, or `auto` routed you there | An OpenAI-compatible model via the coordinator, with a small built-in toolset (web search/fetch, read/list/write/edit files, bash, consult an expert persona) and up to 8 tool rounds. No Claude Code tools and no vault directory. See [Models](./models). |

On both paths the bridge first runs a [memory recall](#how-memory-shows-up) and adds relevant notes to your prompt.

## Commands

Commands are case-insensitive. The `@YourBot` suffix that Telegram adds in groups is stripped, so `/new@YourBot` works the same as `/new`. Any other text that starts with `/` (including `/start`) is not a command and goes to Lucy as a normal message.

| Command | What it does |
|---|---|
| `/new` | Start a fresh session. Closes the live Claude client, forgets the session ID, lane histories and short-term context. Replies `✨ Phiên mới…`. |
| `/stop` | Clears every queued message for this chat and interrupts the answer in progress (persist engine). See [Stop and steer](#stop-and-steer). |
| `/restart` | Restarts the bridge itself (`pm2 restart lucy-bridge`), so you don't have to SSH in. |
| `/model [key]` | No argument: shows the model picker buttons. With an argument: switches directly (`/model opus`, `/model claude:haiku`, `/model auto`, `/model groq-gptoss-120b`). |
| `/persona [id]` | No argument: shows the current persona and the list. `/persona researcher` switches; `/persona default` goes back to plain Lucy. |
| `/think on\|off` | Shows or hides a `💭 (suy nghĩ)` block after each answer (up to 1,500 characters). No argument shows the current setting. |
| `/info` | What Lucy is running on: engine, preferred model, persona, think flag, last real model ID, Claude CLI version, owner lock, workdir, persona file, timeout, current session ID. |
| `/ctx` (alias `/context`) | Diagnostics for the last turn: token estimate for each prompt block, memory notes injected (or why recall was skipped), tools used, time to first token, Telegram polling health, command counters, recall health and session context usage. Never prints message or memory content. |
| `/id` | Prints `chat_id` and `user_id`. |
| `/token` (alias `/tokens`) | Today's Telegram usage (Claude path: tokens in/out, approximate USD, turn count, UTC day) and the shared daily [token guard](./models#token-guard) across hub, Telegram and autopilot. |
| `/prompt <task>` | Prompt Architect: turns a rough idea into an optimized prompt you can copy. Add `for=<model>` to target a model: `/prompt for=claude write a polite leave request`. May reply with a clarifying question first. Requires `LUCY_PROMPT_ARCHITECT=1` on the coordinator. |
| `/fan` + one task per line | Runs 2 or more independent tasks **in parallel**, each as its own one-shot Claude agent (Sonnet, max 4 at a time). Each result arrives as `🔹 Lane N`. |
| `/orch <goal>` | Orchestrator: one agent plans 2–5 independent subtasks, sub-agents run them in parallel, and a final agent writes `🧩 TỔNG HỢP` (the combined report). |
| `/auto <goal>` | Autonomous loop: Claude keeps working (resuming its own session) until it ends with `STATUS: DONE`, capped at 8 rounds. Each round is posted. |
| `!o <message>` or `!opus <message>` | Use Opus for this one message only, then go back to your normal model. |

Plain words also work for two of them. The **whole message** has to be one of these:

- Stop: `stop`, `/stop`, `/cancel`, `dừng`, `dung`, `/dung`, `/dừng`, `huy`, `huỷ`, `/huy`, `/huỷ`, `/ngung`, `/ngừng`
- Restart: `restart`, `/restart`, `/reload`, `/khoidong`, `khởi động lại`

Stop and restart are matched against the raw message text before it is queued. In groups, type `/stop` without the `@YourBot` suffix.

### Examples

```text
/fan
summarize today's BTC news
summarize today's gold news
check the USD/VND rate
```

```text
/orch opus compare three self-hosted vector databases for a 4 GB VPS
```

Starting the goal with `opus` (in the first 12 characters) makes `/orch` sub-agents and synthesis, and every `/auto` round, use Opus instead of Sonnet. `/orch` always plans with Sonnet.

```text
/auto add a health-check endpoint to my hub project and run its tests
```

`/fan`, `/orch` and `/auto` run as separate one-shot Claude calls. They don't use your chat session, persona overlay or memory prefetch, and they run in the background, so you can keep chatting.

## Picking a model

Send `/model` with no argument to get inline buttons:

- One button per Claude model from the catalog, marked by tier: `⚡` fast, `✦` balanced, `🧠` deep. Your current choice has a `✅`.
- `🧭 Auto` lets a small router model decide for each message. If the router thinks the message needs tools, or it fails, you get `claude:sonnet`. Otherwise you get a cheap lane model. Lucy tells you which: `🧭 auto → lane …` or `🧭 auto → claude …`.
- `🆓 Lane…` opens a submenu with up to 12 lane models from the catalog. `‹ quay lại` goes back.

Tap a button and the message updates in place to `✅ Đã đổi model → <key>`. The choice is stored per chat (`~/.lucy-bridge-prefs.json`) and survives restarts.

Typed shortcuts work too: `/model sonnet`, `/model opus`, `/model fable`, `/model haiku` expand to `claude:<name>`. Unknown keys are rejected with `❌ Key lạ`.

When you haven't chosen anything, Telegram uses **`claude:sonnet`**. Switching between Claude models keeps the conversation: the live client changes model in place. Each lane model keeps its own history per chat, so switching lanes starts that lane's context fresh. The full model list is on [Models](./models).

## Personas

A persona is a role overlaid on top of Lucy's base persona. Lucy stays Lucy and gains the role's instructions. Personas live in `agent-machine/config/personas/*.json` (the `systemPrompt` field); the IDs are the file names:

`architect`, `builder`, `data`, `designer`, `devops`, `engineer`, `finance`, `grinder`, `investigator`, `marketing`, `orchestrator`, `prompt-architect`, `researcher`, `reviewer`, `reviewer-spec`, `security`, `tester`, `writer`

```text
/persona finance        → ✅ Đổi vai → finance (overlay lên Lucy)
/persona                → shows current + available
/persona default        → back to plain Lucy (also: lucy, none)
```

A persona applies to both paths. On the Claude path, changing persona opens a new Claude client (the system prompt changed) but resumes the same session, so the conversation continues. To add your own persona, drop a new JSON file with a `systemPrompt` in that folder.

## Photos and files

| You send | What happens |
|---|---|
| A photo, or an image sent as a file | Downloaded into the workdir. Lucy opens it with Claude's Read tool (native vision) and answers. Your caption becomes the question. |
| Any other document | Downloaded into the workdir. Lucy is told how to open it: `.txt/.md/.csv/.json/.log` and `.pdf` with Read (PDF pages include images); `.xlsx/.xls` with Python `openpyxl`; `.docx` with Python `python-docx`. With no caption, Lucy summarizes the file. |
| Voice notes, stickers, video, location… | Ignored. The bridge only handles text, photos and documents. |

Photos and files always go to Claude. If your model is a lane, that message is sent to `claude:sonnet` instead, because lanes can't see images or run Claude's file tools. For Excel and Word files, install `openpyxl` and `python-docx` on the server.

Lucy shows progress while downloading (`🖼️ Em đang tải ảnh xuống ạ…`, `📎 Em đang tải file <name> xuống ạ…`) and tells you if Telegram's `getFile` fails. Telegram's Bot API itself only lets bots download files up to about 20 MB.

Lucy can also send files back. Long or table-heavy answers arrive as a `.md` document (see below).

## Streaming, progress and long answers

- **Claude path:** Lucy first posts `🤔 Em xử lý ạ… (<model>)`, then edits that message about once a second with the answer as it streams. Once it is longer than 3,400 characters, the preview shows only the tail.
- **Lane path, `/auto`, `/orch`:** a heartbeat edits the status message every 15 seconds (`◐ Em đang chạy (<model>)… 1m15s`) so you know it's alive.
- **Final answer (Claude path):**
  - Normal length: the streamed message becomes the final text (first 3,900 characters). Anything longer continues in more messages of about 3,800 characters each. Nothing is cut off.
  - If the answer contains a table (6 or more `|`), two or more `#` headings, or is over 7,600 characters, Lucy says `✅ Xong … gửi file ạ` and sends a short teaser plus the full answer as a `.md` document.
- **Final answer (lane path):** replies over 1,600 characters, or with tables or headings, are sent as a `.md` file with a 600-character teaser.

Messages Lucy sends are converted to Telegram MarkdownV2 when `telegramify-markdown` is installed, with a plain-text fallback. Link previews are always disabled. A preview fetch could leak data if a prompt injection slipped a link into an answer.

## Stop and steer

- **Steering:** with the default `persist` engine, sending a new **plain-text** message while Lucy is still answering interrupts the current answer. The text that has already streamed stays, and your new message is handled next in the **same session**, so Lucy follows your latest instruction. Commands such as `/info` or `/token` don't interrupt.
- **`/stop`** clears the queue (`🛑 Đã dừng — xoá N việc đang chờ`) and interrupts the running answer. With the `sdk` or `spawn` engine it can't cut a running turn; the reply says the current job will finish on its own.

::: tip
Because any new text interrupts, write one complete message instead of three quick fragments, or Lucy will only fully answer the last one.
:::

## Sessions

With the default `persist` engine each chat has one **live Claude client**:

- **Persistent:** the session ID is saved in `~/.lucy-bridge-sessions.json`. If the client sits idle for 30 minutes (`LUCY_SDK_IDLE_S=1800`) it is closed to save RAM. Your next message resumes the same session from disk. If that session file was pruned, Lucy quietly starts a fresh one instead of failing.
- **Rotation when context fills:** every 5 turns the bridge checks how full the context window is. At 70% (`LUCY_ROTATE_CTX_PCT`), or after 120 turns (`LUCY_ROTATE_TURNS`), it opens a new client and carries over a small bridge note: corrections and standing rules you gave (up to 6), your last 4 messages, and Lucy's last answer, trimmed. Old transcript is dropped; durable facts live in the vault anyway. Set `LUCY_ROTATE_CTX_PCT=0` to disable.
- **`/new`** wipes everything for the chat, including the carry-over. If `LUCY_SESSION_SUMMARY=1`, the bridge first summarizes the session and saves it as an episode note in the vault (see [Memory](./memory)).
- **Lane histories** are kept per chat and per lane model (last 60 messages, `LUCY_LANE_HIST_MAX`) in `~/.lucy-lane-history.json`.

Use `/ctx` to see the session's turn count, age, rotations and context usage (`Context: 123,456/1,000,000 tok (12%)`).

## How memory shows up

Before every normal message the bridge asks the coordinator to search your vault. It runs in the background, in parallel with the reply setup, with a 4-second timeout. What you'll notice:

- **It's invisible in the chat.** The hits are added to the prompt in a block labelled as low-authority evidence, so Lucy uses them when relevant and must never let them override what you just said.
- **It's selective.** Recall is skipped for commands, short acknowledgements ("ok", "ừ"), corrections ("không phải…", "ý t là…"), pure follow-ups ("cái đó", "option 2") and messages under 12 characters, unless the message clearly asks about the past ("hôm qua", "lần trước", "còn nhớ"…). These cues are written for Vietnamese phrasing; English messages mostly take the default path, which means recall runs when the message is long enough.
- **It's filtered.** At most 5 notes and about 800 characters. Hits with a rerank score below `0.35` (`LUCY_RECALL_MIN_SCORE`) are dropped. Each note carries its source file and age (`⟨Brain/… · 3d trước⟩`), so Lucy can open and verify it.
- **Conversation is logged.** Your messages and Lucy's replies are written to the episodic store (secrets scrubbed first), so later sessions can recall them. Turn off with `LUCY_EPISODIC=0`.

To see what was injected on the last turn, use `/ctx`. It lists the note titles, or the reason recall was skipped, and warns `DEGRADED` if the reranker isn't actually running. Turn recall off with `LUCY_RECALL_PREFETCH=0`. More in [Memory](./memory).

## When Claude runs out

Lucy doesn't just return an error when Claude is unavailable. It drops to the best lane model that still has an API key and tells you:

```text
⚠️ Claude hết token, em chạy tạm bằng `devstral-med` (Claude báo hết token/usage-limit).
```

This fallback triggers when:

1. the shared [token guard](./models#token-guard) has hit its **hard** daily limit (Claude isn't even called), or
2. Claude's reply looks like a usage-limit, rate-limit, `429`, "extra usage" or quota error.

The fallback model is the first one, in this order, whose provider has a key: the `agentic-code` route, then `reasoning`, then the router model, then any free catalog model. If no lane has a key, Lucy goes ahead with Claude and you see whatever Claude returns, including its error. Photos and files can't be read on a lane.

## Limits and tips

- **One owner.** The bridge is built for a single allowed user. It answers that user in any chat, including groups, and ignores everyone else.
- **Timeouts.** A Claude turn longer than `LUCY_CLAUDE_TIMEOUT` (900 s) ends with `⏱️ Claude chạy quá lâu (timeout)` and whatever had streamed. Split big jobs, or use `/auto`.
- **Self-healing.** If polling hasn't succeeded for 240 s (`LUCY_POLL_WATCHDOG_S`), the bridge exits so PM2 restarts it. The update offset is saved, so a restart never replays old messages, and duplicate updates are ignored.
- **`/restart` needs PM2** at `/usr/bin/pm2` and a process named `lucy-bridge`.
- **MCP servers are off in chat** by default for speed (Claude Code's native tools are still there). Set `LUCY_CHAT_MCP=1` and restart the bridge to load them.
- **Register the command menu** with @BotFather (`/setcommands`) so the commands above show up when you type `/`.
- **Language.** The persona speaks Vietnamese ("em" / "chủ nhân"), and status messages are Vietnamese. Edit `bridge/persona.md` to change this.

Related: [Models](./models) · [Memory](./memory) · [Web hub](./web-hub) · [Security](./security)
