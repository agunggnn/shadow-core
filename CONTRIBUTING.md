# Contributing to Shadow Core

## Development Setup

```bash
git clone https://github.com/agunggnn/shadow-core.git
cd shadow-core
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
  bin/           # CLI entry point
  core/          # Core orchestration (env, docker, update, cli)
  modules/       # Module registry, resolution, toggle, TUI
  mcp/           # MCP server, protocol, catalog, synthesis
  vault/         # Encrypted credential vault (SQLite + AES-256-GCM)
  templates/     # Project initialization templates
scripts/
  check.mjs      # Build-time validation
benchmarks/      # Performance benchmarks
.github/workflows/ci.yml
```

## Code Conventions

- Node 22 ESM (`"type": "module"` in package.json)
- `node:test` for unit tests (`*.test.mjs`)
- `node --test "**/*.test.mjs"` runs all tests
- No external deps in `cli/` — stdlib only
- Export functions at top level, not default
- Indonesian error messages where user-facing

## Adding a New Module

1. Create `cli/modules/<name>/module.json` (see `builtin.json` for schema)
2. Add `docker-compose.yml` beside it if `lifecycle: "compose"`
3. Run `npm run lint` to validate

## Vault Changes

- Credential encryption: AES-256-GCM via `node:crypto` (see `cli/vault/shadow-vault.mjs`)
- Master key derived via HKDF-SHA256 with salt `shadow-grimoire-v1`
- `.env` files created by `init` get `chmod 600` (Unix)
- Any `.env` write in `toggle.mjs` also applies `chmod 600`

## CI Pipeline

- `test` job: Ubuntu/macOS/Windows, Node 22, `npm ci`, `npm run lint`, `npm test`, `npm pack --dry-run`
- `compose-contract` job: Smoke test `shadow init` + `shadow doctor` on Ubuntu

## Release

Manual: `npm version patch|minor|major && git push --follow-tags`