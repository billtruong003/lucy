# Installation

This page takes you from an empty Linux server to a running Lucy that answers you on Telegram and serves the web hub over HTTPS. Plan for 30–60 minutes.

## Requirements

| Need | Notes |
|---|---|
| Linux server | A VPS with **2 GB RAM minimum, 4 GB recommended** (several Node processes plus Claude sessions). Ubuntu/Debian are what the scripts were written on. |
| Node.js **20+** and npm | For the coordinator, worker, autopilot, hub and pxpipe. |
| Python **3.10+** and pip | For the Telegram bridge. |
| PM2 | `npm install -g pm2`. Runs and supervises every process. |
| Claude Code CLI | Installed and **logged in** (Claude subscription), or an `ANTHROPIC_API_KEY`. Lucy drives Claude through the CLI and the Agent SDK. |
| Telegram bot | Create one with [@BotFather](https://t.me/BotFather) and keep the token. |
| Build tools | `build-essential` and `python3` for the native `better-sqlite3` module if no prebuilt binary matches your platform. |
| Optional | A domain name, nginx and certbot to serve the hub over HTTPS. Provider API keys for cheap lanes, Jina for vector memory. |

::: warning Install location
Many defaults in the code point at `~/lucy` (for example `~/lucy/.env.llm`, `~/lucy/lucy-vault`, `~/lucy/agent-machine/config/personas`), and a few scripts hard-code `/root/lucy`. The smoothest path is to **clone into `~/lucy` as the user who will run PM2**. The original install runs as `root`; if you use another user, replace `/root` with that user's home in the steps below and see [Paths hard-coded to /root](#paths-hard-coded-to-root).
:::

## 1. Install system packages

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 python3-pip
# Node.js 20 (NodeSource; any Node 20+ install works)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
node -v && python3 --version && pm2 -v
```

## 2. Install and log in to Claude Code

Install the Claude Code CLI using the method in Anthropic's documentation (the native installer puts the binary in `~/.local/bin/claude`), then log in once:

```bash
claude            # follow the login prompt, then exit
which claude      # note this path, you will need it for CLAUDE_BIN
claude -p "2+2" --output-format json   # should print a JSON result
```

If you prefer an API key instead of a subscription login, you will add `ANTHROPIC_API_KEY=...` to `.env.runtime` in step 7.

::: tip Keep Claude's memory in the vault
Claude Code has its own auto-memory. Point it into Lucy's vault so there is only one brain. In `~/.claude/settings.json` add:
```json
{ "autoMemoryDirectory": "~/lucy/lucy-vault/Brain/claude-memory" }
```
:::

## 3. Clone the repository

```bash
cd ~
git clone <repo-url> lucy      # the GitHub repository linked at the top of this site
cd ~/lucy
```

## 4. Install dependencies

Install the agent machine first: the hub server imports code from it.

```bash
cd ~/lucy/agent-machine && npm install
cd ~/lucy/hub/server   && npm install
cd ~/lucy/hub/web      && npm install && npm run build   # produces hub/web/dist, served by the hub
cd ~/lucy/pxpipe       && npm install                    # token-compression proxy
```

The bridge needs three Python packages:

```bash
pip install requests telegramify-markdown claude-agent-sdk
```

- `requests` is required.
- `claude-agent-sdk` enables the default `persist` engine (one live Claude session per chat). Without it the bridge falls back to spawning `claude -p` for every message, which is much slower.
- `telegramify-markdown` converts replies to Telegram formatting. Optional but recommended.

On recent Debian/Ubuntu, pip may refuse system-wide installs ("externally managed environment"). Either add `--break-system-packages`, or create a virtualenv and change the `lucy-bridge` entry in `ecosystem.config.cjs` from `python3` to the venv's interpreter (for example `/root/lucy/bridge/.venv/bin/python`).

## 5. Create the Telegram bot

1. In Telegram, open **@BotFather**, send `/newbot`, and follow the prompts.
2. Copy the bot token. It goes into `TELEGRAM_BOT_TOKEN` in `bridge/.env`.
3. You also need **your numeric Telegram user ID** for `LUCY_ALLOWED_USER_ID`. Any "user info" bot can tell you, or see the tip in step 9.

## 6. Create the vault

The vault is Lucy's long-term memory: plain Markdown, kept in **its own git repository** (it is ignored by the main repo). Create the folders the code reads and writes:

```bash
mkdir -p ~/lucy/lucy-vault && cd ~/lucy/lucy-vault
mkdir -p Context Projects Daily Knowledge Reference Reports Skills \
         Brain/inbox Brain/preferences Brain/episodes Brain/proposals \
         Brain/claude-memory Brain/decisions Brain/entities Brain/agents Brain/log
printf '.index/\n.snapshots/\n*.bak-*\n' > .gitignore
cat > Context/USER.md <<'EOF'
---
title: About the owner
type: context
---

- [work] What you do, in one line #profile
- [preference] How you like answers: short, direct #style
EOF
git init && git add -A && git commit -m "init vault"
```

What the folders are for:

| Folder | Used for | Searched by recall |
|---|---|---|
| `Context/` | Durable facts about you; `Context/USER.md` is the main file Lucy appends to. | yes |
| `Projects/`, `Knowledge/`, `Reference/`, `Reports/`, `Skills/` | Your curated notes. | yes |
| `Daily/` | Session notes written by the agents. | yes |
| `Brain/claude-memory/` | Claude Code auto-memory (see step 2). | yes |
| `Brain/episodes/` | Cross-session summaries (when `LUCY_SESSION_SUMMARY=1`). | yes |
| `Brain/decisions/`, `Brain/entities/`, `Brain/proposals/` | Decisions, entities, nightly consolidation reports. | yes |
| `Brain/inbox/` | Raw signals waiting for the nightly dream. | no |
| `Brain/preferences/`, `Brain/active.md` | Machine-managed preferences produced by the dream. Don't edit by hand. | no |
| `Brain/agents/` | Per-persona lessons learned. | no |
| `.index/` | SQLite search index (`memory.db`). Rebuildable; never commit. | — |

The searched list can be overridden with `LUCY_INDEX_DIRS` (see [Configuration](./configuration#memory-and-recall)). To push the vault to a private remote, add one with `git remote add origin <private-repo-url>`.

## 7. Fill in the environment files

PM2 does **not** read your shell environment (`filter_env: true`). Everything comes from four files that `ecosystem.config.cjs` merges, in this order (a later file overrides an earlier one):

```bash
cd ~/lucy
cp .env.llm.example          .env.llm
cp agent-machine/.env.example agent-machine/.env
cp bridge/.env.example        bridge/.env
cp .env.runtime.example       .env.runtime
chmod 600 .env.llm agent-machine/.env bridge/.env .env.runtime
```

Generate the two secrets:

```bash
openssl rand -hex 32   # use as AM_TOKEN
openssl rand -base64 24  # use as LUCY_HUB_PASSWORD (or pick your own strong one)
```

The minimum you must set:

| File | Variable | Value |
|---|---|---|
| `agent-machine/.env` | `AM_TOKEN` | The generated token. |
| `bridge/.env` | `AM_TOKEN` | **The same token.** |
| `bridge/.env` | `TELEGRAM_BOT_TOKEN` | From @BotFather. |
| `bridge/.env` | `LUCY_ALLOWED_USER_ID` | Your numeric Telegram user ID. |
| `bridge/.env` | `CLAUDE_BIN` | Output of `which claude`. |
| `.env.runtime` | `LUCY_HUB_PASSWORD` | Your hub password. |
| `.env.runtime` | `LUCY_VAULT` | `/root/lucy/lucy-vault` (or your path). |

::: warning Empty values override earlier files
Because the files are merged in order, an empty line like `AM_TOKEN=` in `bridge/.env` replaces the real token from `agent-machine/.env` for every process. Then the coordinator starts **without authentication**. Either set the same value in both files or delete the empty line.
:::

Also check:

- **Paths.** The examples use `/root/...` (`AM_DATA`, `AM_TURNS_LOG`, `LUCY_PROJECTS_ROOT`, `LUCY_STATE`, `LUCY_VAULT`, `CLAUDE_BIN`, `LUCY_WORKDIR`, `LUCY_PERSONA`). Adjust them if you are not running as root.
- **pxpipe.** `bridge/.env` sets `ANTHROPIC_BASE_URL=http://127.0.0.1:47821`. Because the files are shared, this routes the **worker, autopilot and hub** through `lucy-pxpipe` (Telegram chat always goes direct). If you don't want the proxy, delete that line and skip the `lucy-pxpipe` process.
- **API key mode.** If you are not logged in to Claude Code with a subscription, add `ANTHROPIC_API_KEY=...` to `.env.runtime`.
- **Optional keys** in `.env.llm`: cheap-lane providers, `JINA_API_KEY` for vector memory, `GITHUB_TOKEN` and others for MCP. All are described in [Configuration](./configuration).
- Leave `RADIANT_BOT_*` and `LUCY_*_DISCORD_*` empty unless you run that external integration.

## 8. Review the persona and the process list

- `bridge/persona.md` is appended to Claude's system prompt for chat. It ships **in Vietnamese** with the original owner's voice and conventions. Rewrite it for yourself (language, tone, how Lucy addresses you). Keep the parts about the vault layout and memory rules.
- `ecosystem.config.cjs` includes `noteflow-view`, a static viewer pointed at one card workspace from the original install. It is harmless but useless on a new server; remove that entry or `pm2 delete noteflow-view` after starting.

## 9. Start everything with PM2

```bash
cd ~/lucy
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # prints a command; run it so PM2 comes back after a reboot
pm2 ls             # all processes should be "online"
```

If `ecosystem.config.cjs` prints a `[SECURITY]` warning, `LUCY_HUB_PASSWORD` or `AM_TOKEN` is missing.

::: tip Finding your Telegram user ID
Send `/id` to your bot: it replies with `chat_id` and `user_id`. The bridge only answers the allowed user, so to use `/id` you need a working ID first. With `LUCY_ALLOWED_USER_ID` empty the bridge refuses to start, so get your ID from a "user info" bot first. If you really need `/id`, you can start once with `LUCY_ALLOW_ANYONE=1`, which makes the bot answer **anyone**. Only do this briefly, then remove it, set the ID and restart with `pm2 delete lucy-bridge && pm2 start ecosystem.config.cjs --only lucy-bridge`.
:::

## 10. Put the hub behind nginx and HTTPS

The hub listens on `127.0.0.1:8800`. Expose it through nginx:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp ~/lucy/hub/nginx-lucy.conf.example /etc/nginx/sites-available/lucy
sudo nano /etc/nginx/sites-available/lucy     # set server_name to <your-domain>
sudo ln -s /etc/nginx/sites-available/lucy /etc/nginx/sites-enabled/lucy
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <your-domain>          # adds 443 and the HTTP→HTTPS redirect
sudo ufw allow 80,443/tcp
```

The example config proxies `/` to the hub with long read timeouts (1200 s), because Claude jobs can take a while. The hub trusts `X-Forwarded-Proto` from the local proxy, so the login cookie is marked `Secure` when you come in over HTTPS.

::: warning Don't expose plain HTTP
Without a domain and TLS your hub password travels in clear text. If you can't set up TLS, keep the hub private (SSH tunnel: `ssh -L 8800:127.0.0.1:8800 <your-server>`, then open `http://localhost:8800`).
:::

## 11. Schedule the nightly dream

The dream job consolidates memory signals into preferences, then reindexes the vault. It costs no tokens. Add it to the crontab of the user running Lucy (`crontab -e`):

```text
0 2 * * * /root/lucy/bridge/cron_dream.sh >> /root/lucy-workspace/dream-cron.log 2>&1
```

Notes:

- The script loads only `bridge/.env`. If your vault is not at `~/lucy/lucy-vault`, add `LUCY_VAULT=...` to `bridge/.env`.
- It needs `npm` on cron's `PATH`; it appends `/usr/local/bin:/usr/bin`. If Node is installed with nvm, use absolute paths or a wrapper.
- When something changed (or on error) it messages you on Telegram using `TELEGRAM_BOT_TOKEN` and `LUCY_ALLOWED_USER_ID`.
- `bridge/cron_guard.sh <name> <timeout-seconds> <command…>` wraps any cron job with a lock, a timeout, and a kill switch (`touch /root/lucy/KILL_SWITCH` skips all guarded jobs).

::: info Bot language
The bridge's built-in messages (status lines, `/ctx`, errors) are in Vietnamese. Lucy's own replies follow `persona.md` and your language.
:::

## 12. First login to the hub

1. Open `https://<your-domain>` and log in with `LUCY_HUB_PASSWORD`.
2. Go to **Settings** and turn on two-factor authentication: scan the QR code with an authenticator app and confirm a code. From then on, login needs the password plus a 6-digit code.
3. After 5 wrong attempts from one IP, login is blocked for 15 minutes. Sessions last 7 days.

## Verify

Work through this list:

- [ ] `pm2 ls` shows `lucy-bridge`, `lucy-coordinator`, `lucy-vps-worker`, `lucy-autopilot`, `lucy-hub` (and `lucy-pxpipe` if used) **online**, with restart counts not climbing.
- [ ] `curl -s http://127.0.0.1:8780/health` returns `{"ok":true,...}`.
- [ ] `pm2 logs lucy-coordinator --lines 20` shows `recall index: N note` and `vault ON`.
- [ ] `curl -s https://<your-domain>/api/me` returns `{"authed":false,"twofa":...}`.
- [ ] Telegram: send "hi" to your bot and get a reply. `/info` shows `Engine: persist`, your user ID after `uid=` (not `(mở!)`, which means "open to anyone") and `Persona: có` ("present").
- [ ] Telegram: `/ctx` shows a `RECALL:` line. `OK` needs Jina reranking (`LUCY_RERANK=1` + `JINA_API_KEY`); without it you will see `DEGRADED` or `INCONCLUSIVE`, which means recall works but filters by keyword overlap. A line containing `lỗi` (error) means the bridge cannot reach the coordinator.
- [ ] `pm2 logs lucy-bridge --lines 50` has no `RECALL FAIL` lines.
- [ ] `cd ~/lucy/agent-machine && LUCY_VAULT=~/lucy/lucy-vault npm run recall -- stats` prints a learning heartbeat line.
- [ ] `crontab -l` contains the dream line.
- [ ] Hub login works and 2FA is enabled.

## Paths hard-coded to /root

If you don't run as root under `/root/lucy`, these need attention:

| Where | What | Fix |
|---|---|---|
| `.env.*.example` files | `/root/...` paths | Edit the copied env files. |
| `bridge/lucy_bridge.py` | `/restart` command runs `/usr/bin/pm2` | Make sure pm2 is at that path (symlink) or edit the line. |
| `bridge/cron_guard.sh` | Kill switch at `/root/lucy/KILL_SWITCH` | Edit `KS=`. |
| `tools/vault-backup.sh` | `/root/lucy`, backup work dir and the original owner's backup repo | Edit the variables at the top before using it (see [Operations](./operations#backups)). |
| `hub/server/src/index.ts` | VPS file browser roots `/root/lucy`, `/var/www`; VPS cleanup prompts | Cosmetic; edit if you want those tabs to work elsewhere. |
| `agent-machine` code | Reads `~/lucy/.env.llm` and `~/lucy/.gcp-oauth.json` unless `LLM_ENV_FILE` / `GCP_OAUTH_FILE` are set | Clone into `~/lucy`, or set those variables. |

Next: [Configuration](./configuration) for every variable, and [Operations](./operations) for day-to-day running.
