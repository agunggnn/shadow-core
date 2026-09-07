# Hetzer for Vibe Coders: The Zero-Overhead Armor 🛡️

> **"Code at the speed of thought in YOLO mode without burning your API keys or leaking your credentials to the cloud."**

---

## ⚡ The Vibe Coder's Dilemma

Vibe coding has changed software engineering forever. With **Claude Code, Cursor, Google Antigravity, Cline, and OpenCode**, developers are building full-stack products in hours instead of months.

To move fast, most vibe coders run agents in **YOLO / Turbo mode** (auto-approval enabled, terminal access granted). But this introduces a massive hidden danger:

1. **The Context Leak Trap**: When a script crashes, unhandled errors or debug curl calls dump raw API keys to `stdout`/`stderr`. The AI agent immediately reads that output into its context window, broadcasting your private tokens to third-party LLM providers.
2. **The Accidental Git Push**: You ask the agent to *"commit and push this feature"*, and the agent stages `.env` or an inline API key to a public GitHub repo. Within 4 minutes, automated scrapers drain your account.
3. **The Enterprise Alternative Sucks**: Commercial AI firewalls want you to install heavy enterprise daemons, pay $30/user/month, or route your prompts through their proprietary cloud proxies.

---

## 💎 The "Nothing to Lose" Promise

Hetzer was purpose-built for the vibe coding generation as a **Zero-Overhead, Zero-Friction Shield**:

| What You Might Fear | The Hetzer Reality |
|---|---|
| *"Will it bloat my project dependencies?"* | **0 NPM dependencies.** 100% pure Node.js standard library. |
| *"Do I have to run heavy Docker containers?"* | **0 Docker required.** Runs natively in lightweight Node.js. |
| *"Will it eat my laptop's RAM?"* | **0 background RAM.** Operates only when invoked (< 10 MiB). |
| *"Will it slow down my typing or prompting?"* | **< 2 milliseconds latency.** Pure V8 DFA regular expressions; instant and imperceptible. |
| *"Will it break my code?"* | **Zero disruption.** Your scripts still access environment variables in RAM normally during execution. |
| *"Is there a paid tier or subscription?"* | **100% Free & Open-Source (Apache-2.0).** No paywalls, no telemetry, no tracking. |

---

## 🚀 Get Armored in 3 Seconds (One Command)

You don't need to read manuals or configure complex IAM policies. Just run this in your terminal inside any project:

```bash
npx hetzer protect
```

### What Happens in 1.5 Seconds:
```text
================================================================================
  🛡️ HETZER ARMOR ACTIVATED (ZERO-PLAINTEXT FOR VIBE CODERS)
================================================================================
  [v] Universal Skills   : Active across Cursor, Claude, Antigravity, Cline, OpenCode
  [v] Git Pre-Commit     : Hook installed (< 2ms sniffer active)
  [v] Workspace .env     : Plaintext tokens vaulted into AES-256-GCM
  [v] Resource Overhead  : 0 Docker containers, 0 background RAM, 0 npm dependencies
--------------------------------------------------------------------------------
  Your code and tokens are safe from accidental leaks into LLMs and Git.
  Keep vibe coding with total peace of mind! 🚀
================================================================================
```

---

## 🎮 How Your Daily Workflow Looks

### 1. Store Any API Key Without Plaintext
Instead of pasting tokens in chat or saving them in raw `.env`:
```bash
npx hetzer creds set openai-api-key
```
Hetzer encrypts the secret using **AES-256-GCM** in local SQLite (`data/hetzer-vault.db`) and records an opaque reference in your `.env`:
```dotenv
OPENAI_API_KEY=secretRef:openai-api-key
```

### 2. Write Code Normally
Write your Python, Node.js, Go, or Rust code exactly as you always do:
```python
import os
# The code doesn't know or care about Hetzer!
api_key = os.environ.get("OPENAI_API_KEY")
```

### 3. Run Commands & Let Agents Work
When you or your AI agent runs commands:
```bash
hetzer exec -- npm start
# or
hetzer exec -- python main.py
```
- **In Memory**: Hetzer decrypts `secretRef:` directly into the child process RAM. Your app runs normally!
- **On Output**: If the app crashes or prints debug logs, Hetzer's real-time stream interceptor scrubs the output back to `secretRef:<id>` in < 2ms before the AI agent reads it.
- **On Git**: If you run `git commit`, the pre-commit hook verifies in 0.19 ms that no tokens or `.env` files are being committed.

---

## 🏷️ Show Off Your Repo Armor

Add the official badge to your GitHub repository `README.md`:

```markdown
[![Protected by Hetzer](https://img.shields.io/badge/Armor-Hetzer%20Zero--Plaintext-000000?style=flat-square&logo=shield)](https://github.com/agunggnn/hetzer)
```

Preview:  
[![Protected by Hetzer](https://img.shields.io/badge/Armor-Hetzer%20Zero--Plaintext-000000?style=flat-square&logo=shield)](https://github.com/agunggnn/hetzer)

---

## 💡 The Open-Source Philosophy: Commoditizing AI Security

Why pay a SaaS vendor $30/month for an enterprise AI firewall when security is fundamentally a **public good**?

Just like **Let's Encrypt** commoditized SSL certificates and made HTTPS universal, Hetzer's mission is to **commoditize AI Agent Credential Protection**:
- **Free for every developer**
- **Zero vendor lock-in**
- **Zero cloud surveillance**

Vibe coding shouldn't mean living in fear of leaked tokens. Protect your workspace in one command and keep building the future. 🚀
