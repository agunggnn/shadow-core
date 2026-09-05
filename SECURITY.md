# Security policy

## Supported versions

Security fixes are applied to the latest tagged release and the `main` branch.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability or exposed credential.
Use GitHub's private vulnerability reporting for this repository. Include the
affected version, operating system, reproduction steps, and likely impact.

## Deployment boundary

- Hetzer binds services to loopback by default. Treat any non-loopback binding
  as a separate deployment that needs TLS, firewall policy, and authentication.
- `.env`, `.mcp.json`, `data/`, logs, backups, and Cognee volumes may contain
  sensitive information and are ignored by Git.
- Grimoire encrypts application credentials at rest. `HETZER_GRIMOIRE_KEY`
  is the external unlock boundary and must be stored separately from copied
  Vault databases.
- Container images are pinned by digest. Review digest changes as dependency
  upgrades, including upstream release notes and licenses.
- MCP tools can cause actions in connected services. Review each enabled module
  and client permission before allowing automation.
