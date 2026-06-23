# Contributing

Thanks for your interest in `@codai/sdk`!

> **Note:** This repository is a published mirror of the SDK developed inside
> the codai monorepo. Source changes are made upstream and synced here on
> release. Issues and PRs are welcome and will be triaged upstream.

## Reporting issues

Open an issue with a minimal reproduction, the SDK version, and your runtime
(Node version / edge runtime).

## Pull requests

- Keep changes focused and small.
- Match the existing code style (ESLint + Prettier).
- Add or update tests where it makes sense.
- Do not include any credentials in code, tests, or examples.

## Local development

```bash
pnpm install
pnpm build      # tsup -> dist/
pnpm test       # vitest
pnpm typecheck
```

## Code of Conduct

By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
