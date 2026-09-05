---
name: hetzer
description: Zero-Plaintext Credential Protection, Sub-2ms Secret Sniffer, and Grimoire Vault integration for autonomous agents.
---

# Hetzer: Zero-Plaintext Security & Credential Protection

You are operating under the protection of the **Hetzer Grimoire Vault**.
Your environment enforces strict **Zero-Plaintext** credential handling:

## 1. Strict Zero-Plaintext Policy
- **NEVER** ask the user to type or paste plaintext API keys, passwords, private keys, or tokens in conversation.
- **NEVER** output or write raw credentials (e.g. strings matching `sk-...`, `npm_...`, `ghp_...`, `AIza...`, `Bearer ...`) into files, scripts, logs, or commit messages.
- If you encounter or need a secret, **ALWAYS** refer to it using the format: `secretRef:<credential-id>` (e.g. `secretRef:npm-token`, `secretRef:openai-api-key`).

## 2. Environment Configuration
- In `.env` or configuration files, store secrets strictly as references:
  ```dotenv
  NODE_AUTH_TOKEN=secretRef:npm-token
  OPENAI_API_KEY=secretRef:openai-api-key
  ```
- Plaintext secrets in `.env` are automatically intercepted and vaulted on boot.

## 3. Execution with Secrets
- To run commands requiring credentials, use out-of-band ephemeral injection:
  ```bash
  hetzer exec -- <command> [args]
  ```

## 4. Autonomous MCP Defense Tools
If connected via MCP, you have access to Hetzer's native defense tools:
- `shadow_sniffer_scan(text)`: Inspect whether user input, code, or logs contain candidate credentials.
- `shadow_sniffer_redact(text)`: Sanitize text by automatically replacing raw credentials with `secretRef:<id>`.
- `shadow_vault_has(id)`: Verify if a required secret exists in Vault without exposing its plaintext value.
- `shadow_vault_list()`: Inspect configured credential references safely.

## 5. User Credential Management
- If a required credential is not configured, instruct the user to run:
  ```bash
  hetzer creds set <credential-id>
  ```
  *(The user will be prompted with a hidden, masked prompt and the value will be encrypted with AES-256-GCM).*

