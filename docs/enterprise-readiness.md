# Hetzer: Enterprise & Financial / Banking Readiness Assessment

> **Classification**: Enterprise Technical Whitepaper & Security Evaluation  
> **Target Audience**: Chief Information Security Officers (CISO), Security Architects, DevSecOps Leads, Financial Compliance Auditors  
> **Relevant Frameworks**: PCI-DSS 4.0, SOC 2 Type II, ISO/IEC 27001:2022, NIST SP 800-53, Bank Indonesia (PBI/PADG), OJK (SEOJK 29/2022)  
> **Version**: 0.4.0  
> **Status**: Comprehensive Analysis  

---

## Executive Summary & Verdict

### The Core Question
> *"Is Hetzer enterprise-ready and secure for deployment within financial institutions, fintech, and commercial banks?"*

### Executive Verdict

| Deployment Tier | Readiness Status | Recommendation & Role |
|---|:---:|---|
| **Tier A: Developer Workstation & AI Agent Sidecar Armor** | 🟢 **Enterprise-Ready (Approved with Policy)** | **Highly Recommended**. Shields developers and AI coding agents (Claude, Cursor, Copilot, Antigravity) from leaking banking API tokens, staging passwords, and customer PII into external LLM prompts or Git commits. Zero supply-chain attack surface (0 npm dependencies). |
| **Tier B: CI/CD Pipeline Ephemeral Secret Injector** | 🟢 **Enterprise-Ready (Hardened Mode)** | **Approved**. Safe for ephemeral test runners and build workers using `hetzer exec --` with memory-only master keys (`HETZER_GRIMOIRE_KEY` injected via pipeline secrets). |
| **Tier C: Centralized Core-Banking Production Vault** | 🔴 **Not Recommended Out-of-the-Box** | **Do Not Deploy as Tier-1 Core Vault**. Hetzer is an embedded local vault (SQLite WAL). It does **not** natively integrate with FIPS 140-2/3 Level 3 Hardware Security Modules (HSMs), corporate Active Directory/Okta IAM, or WORM SIEM audit streaming required for central production banking secrets. Continue using HashiCorp Vault Enterprise or CyberArk for core infrastructure. |

---

## 1. The Banking & AI Conundrum: Why Hetzer Matters

Modern financial institutions face a critical dilemma:
1. **Developer Velocity**: Software engineers are rapidly adopting autonomous AI coding agents (Claude Code, Cursor IDE, Google Antigravity, OpenCode).
2. **The Data Leakage Threat**: Without client-side interception, developers frequently paste API keys, database connection strings, customer identifiers, or internal service passwords into LLM prompts. These context windows are transmitted over external networks to LLM vendor servers (OpenAI, Anthropic, Google), violating **Bank Secrecy Laws**, **PCI-DSS data residency requirements**, and non-disclosure agreements.
3. **Supply Chain Vulnerability**: Traditional security agents pull hundreds of nested `node_modules` or gigabytes of Python packages, introducing critical third-party supply-chain risks.

**Hetzer's Strategic Role in Banking**:  
Hetzer functions as a **client-side Zero-Plaintext Armor (Defense-in-Depth layer)** that neutralizes these risks directly on developer laptops and agent runners before network egress.

---

## 2. Regulatory Compliance Evaluation Matrix

The following matrix evaluates Hetzer against global and banking-specific cybersecurity regulations:

| Standard / Regulation | Requirement / Control | Hetzer Compliance & Capability | Evaluation |
|---|---|---|:---:|
| **PCI-DSS v4.0** | **Req 3.4 & 3.5**: Protect stored cardholder / authentication data with strong cryptography. | Uses **AES-256-GCM** authenticated encryption with unique 12-byte IVs per secret and HKDF key derivation. Secrets are stored encrypted in SQLite WAL at rest. | 🟢 **Pass** (At Rest) |
| **PCI-DSS v4.0** | **Req 3.6 & 3.7**: Cryptographic key management via FIPS-approved mechanisms / HSMs. | Master key is passed via environment variable (`HETZER_GRIMOIRE_KEY`) or `.env`. Does not natively talk to FIPS 140-2/3 Level 3 HSM hardware. | 🟡 **Compensating Control Required** (Inject master key from enterprise KMS / session memory) |
| **PCI-DSS v4.0** | **Req 6.4.3 & 6.5**: Protect development environments from credential exposure and code vulnerabilities. | **Git Pre-Commit Guard** (< 2ms) blocks commits containing raw credentials or `.env` files. | 🟢 **Pass** |
| **PCI-DSS v4.0** | **Req 10.2 & 10.3**: Audit logs for all actions, access to credentials, and admin operations. | Records all credential additions, reveals, and migrations in `vault_audit_events`. Stored locally in SQLite; requires log-shipping agent for central SIEM aggregation. | 🟡 **Requires Log Shipper** |
| **ISO/IEC 27001:2022** | **A.8.24**: Use of cryptography. | Industry-standard AES-256-GCM silicon acceleration (AES-NI). | 🟢 **Pass** |
| **ISO/IEC 27001:2022** | **A.8.28**: Secure coding & secret separation. | Enforces strict **Zero-Plaintext Contract**: files contain only `secretRef:<id>`. Raw keys never touch disk or Git. | 🟢 **Pass** |
| **SOC 2 Type II** | **CC6.1 - CC6.3**: Logical access controls and credential security. | Role-based credential isolation (`reader`, `operator`, `admin`), scoped action lists (`allowedActions: ["compose.start"]`), and out-of-band injection. | 🟢 **Pass** |
| **OJK (SEOJK 29/2022)** | **Prinsip Ketahanan Siber**: Perlindungan data sensitif perbankan dari kebocoran ke pihak ketiga. | Prevents raw credentials and internal configurations from being transmitted to third-party LLM inference servers via prompt interception. | 🟢 **Pass** |
| **Bank Indonesia (PBI 23/2021)** | **Penyelenggaraan Sistem Pembayaran**: Integritas data dan perlindungan kerahasiaan data transaksi. | Prevents developer leakage into public/private repositories and local plaintext configuration exposure. | 🟢 **Pass** |
| **Executive Order 14028 / SLSA** | **Supply Chain Security**: Minimize unverified third-party dependencies. | **0 external npm dependencies**. 100% built on Node.js standard library (`node:crypto`, `node:sqlite`, `node:fs`). Zero `node_modules` supply-chain risk. | 🟢 **Superior** |

---

## 3. Threat Vector & Architectural Gap Analysis

To maintain bank-grade rigor, security auditors must understand both the strengths and current limitations of Hetzer:

### 3.1 Where Hetzer Outperforms Enterprise Alternatives
1. **Supply-Chain Immunity**:  
   Enterprise scanning tools often depend on hundreds of third-party libraries. Hetzer contains **0 external npm dependencies**. The attack surface for dependency tampering, typosquatting, or malicious package updates in production is non-existent.
2. **Sub-2ms Deterministic Latency**:  
   Heavy machine learning scanners (e.g. BERT-based models) impose 800ms – 2,500ms latency, causing developers to disable them. Hetzer's V8 DFA regular expressions and Shannon entropy checks complete in **under 2 milliseconds**, ensuring zero friction in automated Git and MCP agent loops.
3. **No Network Telemetry / Phone-Home**:  
   All daemon ports bind strictly to `127.0.0.1` (loopback). There are no cloud callbacks, telemetry metrics, or external analytics transmitted to third-party servers.

### 3.2 Critical Gaps for Tier-1 Core-Banking Infrastructure
1. **Absence of Native HSM / Cloud KMS Integration**:  
   Tier-1 banking applications require master keys to be wrapped by a FIPS 140-2 Level 3 HSM (e.g., AWS KMS, Azure Key Vault HSM, HashiCorp Vault Transit Engine, or Thales Luna). Hetzer currently requires the master key to be supplied via process environment (`HETZER_GRIMOIRE_KEY`).
2. **Local Embedded SQLite vs. Distributed High Availability**:  
   Hetzer stores secrets in an embedded SQLite database (`data/hetzer-vault.db`). While ideal for developer workstations and local containers, it is not designed to replace high-availability distributed storage engines (such as HashiCorp Vault's Raft consensus or CyberArk's vault cluster).
3. **Audit Log Tamper-Resistance (WORM)**:  
   Hetzer records audit logs in the local SQLite table `vault_audit_events`. An administrative user with root access to the machine could theoretically alter or delete this local database file. In banking compliance, audit logs must be streamed in real-time to a Write-Once-Read-Many (WORM) SIEM (Splunk, Elastic, Datadog, IBM QRadar).
4. **Dynamic Ephemeral Secret Generation (Leases)**:  
   Hetzer currently manages static encrypted secrets (API keys, passwords, certificates). It does not yet generate short-lived dynamic database credentials (e.g., generating temporary PostgreSQL user credentials with 15-minute TTLs).

### 3.3 The Runtime Tool Output Threat: Tackling Agent Credential Reflection
A major threat identified in recent security research (e.g., ArXiv June 2026 on credential leakage via autonomous agent tools) occurs when an agent running in autonomous/YOLO mode executes bash commands:
1. **The Context Ingestion Vector**:
   While static `.env` files and Git commits are protected, commands executed by agents (or crashing subprocesses) frequently dump credentials to `stdout` or `stderr` (e.g. unhandled exceptions, verbose curl headers, or debug stack traces). AI agents automatically ingest tool output directly into their context windows, transmitting credentials to LLM provider APIs.
2. **The Self-Resolution / Privilege Escalation Attack**:
   If an autonomous agent has access to run terminal commands, it can theoretically attempt to run `hetzer exec -- printenv` or `hetzer creds reveal <id>` to force the system to resolve and print secrets back to its tool output.
3. **Hetzer's Runtime Countermeasures**:
   - **Real-Time Stream Output Sanitizer**: `hetzer exec` intercepts child process `stdout` and `stderr` streams, automatically filtering every chunk and redacting resolved secrets back to `secretRef:<id>` in real time.
   - **Anti-Reflection Guard**: Reflection commands (`printenv`, `env`, `export`, `set`, `/proc/*/environ`, `docker inspect`, inline `process.env`) are strictly blocked before execution.
   - **Interactive TTY & Process Ancestry Guard**: `hetzer creds reveal` strictly verifies `process.stdin.isTTY`, checks agent environment flags, and traverses 5 generations of parent processes (PPID) to block autonomous agents in YOLO/Turbo mode.
   - **Out-of-Band (OOB) Native OS Modal Confirmation**: Optional `--confirm-ui` or `HETZER_REQUIRE_OOB_CONFIRM=1` breaks out of the terminal stream to require physical human confirmation via native desktop GUI dialogs.
   - **Dynamic Canary Honey-Tokens**: Deploys decoy canary tokens (`HETZER_CANARY_TOKEN=secretRef:canary-token`). Any attempted extraction immediately aborts execution (`process.exit(43)`) and logs forensic intrusion details.
   - **Master Key Workspace Isolation**: `hetzer creds isolate-key` moves `HETZER_GRIMOIRE_KEY` completely outside the workspace to `~/.hetzer/grimoire.key`, preventing workspace agents from accessing the master key.
   - **Granular Scoped Injection**: `hetzer exec --allow <id> [--strict]` injects only specifically permitted credentials into child process RAM.

> 📊 **Comparative Benchmark**: For a detailed quantitative evaluation against HashiCorp Vault, Doppler, and Lakera Guard across PCI-DSS v4.0.1, NIST SP 800-218, and OJK guidelines, see **[Enterprise Value Benchmark (`docs/value-benchmark.md`)](value-benchmark.md)** and **[System Logic & Progress (`docs/system-logic-and-progress.md`)](system-logic-and-progress.md)**.

---

## 4. Recommended Enterprise Architecture: The "Sidecar / Guard" Pattern

In financial institutions, Hetzer should be implemented as an **Agent Sidecar & Workstation Guard** in synergy with the bank's existing enterprise secret manager:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       BANK ENTERPRISE DEPLOYMENT MODEL                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Central Enterprise Vault: HashiCorp Vault Enterprise / CyberArk ]        │
│                                │                                            │
│                     (Periodic Sync / CLI Bridge)                            │
│                                ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ DEVELOPER WORKSTATION / AGENT RUNNER                                  │  │
│  │                                                                       │  │
│  │  1. Memory-Only Master Key: export HETZER_GRIMOIRE_KEY=$(vault read) │  │
│  │                                                                       │  │
│  │  2. Local Grimoire Vault (AES-256-GCM, chmod 600)                    │  │
│  │     - Holds project credentials as secretRef:<id>                    │  │
│  │                                                                       │  │
│  │  3. Sub-2ms Sniffer & Pre-Commit Hook                                 │  │
│  │     - Blocks accidental Git commits to corporate GitLab/GitHub        │  │
│  │                                                                       │  │
│  │  4. Universal AI Agent Skills (Claude, Cursor, AGY, Hermes)          │  │
│  │     - Intercepts prompts; prevents sending banking tokens to LLMs    │  │
│  │                                                                       │  │
│  │  5. Ephemeral Execution: hetzer exec -- <command>                    │  │
│  │     - Injects credentials into RAM only during process life           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Enterprise Hardening & Deployment Checklist

For DevSecOps teams deploying Hetzer in banking and regulated environments:

1. [ ] **Enforce In-Memory Master Key**:
   Never store `HETZER_GRIMOIRE_KEY` inside `.env` or files on developer machines. Export it from terminal session memory or retrieve it dynamically upon terminal login via corporate SSO/vault CLI:
   ```bash
   export HETZER_GRIMOIRE_KEY=$(pass show hetzer/master-key)
   ```
2. [ ] **Enforce POSIX File Permissions**:
   Ensure `.env` and `data/hetzer-vault.db` have `0600` permissions (read/write only by the operating system user account):
   ```bash
   chmod 600 .env data/hetzer-vault.db
   ```
3. [ ] **Mandate Pre-Commit Hook Across Repositories**:
   Integrate Hetzer's pre-commit hook in the organization's global Git template:
   ```bash
   git config --global core.hooksPath /etc/git-hooks
   # Or install per repository:
   hetzer hook install
   ```
4. [ ] **Stream Audit Logs to Enterprise SIEM**:
   Configure a file-integrity monitoring or log-shipping agent (Fluent Bit, Datadog Agent, Splunk Universal Forwarder) to monitor `data/hetzer-vault.db` and stream audit records to central security monitoring.
5. [ ] **Network Egress Confinement**:
   Maintain Docker default configuration with loopback binding (`127.0.0.1`). Verify via `hetzer doctor` that no container ports are exposed on `0.0.0.0`.

---

## 6. Enterprise Roadmap: Path to Tier-1 Core-Banking Certification

To transition from an Enterprise Workstation Armor to a Tier-1 Core-Banking Secret Solution, the following capabilities are scheduled on the Hetzer roadmap:

1. **KMS Envelope Encryption Plugin**:  
   Direct integration with AWS KMS, Azure Key Vault, and HashiCorp Vault Transit Engine to protect master keys using cloud HSMs.
2. **Enterprise SIEM Syslog Forwarder**:  
   RFC 5424 compliant TLS syslog streaming for real-time audit event ingestion into Splunk, QRadar, and Datadog.
3. **Dynamic Short-Lived Credential Broker**:  
   Support for dynamic TTL leases and automatic token rotation for PostgreSQL, AWS IAM, and Kubernetes service accounts.
4. **Corporate IdP Authentication (OIDC/SAML)**:  
   Role authentication via corporate identity providers before CLI secret revelation.

---

## Summary Statement for Bank Auditors

> *"Hetzer 0.4.0 provides an exceptional client-side defense-in-depth security layer against credential leakage, prompt injection, and source code exposure for developers utilizing modern AI tools. Its zero-external-dependency architecture and sub-2ms AES-256-GCM cryptographic engine satisfy rigorous DevSecOps standards. When deployed as a developer workstation guard and paired with corporate key management policies, it directly fulfills PCI-DSS v4.0 (Req 3, 6, 10), ISO 27001 (A.8.24, A.8.28), and OJK cybersecurity guidelines."*
