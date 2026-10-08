# Roadmap

[Tiếng Việt](vi/ROADMAP.md)

The rebuild ships in phases. Each phase is one or more PRs, and each phase leaves `main` working.

## Phase 0: Foundation
- [x] Repository, license, README (en/vi), architecture
- [ ] pnpm workspace, TypeScript config, lint/format, vitest
- [ ] CI: typecheck, test, gitleaks secret scan
- [ ] `packages/config` schema + `lucy doctor`
- [ ] `packages/i18n` (en, vi)

## Phase 1: Assistant core
- [ ] `packages/core`: persistent Claude sessions, personas, permission policy, usage
- [ ] `packages/memory`: vault, recall, dream, redaction (ported with tests)
- [ ] `apps/telegram`: port of the bridge (commands: /new /stop /model /persona /info)
- [ ] `apps/cli`: `init`, `start`, `doctor`
- [ ] `vault-template/`

## Phase 2: Server and web
- [ ] `packages/server`: auth, chat + SSE, memory, schedules, settings
- [ ] `apps/web` v1 with 6 screens: Chat · Memory · Board · Automations · Tools · Settings
- [ ] Neutral default theme, design tokens enforced by lint, lazy routes

## Phase 3: Agent engine
- [ ] `packages/engine`: cards, pipelines, workers (git worktrees), autopilot, budgets, token guard
- [ ] Board UI, delegate from chat
- [ ] `packages/llm`: OpenAI-compatible lanes + router

## Phase 4: Install and docs
- [ ] Docker image + compose, systemd/pm2/nginx examples
- [ ] Docs (en/vi): install, configuration, memory, engine, skills, plugins, security
- [ ] Plugin API + first plugins (google, discord)

## Phase 5: Public release
- [ ] Security review, end-to-end tests
- [ ] Demo media, v0.1.0 tag, repository made public
