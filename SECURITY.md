# Security policy

## Supported versions

Security fixes are applied to the latest tagged release and the `main` branch.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability or exposed credential.
Use GitHub's private vulnerability reporting for this repository. Include the
affected version, operating system, reproduction steps, and likely impact.

## Deployment & Security Boundary

- **Zero-Plaintext Guarantee**: Secrets in files, `.env`, and git repositories must strictly use `secretRef:<id>`. Decrypted secrets exist only ephemerally in child process memory during `hetzer exec`.
- **Master Key Workspace Isolation**: The master key `HETZER_GRIMOIRE_KEY` should be relocated out of workspace directories to `~/.hetzer/grimoire.key` (POSIX mode `0600`) via `hetzer creds isolate-key`.
- **Loopback Enforcement**: Hetzer binds all daemon services and container ports to `127.0.0.1` by default. Any non-loopback binding requires explicit TLS, firewall, and reverse-proxy authentication.
- **7-Layer Defense Shield**:
  1. Sub-2ms V8 DFA Secret Sniffer (`scanText` / `redactAndVault`).
  2. In-memory real-time stream output redactor on child stdout/stderr.
  3. Anti-reflection command execution blocker (`isReflectionCommand`).
  4. Interactive TTY and 5-generation process tree ancestry inspection (`isProcessTreeAgentSpawned`).
  5. Out-of-Band (OOB) native OS modal confirmation (`--confirm-ui`).
  6. Dynamic Canary Honey-Tokens intrusion tripwires (`hetzer canary setup`).
  7. Master Key workspace isolation outside project root.
- **Canary Tripwire Intrusion Response**:
  - Any access attempt targeting `canary-token` or `HETZER_CANARY_TOKEN` triggers an immediate emergency abort (`process.exit(43)`), logs forensic details to `data/hetzer-incidents.log`, and records an audit event in SQLite.
- **Supply-Chain Integrity**: Zero external npm dependencies in production (100% built on Node.js standard library: `node:crypto`, `node:sqlite`, `node:fs`).
- **Container Digest Pinning**: Container images are strictly pinned by immutable SHA-256 digests. Review digest upgrades in accordance with organization supply-chain policies.
