# Shadow Core

Shadow Core is the public, headless part of Shadow: a local-first command plane
for 9Router, encrypted credentials, MCP tools, and an honest terminal operations
view. Cognee persistent memory is available as an optional module.

The experimental web dashboard and Shadow Pet are deliberately not included in
this repository yet.

## What is included

- A single Node.js CLI on Windows, macOS, and Linux.
- Docker Compose lifecycle management with immutable image digests.
- Grimoire, an AES-256-GCM credential vault with scoped `secretRef` injection.
- A local MCP bridge for enabled Shadow services.
- A two-second TUI that reports observed health and marks unavailable values as
  `N/A`; it does not invent quotas, routes, or agent state.
- Optional Cognee memory through its native `remember`, `recall`, `improve`, and
  `forget_memory` MCP tools.

## Requirements

- Node.js 22.5 or newer.
- Docker with Compose v2.
- Windows 10/11, a supported macOS release, or a modern Linux distribution.

The CLI itself is native Node.js on every OS. Containers use Linux AMD64/ARM64
images through Docker Desktop, Colima, or Docker Engine.

## Quick start

```bash
git clone https://github.com/agunggnn/shadow-core.git
cd shadow-core
npm install
npm link
shadow init
shadow doctor
shadow up
shadow tui
```

`shadow init` generates the core credentials, encrypts them in `data/shadow-vault.db`,
and leaves only `secretRef` bindings in `.env`. Keep the generated
`SHADOW_GRIMOIRE_KEY` outside backups that leave your machine.

## Optional Cognee memory

Cognee is disabled by default and is a separate MCP server rather than a hidden
dependency of Shadow Core.

1. Put your provider key in `COGNEE_LLM_API_KEY` in `.env`.
2. Run `shadow init` again. This moves the key into Grimoire.
3. Run `shadow install cognee`.
4. Run `shadow up cognee`.
5. Run `shadow mcp configure`.

The last command registers `http://127.0.0.1:8001/mcp` in the project's
`.mcp.json`. Provider and local Ollama examples are in
[`docs/modules/cognee.md`](docs/modules/cognee.md).

## Commands

```text
shadow init [directory]       initialize or re-secure a project
shadow doctor                 validate Docker and Compose configuration
shadow up [module|all]        pull and start the selected profiles
shadow down                   stop services without deleting volumes
shadow status                 show container and image state
shadow logs [service]         follow logs
shadow modules                list module state
shadow install|remove <id>    enable or disable an optional module
shadow mcp configure|serve    configure or run MCP
shadow tui                    open the terminal operations view
```

## Security boundary

Network ports bind to `127.0.0.1` by default. Changing
`SHADOW_BIND_ADDRESS` expands the trust boundary and requires your own firewall,
TLS, and authentication review. Never commit `.env`, `.mcp.json`, `data/`,
logs, or exported memory.

See [`SECURITY.md`](SECURITY.md) for reporting and deployment guidance.

## Development and releases

```bash
npm run check
npm pack --dry-run
```

This repository starts from a clean public history. Development that contains
private integrations remains outside this repository and reaches this tree only
through an allowlist export.

Licensed under Apache-2.0. Third-party container images retain their own licenses;
see [`NOTICE`](NOTICE).
