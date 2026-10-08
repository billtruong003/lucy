# Operations & troubleshooting

Day-to-day running of a Lucy install: PM2, logs, updates, backups, health checks, and fixes for the failures that have actually happened in production.

## PM2 basics

All processes are defined in `ecosystem.config.cjs` at the repository root.

```bash
cd ~/lucy
pm2 ls                                   # status, restarts, CPU, memory
pm2 logs lucy-bridge --lines 50          # tail one process
pm2 restart lucy-bridge                  # restart one process (keeps its env)
pm2 start ecosystem.config.cjs && pm2 save   # (re)create everything from the ecosystem file
pm2 stop lucy-autopilot                  # pause the night-shift autopilot
pm2 describe lucy-coordinator            # details: script, cwd, log paths, restart count
pm2 save                                 # remember the current process list for reboot
```

### After changing configuration

PM2 reads the environment only when it **creates** a process. `pm2 restart` reuses the old environment. After editing any env file:

```bash
pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>
pm2 save
```

Since all four env files are shared, a change that affects several processes means recreating each of them (or all: `pm2 delete all && pm2 start ecosystem.config.cjs && pm2 save`).

### What to restart after what

| You changed | Do this |
|---|---|
| `bridge/lucy_bridge.py` | `pm2 restart lucy-bridge` (or send `/restart` to the bot). |
| `bridge/persona.md` | Nothing to restart: the file is read when a session opens. Send `/new` so the chat opens a fresh session with the new persona. |
| Any env file | `pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>` for each affected process. |
| `agent-machine/src/*` | `pm2 restart lucy-coordinator lucy-vps-worker lucy-autopilot`. The hub imports some agent-machine code, so restart `lucy-hub` too. |
| `agent-machine/config/` (personas, pipelines) | `pm2 restart lucy-coordinator`. |
| Vault notes edited by hand | Nothing: the coordinator reindexes changed files incrementally. For a full rebuild: `pm2 restart lucy-coordinator`. |
| `hub/server/src/*` | `pm2 restart lucy-hub`. |
| `hub/web/src/*` | `cd hub/web && npm run build`, then reload the browser (no restart needed). |
| `package.json` in any part | `npm install` in that folder, then restart its processes. |
| Claude Code CLI updated | `pm2 restart lucy-bridge lucy-hub lucy-vps-worker lucy-autopilot` so live sessions pick up the new version. |
| `ecosystem.config.cjs` | `pm2 delete all && pm2 start ecosystem.config.cjs && pm2 save`. |

## Logs

| What | Where |
|---|---|
| Process stdout/stderr | `~/.pm2/logs/<name>-out.log` and `<name>-error.log`; view with `pm2 logs <name>`. Clear with `pm2 flush`. |
| Hub events (logins, schedules, jobs) | `$LUCY_STATE/log.jsonl` (default `~/.lucy-hub/log.jsonl`), and the hub's **Logs** tab. |
| Nightly dream | The file you redirect to in the crontab, e.g. `~/lucy-workspace/dream-cron.log`. |
| Agent turns | JSONL files under `AM_TURNS_LOG`, if set. Summarise with `cd agent-machine && npm run stats:errors`. |
| Consolidation reports | `Brain/proposals/consolidate-<date>.md` in the vault. |
| Bridge receive status | `~/.lucy-bridge-status.json`; read it with `python3 bridge/tg_diag.py`. |

Secrets are scrubbed from bridge logs (the bot token is replaced with `<bot-token>`), but treat logs as private anyway. Set up `pm2 install pm2-logrotate` if disk space matters.

## Updating

```bash
cd ~/lucy
git pull
(cd agent-machine && npm install)
(cd hub/server && npm install)
(cd hub/web && npm install && npm run build)
(cd pxpipe && npm install)
pip install -U requests telegramify-markdown claude-agent-sdk
pm2 restart all
```

Skip the `npm install` steps whose `package.json` didn't change. Compare the `*.env.example` files with your env files after a pull (`git diff HEAD@{1} -- '*.example'`) and add any new variables. If `ecosystem.config.cjs` changed, recreate the processes instead of restarting them.

To check a change before deploying it:

```bash
(cd agent-machine && npx tsc --noEmit && npm run smoke && npm run smoke:token-guard)
(cd hub/server && npx tsc --noEmit) && (cd hub/web && npx tsc --noEmit)
(cd bridge && python3 smoke_tg_router.py)
```

## Backups

### The vault

The vault is a git repository of Markdown files, separate from the code. Commit and push it to a **private** remote regularly, for example with a cron entry:

```text
30 3 * * * cd /root/lucy/lucy-vault && git add -A && (git diff --cached --quiet || git commit -qm "vault $(date +\%F)") && git push -q
```

The search index (`.index/`) and the dream's safety snapshots (`.snapshots/`) are excluded by the vault's `.gitignore`. The index can always be rebuilt: `cd agent-machine && LUCY_VAULT=~/lucy/lucy-vault npm run reindex`.

`tools/vault-backup.sh` is the original install's mirror script. Before using it, edit the variables at the top (`LUCY`, `VAULT_DIR`, `WORK`, and `REPO_SLUG`, which points at the original owner's repository). Also note that:

- it runs in dry-run mode unless `DRY=0`;
- it refuses to run if the vault has fewer than 1000 files (a safety gate against an empty or wrong path);
- it reads `GITHUB_TOKEN` from the running `lucy-bridge` process environment.

### Everything else worth keeping

| What | Path | Why |
|---|---|---|
| Env files | `.env.llm`, `.env.runtime`, `agent-machine/.env`, `bridge/.env` | Your keys and settings. Store encrypted. |
| Hub state | `$LUCY_STATE` (`~/.lucy-hub`) | 2FA secret, schedules, hub chat history. |
| Coordinator data | `$AM_DATA` | Board, cards, token ledger. |
| Claude Code | `~/.claude/` | Login, settings, and session transcripts used to resume chats. |
| Bridge state | `~/.lucy-bridge-*.json`, `~/.lucy-*-history.json` | Chat→session map and preferences. Disposable. |

## Health checks

```bash
# Coordinator (no auth needed for /health)
curl -s http://127.0.0.1:8780/health
# Coordinator, authenticated endpoints
curl -s -H "x-worker-token: $AM_TOKEN" http://127.0.0.1:8780/token-guard
curl -s -H "x-worker-token: $AM_TOKEN" http://127.0.0.1:8780/llm/guard
# Hub (through nginx)
curl -s https://<your-server>/api/me          # {"authed":false,"twofa":true}
# Memory heartbeat
cd ~/lucy/agent-machine && LUCY_VAULT=~/lucy/lucy-vault npm run recall -- stats
# Telegram receive path, without polling Telegram
python3 ~/lucy/bridge/tg_diag.py
```

`$AM_TOKEN` is not in your shell, because the env files are not sourced. Paste the value or use `source <(grep ^AM_TOKEN= ~/lucy/agent-machine/.env)` for a one-off check.

From Telegram:

| Command | Shows |
|---|---|
| `/info` | Engine (`persist`/`sdk`/`spawn`), model, permissions, working directory. |
| `/ctx` | Recall status, receive-path counters, current session size and context usage. |
| `/token` | Today's token usage. |

In the hub, the **VPS** tab shows PM2 processes with CPU, memory and restart counts.

Watch the **restart count** in `pm2 ls`. A number that keeps climbing is a crash loop: see below.

## Troubleshooting

### Chat replies "❌ Lỗi stream (SDK): … exit code 1"

**Cause:** the bridge tried to resume a Claude session whose transcript no longer exists (for example after `~/.claude/projects` was cleaned or the vault was wiped). Claude exits with "No conversation found".

**Fix:** current code checks that the session file exists before resuming, and retries once without resume, so this should heal itself. If it keeps happening:

1. Send `/new` to the bot.
2. If that doesn't help, remove the chat's entry from `~/.lucy-bridge-sessions.json` (chat ID → session ID), or delete the file.
3. `pm2 restart lucy-bridge`.

### Lucy forgets who she is

**Symptom:** Lucy calls herself "Claude, made by Anthropic", or ignores the tone and conventions in `persona.md`.

**Cause:** the chat request went through `lucy-pxpipe`. Token compression drops the persona appended to the system prompt for models listed in `PXPIPE_MODELS`.

**Fix:** bridge chat removes `ANTHROPIC_BASE_URL` and talks to Anthropic directly. Don't change that. If you see this in the **hub** chat (which inherits `ANTHROPIC_BASE_URL`), remove the variable from `bridge/.env` and recreate `lucy-hub`, or take that model out of `PXPIPE_MODELS`. Also check that `LUCY_PERSONA` points to an existing file and that the logs don't show `BUDGET: khối persona … → cắt` (persona truncated; raise `LUCY_BUDGET_PERSONA`).

### The bot is online but never answers (Telegram conflict)

Telegram allows **one consumer per bot token**. A second process calling `getUpdates` (another copy of the bridge on a different server or your laptop, a leftover PM2 process, a diagnostic script) either steals messages or makes Telegram answer `409 Conflict`. A webhook set on the bot has the same effect.

**Check and fix:**

```bash
pm2 ls                                    # only one lucy-bridge, on only one machine
curl -s https://api.telegram.org/bot<bot-token>/getWebhookInfo      # "url" should be empty
curl -s https://api.telegram.org/bot<bot-token>/deleteWebhook       # if a webhook is set
python3 ~/lucy/bridge/tg_diag.py          # last update time, offset, ignored updates
```

Never call `getUpdates` by hand while the bridge is running: the messages you fetch are consumed and never reach Lucy. `bridge/tg_guard.py` refuses diagnostic polling while the bridge is online.

### The bot goes deaf, then restarts

If no Telegram poll succeeds for `LUCY_POLL_WATCHDOG_S` seconds (default 240), the bridge prints `WATCHDOG: … KHÔNG nhận được gì từ Telegram` and exits so PM2 restarts it. Repeated watchdog restarts usually mean the server can't reach `api.telegram.org`. If your network blocks Telegram, set `LUCY_TG_PROXY` (for example a local SOCKS proxy).

### Missing or wrong environment

| Symptom | Cause |
|---|---|
| `lucy-bridge` crash-loops with `KeyError: 'TELEGRAM_BOT_TOKEN'` | Token missing from `bridge/.env`. |
| Bot replies `⛔ Không có quyền.` ("not allowed") | Your user ID doesn't match `LUCY_ALLOWED_USER_ID`. Check it with `/id`. |
| Bridge exits with `LUCY_ALLOWED_USER_ID chưa đặt trong bridge/.env — từ chối khởi động` | `LUCY_ALLOWED_USER_ID` is empty. Set it and restart the bridge. |
| Bot answers anyone | `LUCY_ALLOW_ANYONE=1` is set with an empty `LUCY_ALLOWED_USER_ID`. Remove it and set the ID now. |
| `ecosystem.config.cjs` prints `[SECURITY] LUCY_HUB_PASSWORD …` and every hub login fails | `LUCY_HUB_PASSWORD` missing from `.env.runtime`. |
| Coordinator log: `AM_TOKEN trống — endpoint /worker KHÔNG có auth` | `AM_TOKEN` empty, often blanked by an empty `AM_TOKEN=` line in a later env file. |
| Bridge log: `RECALL FAIL … 401` | Bridge `AM_TOKEN` differs from the coordinator's. |
| Coordinator log has no `vault ON`; brain tabs empty | `LUCY_VAULT` doesn't point at an existing folder. |
| Worker logs `runner=MOCK` | `AM_RUNNER` isn't `claude`; the worker isn't spending tokens and does no real work. |
| Variable "set" but ignored | You restarted instead of recreating the process, or you exported it in the shell. See [After changing configuration](#after-changing-configuration). |

List which variables a running process actually received (names only, since values are secrets):

```bash
pm2 env $(pm2 id lucy-bridge | tr -dc '0-9') | grep -E '^(LUCY_|AM_)' | cut -d: -f1
```

### Worker, autopilot or hub can't reach Claude

If `ANTHROPIC_BASE_URL` points at pxpipe and `lucy-pxpipe` is stopped, every Claude call from those processes fails with a connection error. Start it (`pm2 start ecosystem.config.cjs --only lucy-pxpipe`) or remove `ANTHROPIC_BASE_URL` from `bridge/.env` and recreate the processes.

### A process restarts thousands of times

A crash loop (typically missing `node_modules` or a missing file) keeps PM2 busy and can eat a whole CPU core. Stop the process first, then fix it:

```bash
pm2 stop <name>
pm2 logs <name> --err --lines 50
# fix (npm install, env, path), then:
pm2 start <name>
```

Don't start a stopped process again until you have fixed the cause.

### Claude usage limit reached

When a Claude reply looks like a usage or rate limit, or the daily token guard hits its hard limit, the bridge falls back to the best available cheap lane (one with a configured provider key) and says why. With no provider keys there is no fallback, so you wait for the limit to reset. Check `/token` and `curl … /token-guard`; raise `AM_DAY_TOKEN_SOFT` / `AM_DAY_TOKEN_HARD` if the defaults don't fit.

### Recall returns nothing or stale notes

- Check `/ctx` for the `RECALL:` line and the bridge log for `RECALL FAIL`.
- Rebuild the index: `pm2 restart lucy-coordinator`, or `cd agent-machine && LUCY_VAULT=… npm run reindex`.
- Make sure the notes are in an indexed folder (see `LUCY_INDEX_DIRS`). `Brain/inbox` and `Brain/preferences` are deliberately not searched.

### Hub login problems

- `429 too_many_attempts`: 5 failed logins from your IP in 15 minutes. Wait, or `pm2 restart lucy-hub` (the counter is in memory).
- Lost your authenticator: delete `$LUCY_STATE/twofa.json` and `pm2 restart lucy-hub`. Log in with the password and enable 2FA again.
- Logged out after a restart: hub sessions are kept in memory, so restarting the hub logs everyone out.

### QA scripts changed my memory

The `bridge/qa_*.py` scripts talk to the real Lucy, and she writes to the vault while they run: a hypothetical line in a test once became a "durable preference". Turning off episodic logging is not enough, because Lucy's file tools write too. Wrap every QA run:

```bash
bash ~/lucy/bridge/qa_vault_guard.sh snapshot   # before
# … run the qa_*.py script …
bash ~/lucy/bridge/qa_vault_guard.sh diff       # what the test touched
bash ~/lucy/bridge/qa_vault_guard.sh restore    # put the vault back
```

It protects `Brain/claude-memory`, `Context` and `Brain/inbox`, and stores the snapshot in `/root/lucy/.state/vault-snapshot`.

### Stop everything in an emergency

```bash
pm2 stop all                       # stop Lucy
touch /root/lucy/KILL_SWITCH       # make every cron_guard-wrapped job skip
```

Undo with `pm2 start all` and `rm /root/lucy/KILL_SWITCH`.

## FAQ

**Can I run Lucy without Telegram?**
Yes. Don't start the bridge (`pm2 delete lucy-bridge && pm2 save`) and use the web hub. Telegram notifications from the dream cron and the hub schedules are skipped when no bot token is set.

**Can I use an Anthropic API key instead of a subscription?**
Yes. Put `ANTHROPIC_API_KEY` in `.env.runtime` and recreate the processes. Usage is then billed per token, so consider lowering the budget caps.

**Can more than one person use the same Lucy?**
No. Lucy is single-owner by design: one allowed Telegram user, one hub password, one memory.

**Can I open the vault in Obsidian?**
Yes. It's plain Markdown with frontmatter. Clone the vault's private repo on your computer, and pull/push alongside the server. Don't edit `Brain/preferences/` or `Brain/active.md`: the dream rewrites them.

**Where does Lucy store a chat?**
Telegram sessions live in Claude Code's transcripts (`~/.claude/projects/`), mapped per chat in `~/.lucy-bridge-sessions.json`. Hub chats are in `$LUCY_STATE/chat.json`. Conversation turns are also logged into the vault index for recall when episodic memory is on.

**How do I change the timezone?**
Set `LUCY_TZ_OFFSET` (hours from UTC) in `.env.runtime` and recreate the processes. The dream cron runs in the server's local time, so adjust the crontab too.

**How do I reset a conversation?**
Send `/new`. It closes the live session and forgets the recent thread for that chat.
