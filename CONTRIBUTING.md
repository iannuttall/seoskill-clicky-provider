# Contributing

Use [GitHub Issues](https://github.com/iannuttall/seoskill-clicky-provider/issues) for questions, bugs, and proposals. Search existing issues first and keep one problem in each issue.

Use the private process in [SECURITY.md](SECURITY.md) for suspected vulnerabilities. Never post sitekeys, analytics data, private URLs, or client data publicly.

## Before writing code

- Reproduce the problem with the smallest fake fixture.
- Preserve Clicky metric names and limits at the adapter boundary.
- Keep missing, invalid, partial, capped, and complete data separate.
- Do not map Clicky visits to Google Analytics users, conversions, attribution, or geography.
- Add a regression test for each behavior change.

## Local checks

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm pack --dry-run
```

Keep pull requests focused. Use conventional commit subjects. Contributions use the Apache-2.0 license in [LICENSE](LICENSE).
