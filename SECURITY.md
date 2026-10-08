# Security

Lucy runs an AI agent with access to your files, shell and accounts. Treat a Lucy install like SSH access to the machine it runs on.

## Defaults
- The server listens on `127.0.0.1`. Expose it only through a reverse proxy with TLS.
- Chat channels answer only allow-listed user IDs.
- Claude runs with a per-persona tool allow-list. `bypassPermissions` is opt-in and logged at startup.
- Secrets live in `.env` only and are redacted before anything is written to the vault or logs.

## Reporting a vulnerability
Please do not open a public issue. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability"). You should get a reply within 7 days.
