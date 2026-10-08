# Automations

Lucy can work while you are not chatting with her. There are four mechanisms:

| Mechanism | Runs in | Typical use |
|---|---|---|
| [Scheduled prompts](#scheduled-prompts-in-the-hub) | `lucy-hub` process | "Every morning at 07:30, research X and send me a brief" |
| [Nightly dream](#nightly-dream-cron) | system `cron` | Consolidate memory every night |
| [Agent autopilot](#agent-autopilot) | `lucy-autopilot` process | Approve routine board gates while you sleep |
| [Your own cron jobs](#adding-your-own-cron-jobs) | system `cron` | Anything else |

## Scheduled prompts in the hub

Open the **Schedule** tab in the [web hub](./web-hub) and click **+ Lịch mới** (new schedule).

| Field | Meaning |
|---|---|
| Tên (name) | A label, also used as the Telegram message heading |
| Prompt | What Lucy should do, written as you would in chat |
| Times | One or more `HH:MM` times, comma-separated, e.g. `07:30,20:00`. Invalid entries are dropped silently |
| Model | `sonnet` (fast, default) or `opus` (deeper) |

Click **Tạo lịch** (create). Each schedule card has:

- a **switch** to enable or pause it,
- **▶ chạy** (run now) to fire it immediately,
- **✕** to delete it (there is no edit; delete and re-create instead),
- the time and status of the **last run** (✓ or ✗) with the first 400 characters of the result.

### How runs work

- A timer in the hub checks every 30 seconds. Each time fires **at most once per day**.
- Times are **wall-clock in the hub's configured offset**, `LUCY_TZ_OFFSET` hours from UTC (default `7`), not in the server's timezone. Set it to your own offset, e.g. `LUCY_TZ_OFFSET=1`.
- Each run is a **fresh Claude session** (no chat history) with the persona and the memory vault attached, in `LUCY_WORKDIR`, with the same full tool access as chat (`bypassPermissions`). Unlike hub chat, scheduled runs do not prepend memory recall.
- Runs are **not caught up**. If the hub is down at 07:30, that day's 07:30 run is skipped.
- Schedules are stored in `$LUCY_STATE/schedules.json` (default `~/.lucy-hub/schedules.json`).

### Where results go

1. **Telegram**, if both variables are set on the hub. The message is `🗓️ Lucy — <name>` followed by the result (cut at about 3,800 characters, link previews off):

   ```ini
   TELEGRAM_BOT_TOKEN=<bot-token>
   LUCY_PUSH_CHAT_ID=<chat-id>        # optional; falls back to LUCY_ALLOWED_USER_ID
   ```

   The chip at the top of the tab shows **📲 Telegram: bật** (on) or **tắt** (off).
2. **Tasks tab.** The full result, as a job named `[lịch] <name>` (kept until the hub restarts).
3. **Logs tab.** `⏰ chạy "<name>"` and `✓`/`✗` lines.

::: tip Good scheduled prompts
Make them self-contained, because the run has no chat context. Say what to produce and how long it should be, e.g. *"Check the BTC, ETH and gold prices, summarise in 5 bullet points, and flag any move over 5% in 24h."*
:::

### System cron (read-only)

Below your schedules, **🛠️ Cron hệ thống** lists the hub user's `crontab -l` entries with a friendly label and time. It is read-only. Edit cron in a shell, or ask Lucy to do it.

## Nightly dream (cron)

"Dream" is Lucy's nightly memory consolidation (see [Memory](./memory)). It is a shell script, `bridge/cron_dream.sh`, run by cron:

```text
0 2 * * * /path/to/lucy/bridge/cron_dream.sh >> /path/to/lucy-workspace/dream-cron.log 2>&1
```

Install it with `crontab -e`. Cron uses the **server's timezone**, so `0 2 * * *` is 02:00 server time.

What one run does, in order:

1. **Preference dream** (`npm run dream` in `agent-machine/`). Processes signals in `Brain/inbox`: graduates new preferences (unconfirmed), confirms, rebuts or retires existing ones, flags contradictions, regenerates `active.md`, and cleans up expired inbox signals. This step is deterministic and uses no tokens.
2. **Per-agent lessons.** When a persona has collected enough raw lessons, a one-shot Claude call condenses them into reusable rules, and old raw lessons are archived. This step is skipped silently if Claude is unavailable.
3. **Memory consolidation.** The script sets `LUCY_CONSOLIDATE=1` and `LUCY_CONSOLIDATE_APPLY=1`, so when vector search is configured (Jina key) duplicate or outdated facts are merged or superseded. A snapshot is taken before applying, and a report is written to `Brain/proposals/consolidate-<date>.md`.
4. **Reindex** (incremental), so recall and the Bộ não tab see notes written that day.
5. **Heartbeat.** One line of memory stats, so you can tell learning is still alive.
6. **Telegram report** to `LUCY_ALLOWED_USER_ID`, if `TELEGRAM_BOT_TOKEN` is set: an error message if dream failed, a summary if memory changed, or only the heartbeat if nothing was new (link previews off).

The script loads `bridge/.env` and uses `LUCY_VAULT` (default `~/lucy/lucy-vault`). To run it by hand:

```bash
bash /path/to/lucy/bridge/cron_dream.sh
tail -n 50 /path/to/lucy-workspace/dream-cron.log
```

The **🌙 Dream** button in the Bộ não tab runs the preference dream on demand through the coordinator.

## Agent autopilot

The autopilot ("Lucy trực đêm", Lucy on night duty) is a background process that keeps the [agent board](./agents) moving when cards stop to wait for a human. It is the `lucy-autopilot` entry in `ecosystem.config.cjs`.

Every 6 seconds (`AM_AUTOPILOT_POLL_MS`) it reads the board and, for each card in **waiting for you**:

| Wait kind | What the autopilot does |
|---|---|
| `gate` | A "director" Claude call (`AM_DIRECTOR_MODEL`, default `opus`) reads the stage report and **approves** or **rejects with feedback**. If it is unsure, it escalates to you |
| `decision` | The director answers the agent's question, or escalates to you |
| `cost` | If the card has spent `AM_CARD_HARD_USD` (default `8`) or more, it escalates to you. Otherwise the director decides whether to continue |

Guardrails:

- **Protected gates are never auto-approved:** stages run by the `devops` or `security` personas, and the whole `secure-ship` pipeline.
- **Decision cap.** It stops after `AM_AUTOPILOT_MAX` decisions (the ecosystem file sets `50`; the code default is `100`). Restart the process to reset the count.
- **Token guard.** At the daily soft limit, executors are downgraded to the cheapest model and you get a Telegram warning. At the hard limit, the autopilot stops handling cards and new cards wait for you. See [Security](./security#token-guard).
- **Transparency.** Every action is posted as `🌙 Lucy trực đêm [token status] — …` in the project's `general` channel and shows up in **Dashboard → Cho Lucy → Nhật ký trực đêm**.

Turn it on or off with PM2:

```bash
pm2 start ecosystem.config.cjs --only lucy-autopilot
pm2 stop lucy-autopilot
pm2 logs lucy-autopilot --lines 50
```

::: warning
Agents work in clones under `agent-machine/.worker/` and do not push. Still, an approved gate means code changes move forward without you reading them. Start with a low `AM_AUTOPILOT_MAX` and review the night log in the morning.
:::

## Adding your own cron jobs

You can schedule any script with cron, for example a backup or a report. Some rules keep it safe:

1. **Use a script file, not a long one-liner.** Put it in your own folder (e.g. `~/lucy-cron/`), make it executable, and start it with `set -euo pipefail`.
2. **Load secrets from an env file,** the way `cron_dream.sh` does. Never write tokens into the crontab line:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   set -a; . /path/to/lucy/bridge/.env; set +a      # TELEGRAM_BOT_TOKEN, LUCY_ALLOWED_USER_ID
   export PATH="$PATH:/usr/local/bin:/usr/bin"       # cron has a minimal PATH
   # ... your job ...
   ```

3. **Always redirect output to a log** and keep it small (rotate it, or let `logrotate` handle it):

   ```cron
   30 6 * * 1 /home/lucy/lucy-cron/weekly-report.sh >> /home/lucy/lucy-cron/weekly-report.log 2>&1
   ```

4. **Prevent overlap** for long jobs: `flock -n /tmp/weekly-report.lock /home/lucy/lucy-cron/weekly-report.sh`.
5. **If the job calls Claude** (`claude -p ...`), remember that it has whatever permissions you give it. Prefer a narrow prompt and `--allowedTools` over `bypassPermissions`, and never pipe untrusted web content straight into a prompt that has shell access.
6. **Send messages with link previews disabled** if you notify through Telegram (add `link_preview_options`, as the bridge does).
7. **Check it once by hand** before relying on it, then look at the log after the first scheduled run.

Cron jobs appear read-only in the hub's Schedule tab and in the VPS tree of the Tinh hà tab.

::: tip Cron or hub schedule?
If the task is "ask Lucy something every day", use the **hub schedule**: no shell needed, and results go to Telegram. Use **cron** for scripts that do not need the hub, or that must run even when the hub is down.
:::
