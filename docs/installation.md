# Shadow Core: Complete Installation & Setup Guide

> **Target OS**: Ubuntu/Debian, RHEL/CentOS, Windows (WSL2/Docker Desktop), macOS (Apple Silicon & Intel)  
> **Node.js**: >= 22.5.0  
> **Docker**: Engine >= 24.0, Docker Compose >= v2.20  
> **Documentation Type**: Modular Reference & Step-by-Step Tutorial

---

## 📑 Table of Contents

1. [System Requirements](#1-system-requirements)
2. [60-Second Quickstart](#2-60-second-quickstart)
3. [OS-Specific Prerequisites](#3-os-specific-prerequisites)
   - [Ubuntu & Debian Linux](#31-ubuntu--debian-linux)
   - [CentOS, RHEL & Fedora](#32-centos-rhel--fedora)
   - [Windows 10 / 11 (WSL2 & Docker Desktop)](#33-windows-10--11-wsl2--docker-desktop)
   - [macOS (Apple Silicon & Intel)](#34-macos-apple-silicon--intel)
   - [Cloud VPS (Hetzner, DigitalOcean, AWS EC2)](#35-cloud-vps-hetzner-digitalocean-aws-ec2)
4. [Installation Methods](#4-installation-methods)
   - [Method A: Global CLI via npm / GitHub (Recommended)](#method-a-global-cli-via-npm--github-recommended)
   - [Method B: Clone from Source (Contributors & Developers)](#method-b-clone-from-source-contributors--developers)
5. [Pre-flight Diagnostics (`shadow doctor`)](#5-pre-flight-diagnostics-shadow-doctor)
6. [Project Initialization & Secret Setup](#6-project-initialization--secret-setup)
7. [Starting Services & Active Healthchecks](#7-starting-services--active-healthchecks)
8. [Enabling Persistent Memory (Cognee Module)](#8-enabling-persistent-memory-cognee-module)
9. [Updating & Maintenance](#9-updating--maintenance)
10. [Uninstallation & Teardown](#10-uninstallation--teardown)
11. [Troubleshooting & FAQ](#11-troubleshooting--faq)

---

## 1. System Requirements

Shadow Core is engineered for high density and low memory consumption. It does not require a dedicated GPU for its command plane, gateway, and memory indexers.

| Resource | Minimum Profile (`core` + `9router`) | Full AI Stack (`core` + `9router` + `cognee`) |
|---|---|---|
| **Operating System** | Linux (Kernel >= 5.4), Windows 10/11 (WSL2), macOS >= 12 | Linux (Kernel >= 5.4), Windows 10/11 (WSL2), macOS >= 12 |
| **CPU Architecture** | x86_64 (AMD64) or ARM64 (aarch64) | x86_64 (AMD64) or ARM64 (aarch64) |
| **CPU Cores** | 1 Core | 2 Cores (Recommended) |
| **System RAM** | 1.0 GiB (uses ~200 MiB active) | 3.0 GiB (uses ~1.4 GiB active) |
| **Swap Space** | 1.0 GiB recommended | 2.0 GiB recommended on budget VPS |
| **Disk Storage** | 2.0 GB free | 5.0 GB free (for vector/graph persistent storage) |
| **Runtime** | Node.js >= 22.5.0 | Node.js >= 22.5.0 |
| **Container Engine**| Docker Engine >= 24.0 & Compose v2 | Docker Engine >= 24.0 & Compose v2 |

---

## 2. 60-Second Quickstart

If your machine already has Node.js (>= 22.5) and Docker running, copy and run:

```bash
# 1. Install CLI globally from GitHub
npm install -g github:agunggnn/shadow-core

# 2. Run automated environment pre-flight check
shadow doctor --fix

# 3. Initialize your command plane (auto-creates Grimoire Vault & secure .env)
shadow init

# 4. Launch services with active healthcheck verification
shadow up --wait

# 5. Open the terminal operations monitor
shadow tui
```

Your 9Router AI Gateway will immediately be live at `http://127.0.0.1:20140`. Retrieve the generated password anytime with:
```bash
shadow creds reveal nine-router-initial-password
```

---

## 3. OS-Specific Prerequisites

### 3.1 Ubuntu & Debian Linux

Install Node.js 22.x and Docker Engine:

```bash
# 1. Update packages
sudo apt-get update && sudo apt-get install -y curl ca-certificates gnupg

# 2. Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install Docker Engine & Compose plugin
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 4. Grant current user non-root Docker socket access
sudo usermod -aG docker $USER
newgrp docker
```

---

### 3.2 CentOS, RHEL & Fedora

```bash
# 1. Install Node.js 22
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

# 2. Install Docker CE
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

---

### 3.3 Windows 10 / 11 (WSL2 & Docker Desktop)

1. **Install WSL2**:
   Open PowerShell as Administrator and run:
   ```powershell
   wsl --install
   ```
2. **Install Docker Desktop**:
   Download and install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/).  
   Ensure **"Use the WSL 2 based engine"** is enabled in Docker Settings > General.
3. **Install Node.js >= 22**:
   Inside your WSL2 Ubuntu shell or Native PowerShell using [fnm](https://github.com/Schniz/fnm) or [Node.js Official Installer](https://nodejs.org/):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

---

### 3.4 macOS (Apple Silicon & Intel)

1. **Install Homebrew**:
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
2. **Install Node.js & OrbStack / Docker Desktop**:
   ```bash
   brew install node@22
   brew link node@22
   brew install --cask orbstack # Fast, lightweight Docker alternative for Mac
   ```

---

### 3.5 Cloud VPS (Hetzner, DigitalOcean, AWS EC2)

On budget cloud instances (e.g. 1 vCPU, 2GB–4GB RAM), it is best practice to configure a swap file to guarantee stability during peak embedding indexing:

```bash
# Set up 2GB swap file if not present
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Installation Methods

### Method A: Global CLI via npm / GitHub (Recommended)

Install the CLI globally so that `shadow` commands can be invoked from any directory:

```bash
# Install directly from GitHub repository:
npm install -g github:agunggnn/shadow-core

# Or from npm registry:
npm install -g @agunggnn/shadow-core
```

Verify the binary is available:
```bash
shadow --version
```

---

### Method B: Clone from Source (Contributors & Developers)

```bash
# 1. Clone the repository
git clone https://github.com/agunggnn/shadow-core.git
cd shadow-core

# 2. Run internal checks (zero npm dependencies)
npm test

# 3. Symlink binary globally
npm link
```

---

## 5. Pre-flight Diagnostics (`shadow doctor`)

Before starting containers, run `shadow doctor` to inspect the host environment:

```bash
shadow doctor
```

If permissions or directories need repair, use the auto-fix flag:
```bash
shadow doctor --fix
```

The doctor command checks:
- ✅ Node.js version compatibility (`>= 22.5.0` for built-in `node:sqlite`).
- ✅ Docker Engine daemon liveness.
- ✅ Docker Compose v2 plugin availability.
- ✅ Non-root user permissions for `/var/run/docker.sock`.
- ✅ File permissions on `.env` (`chmod 600` on POSIX systems).
- ✅ Grimoire Vault database connectivity.

---

## 6. Project Initialization & Secret Setup

Run `shadow init` to create the command plane:

```bash
# Initialize in the current directory:
shadow init

# Or initialize inside a dedicated directory:
shadow init ./my-ai-instance
cd my-ai-instance
```

### What Happens During `shadow init`?
1. Generates `data/shadow-vault.db` (encrypted SQLite database).
2. Generates a secure master key (`SHADOW_GRIMOIRE_KEY`) if not already present.
3. Generates a 16-character hexadecimal password for 9Router admin access.
4. Creates `.env` with strict `chmod 600` permissions.
5. Populates `.env` using **Zero-Plaintext references**:
   ```dotenv
   NINE_ROUTER_INITIAL_PASSWORD=secretRef:nine-router-initial-password
   ```

To reveal your 9Router password:
```bash
shadow creds reveal nine-router-initial-password
```

---

## 7. Starting Services & Active Healthchecks

Start your AI Command Plane:

```bash
shadow up --wait
```

The `--wait` flag automatically:
1. Merges active Compose configurations.
2. Injects decrypted credentials ephemerally into container memory.
3. Spawns Docker containers.
4. Actively probes HTTP healthcheck endpoints until `healthy` is reached.
5. Displays a live status table with loopback URLs and ports.

To monitor running services continuously:
```bash
shadow tui
```

---

## 8. Enabling Persistent Memory (Cognee Module)

Cognee is an optional module that adds graph and vector persistent memory via the Model Context Protocol (MCP).

### Step 1: Install the Module
```bash
shadow install cognee
```

### Step 2: Configure Your LLM API Key into the Vault
Choose your model provider and encrypt your API key:
```bash
# For OpenAI / Anthropic / Groq:
shadow creds set cognee-llm-api-key "your-api-key-here"
```
*(If you leave the argument blank, a masked terminal prompt will securely accept the key).*

### Step 3: Launch Cognee
```bash
shadow up --wait cognee
```

### Step 4: Register MCP Endpoint
```bash
shadow mcp configure
```
This updates `.mcp.json` so that Claude Desktop, Cursor, and Cline can immediately discover memory tools (`remember`, `recall`, `improve`).

---

## 9. Updating & Maintenance

### Update Docker Container Digests
Shadow Core pins container digests for cryptographic reproducibility. To fetch updated digests and rebuild services:

```bash
shadow update
```

### Backup Grimoire Vault
To safely back up your encrypted vault and configuration:
```bash
cp data/shadow-vault.db data/shadow-vault.backup.db
cp .env .env.backup
```

---

## 10. Uninstallation & Teardown

To cleanly wipe containers, data volumes, and the CLI:

```bash
# 1. Stop containers and destroy named Docker volumes:
shadow down -v

# 2. Remove the project directory:
cd .. && rm -rf shadow-core

# 3. Uninstall the global CLI binary:
npm uninstall -g @agunggnn/shadow-core

# 4. (Optional) Prune unused Docker images:
docker image prune -a
```

---

## 11. Troubleshooting & FAQ

### Q1: `Permission denied while trying to connect to the Docker daemon socket`
**Fix**: Your user is not in the `docker` group. Run:
```bash
sudo usermod -aG docker $USER && newgrp docker
```

### Q2: `HTTP 406 Not Acceptable` when calling MCP tools
**Fix**: Update to Shadow Core v1.0.0-rc or newer. The MCP bridge automatically negotiates `Accept: application/json, text/event-stream`.

### Q3: `Container cognee-mcp restarting (ExitCode 1, Health: unhealthy)`
**Fix**: On Linux, Docker volume mounts may have mismatched permissions. Shadow Core explicitly enforces `user: "0:0"` in `docker-compose.cognee.yml`. Ensure you have pulled the latest version and run `shadow up --wait cognee`.

---

*For detailed system architecture, see [docs/architecture.md](file:///E:/GitHub/shadow-core/docs/architecture.md).*  
*For Model Context Protocol usage, see [docs/mcp-guide.md](file:///E:/GitHub/shadow-core/docs/mcp-guide.md).*
