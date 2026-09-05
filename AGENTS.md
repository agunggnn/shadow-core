# Hetzer contributor guidance

- Keep the default runtime small: 9Router, the Node CLI, Grimoire, MCP, and TUI.
- Optional services belong in `modules/<id>/` and must be disabled by default.
- Do not add a web dashboard until it has a separate, reviewed release contract.
- Never commit credentials, `.env`, Vault databases, logs, backups, or user data.
- Keep Linux, macOS, and Windows behavior equivalent; prefer Node APIs over shell-specific code.
- Pin container images by multi-platform digest and document their upstream source.
- Run `npm run check` before every release.

<!-- hetzer:start -->
## 🛡️ Hetzer: Zero-Plaintext Armor & Secret Vault
- NEVER print secret tokens, passwords, or API keys in plaintext in conversation, code, or logs.
- Always use references: `secretRef:<credential-id>` (e.g. `secretRef:npm-token`, `secretRef:openai-api-key`).
- Ephemeral injection & sub-2ms Sniffer protects all agent interactions.
- User management command: `hetzer creds set <id>`.
<!-- hetzer:end -->
