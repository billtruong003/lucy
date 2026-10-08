# Lucy

**A self-hosted personal AI agent built on Claude.** Talk to it from Telegram or the web, and it remembers you, your projects and how you work. It can split a job across several agents, use your tools, and run scheduled work while you sleep.

[Tiếng Việt](README.vi.md)

> **Status: pre-alpha, under active rebuild.** Lucy has run as a private assistant since mid-2026. This repository is the clean, open-source rebuild of it. The code is landing module by module (see [ROADMAP](docs/ROADMAP.md)), so the quickstart below describes the target experience.

## What Lucy does

| | |
|---|---|
| **Chat anywhere** | Telegram and a web app share one conversation history and one brain. Replies stream, and you can stop or redirect them mid-answer. |
| **Long-term memory** | Memory is a folder of plain Markdown (an "Obsidian-compatible vault"). Lucy recalls relevant notes on every turn (full-text + vector search), and a nightly "dream" pass consolidates new facts, merges duplicates and expires stale ones. You can read and edit all of it. |
| **Multi-agent engine** | Hand Lucy a larger job and it becomes cards on a board. Workers pick them up, specialist personas (planner, builder, reviewer…) pass work along a pipeline, and an optional autopilot approves routine gates. Budgets and a token guard keep spend bounded. |
| **Tools & MCP** | Lucy uses Claude Code's tools (files, shell, web) plus any MCP server you connect, and a library of Agent Skills. |
| **Automations** | Scheduled prompts (daily brief, weekly review, inbox triage…) delivered to Telegram or the web. |
| **Cheap lanes (optional)** | Route light tasks to any OpenAI-compatible provider (free or cheap models) while Claude stays the brain. |

## Quickstart (target)

```bash
git clone https://github.com/billtruong003/lucy && cd lucy
npx lucy init      # asks for: Claude login, Telegram bot token (optional), web password; creates your vault
npx lucy start     # one process: API + web + Telegram + worker
```

Or with Docker: `docker compose up -d` after `lucy init`.

**Requirements:** Node.js 20+, a Claude subscription or Anthropic API key, and optionally a Telegram bot from [@BotFather](https://t.me/BotFather).

## Architecture

```
 Telegram ─┐                        ┌─ memory   (vault · recall · dream)
 Web app ──┼─► server (API, auth) ──┼─ core     (Claude sessions · personas · prompts)
 CLI ──────┘                        ├─ engine   (cards · workers · autopilot · budgets)
                                    └─ llm      (optional OpenAI-compatible lanes)
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

| | EN | VI |
|---|---|---|
| Architecture | [ARCHITECTURE](docs/ARCHITECTURE.md) | [Kiến trúc](docs/vi/ARCHITECTURE.md) |
| Roadmap | [ROADMAP](docs/ROADMAP.md) | [Lộ trình](docs/vi/ROADMAP.md) |
| Security | [SECURITY](SECURITY.md) | |
| Contributing | [CONTRIBUTING](CONTRIBUTING.md) | |

## License

[MIT](LICENSE). Third-party components keep their own licenses; see `NOTICE` once they land.
