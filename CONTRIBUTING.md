# Contributing to Hetzer

## Development Setup

```bash
git clone https://github.com/agunggnn/hetzer.git
cd hetzer
npm ci
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
node --test cli/core/env.test.mjs
```

## Linting / Checks

```bash
npm run lint
```

This runs `scripts/check.mjs` which validates:
- Module registry schema
- Built-in module definitions
- Compose file references
- Runtime entry points

## Project Structure

```
cli/
  bin/           # CLI entry point (hetzer.js)
  core/          # Core orchestration (env, docker, update, cli, banner, git-hook)
  modules/       # Module registry, resolution, toggle, TUI
  mcp/           # MCP server, protocol, catalog, synthesis
  skills/        # Multi-agent skill installation & rule injection
  vault/         # Encrypted credential vault (SQLite + AES-256-GCM)
  templates/     # Project initialization templates
scripts/
  check.mjs      # Build-time validation
benchmarks/      # Performance benchmarks
packaging/       # Homebrew package manifests
.github/workflows/ci.yml
```

## Code Conventions

- Node 20+ ESM (`"type": "module"` in package.json)
- `node:test` for unit tests (`*.test.mjs`)
- `node --test "**/*.test.mjs"` runs all tests
- Zero external dependencies in runtime `cli/` — Node standard library only
- Export functions at top level, not default
- English error messages and logs for all user-facing output

## Adding a New Module

1. Create `cli/modules/<name>/module.json` (see `builtin.json` for schema)
2. Add `docker-compose.yml` beside it if `lifecycle: "compose"`
3. Run `npm run lint` to validate

## Vault Changes

- Credential encryption: AES-256-GCM via `node:crypto` (see `cli/vault/hetzer-vault.mjs`)
- Master key derived via HKDF-SHA256 with salt `hetzer-grimoire-v1`
- Environment variable: `HETZER_GRIMOIRE_KEY`
- `.env` files created by `init` get `chmod 600` (Unix)
- Any `.env` write in `toggle.mjs` also applies `chmod 600`

## CI Pipeline

- `test` job: Ubuntu/macOS/Windows, Node 22, `npm ci`, `npm run lint`, `npm test`, `npm pack --dry-run`
- `compose-contract` job: Smoke test `hetzer init` + `hetzer doctor` on Ubuntu

## Release

Manual: `npm version patch|minor|major && git push --follow-tags`