# Contributing

Lucy is being rebuilt in the open; see [docs/ROADMAP.md](docs/ROADMAP.md) for what is in flight.

- Open an issue before a large change so we can agree on the shape.
- Keep packages behind their public `index.ts`; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- User-facing strings and prompts go through `packages/i18n` with both `en` and `vi`.
- Never commit secrets, personal data or vault content. CI runs gitleaks on every push.
- `pnpm lint && pnpm typecheck && pnpm test` must pass.

Issues and PRs are welcome in English or Vietnamese.
