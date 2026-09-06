<!-- hetzer:start -->
## 🛡️ Hetzer: Zero-Plaintext Armor & Secret Vault
- NEVER print secret tokens, passwords, or API keys in plaintext in conversation, code, or logs.
- Always use references: `secretRef:<credential-id>` (e.g. `secretRef:npm-token`, `secretRef:openai-api-key`).
- Execute with scoped injection: `hetzer exec --allow <id> -- <cmd>` (never run `creds reveal` or `printenv`).
- Ephemeral injection, sub-2ms Sniffer & real-time stream interceptor protect all agent interactions.
- User management command: `hetzer creds set <id>`.
<!-- hetzer:end -->
