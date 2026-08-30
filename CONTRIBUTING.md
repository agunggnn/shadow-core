# Contributing

Open an issue before a large architectural change. Small fixes can go directly
to a pull request.

Keep contributions within the public boundary: headless core, cross-platform
CLI/TUI, Grimoire, MCP, and opt-in public modules. Do not submit private service
adapters, credentials, user data, or dashboard experiments.

Before opening a pull request:

```bash
npm install
npm run check
npm pack --dry-run
```

Add tests for behavior changes. Keep optional modules disabled by default, bind
new services to loopback, and pin container images by multi-platform digest.
By contributing, you agree that your contribution is licensed under Apache-2.0.
