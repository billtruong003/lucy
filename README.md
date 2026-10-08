# Lucy

**A self-hosted personal AI agent powered by Claude.** You chat with Lucy from Telegram or a web hub. It remembers you and your projects in a Markdown vault, splits larger jobs across a board of specialist agents, uses tools, skills and MCP servers, and runs scheduled work while you sleep.

[Tiếng Việt](#tiếng-việt) · [Documentation](website/guide/introduction.md)

## What's inside

| Component | Path | Role |
|---|---|---|
| Telegram bridge | `bridge/` | Telegram ↔ Claude Agent SDK, persistent sessions, model picker, multi-agent commands |
| Agent machine | `agent-machine/` | Coordinator API (memory recall, card board, model lanes, token guard), worker, autopilot |
| Web hub | `hub/` | Web cockpit: chat, memory, board, schedules, tools, settings |
| pxpipe | `pxpipe/` | Optional token-compression proxy for background agents |
| Skills | `skills/` | Agent Skills library loaded by keyword |
| Docs site | `website/` | VitePress documentation (English + Vietnamese) |

Long-term memory lives in a separate Markdown vault repository that you create (see [Memory](website/guide/memory.md)).

## Quick start

```bash
git clone https://github.com/billtruong003/lucy && cd lucy
(cd agent-machine && npm ci) && (cd hub/server && npm ci) && (cd hub/web && npm ci && npm run build)
cp .env.llm.example .env.llm; cp .env.runtime.example .env.runtime
cp agent-machine/.env.example agent-machine/.env; cp bridge/.env.example bridge/.env
# fill in the env files, then:
pm2 start ecosystem.config.cjs && pm2 save
```

Full walkthrough: [Installation](website/guide/installation.md) · [Configuration](website/guide/configuration.md).

## Documentation

Read it in the repo under [`website/guide`](website/guide/introduction.md), or run the site locally:

```bash
cd website && npm ci && npm run dev
```

## Status

Lucy runs daily as a personal assistant. This branch is the cleaned codebase being prepared for an open-source release; expect rough edges and Vietnamese-first prompts. See [Security](website/guide/security.md) before exposing it to the internet.

---

## Tiếng Việt

**Lucy là trợ lý AI cá nhân tự host, chạy trên Claude.** Bạn nhắn cho Lucy qua Telegram hoặc web hub. Lucy nhớ bạn và các dự án trong một vault Markdown, chia việc lớn cho nhiều agent chuyên môn trên bảng việc, dùng công cụ, skill, MCP server và chạy việc theo lịch.

Tài liệu tiếng Việt: [`website/vi/guide`](website/vi/guide/introduction.md) · Chạy site: `cd website && npm ci && npm run dev`.

## License

MIT, see [LICENSE](LICENSE). Bundled third-party skills keep their own licenses (see `skills/README.md`).
