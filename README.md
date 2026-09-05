# Shadow Core

<p align="center">
  <strong>The Local-First Autonomous AI Command Plane</strong><br>
  <em>Zero npm dependencies. Zero-plaintext security. Intelligent AI model routing, tri-layer persistent memory, and universal MCP orchestration in ~1.4 GiB RAM.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agunggnn/shadow-core"><img src="https://img.shields.io/npm/v/@agunggnn/shadow-core.svg?style=flat-square&color=blue" alt="npm version" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22.5.0-brightgreen.svg?style=flat-square" alt="Node.js version" /></a>
  <a href="https://docs.docker.com/compose/"><img src="https://img.shields.io/badge/docker--compose-v2-blue.svg?style=flat-square" alt="Docker Compose v2" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0%20(pure%20Node%20stdlib)-success.svg?style=flat-square" alt="Zero External Dependencies" /></a>
  <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-AES--256--GCM%20Vault-orange.svg?style=flat-square" alt="AES-256-GCM Vault" /></a>
  <a href="docs/architecture.md"><img src="https://img.shields.io/badge/memory%20footprint-~1.4%20GiB%20RAM-purple.svg?style=flat-square" alt="Memory Footprint" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" alt="License" /></a>
</p>

---

## 📑 Dokumentasi Modular

Untuk kenyamanan developer dan optimasi pencarian (SEO), dokumentasi Shadow Core dipecah menjadi modul-modul independen:

| Modul Dokumentasi | Deskripsi & Isi |
|---|---|
| 🚀 **[Panduan Instalasi Lengkap (`docs/installation.md`)](docs/installation.md)** | Panduan instalasi multi-OS (Ubuntu, Debian, CentOS, Windows WSL2, macOS, VPS), prasyarat Docker & Node.js, dan troubleshooting. |
| 🏛️ **[Arsitektur Sistem & Spesifikasi Teknis (`docs/architecture.md`)](docs/architecture.md)** | Penjelasan mendalam tentang Grimoire Vault (AES-256-GCM), 9Router Gateway, Cognee Tri-layer Memory, diagram Mermaid, dan model isolasi jaringan. |
| 🌐 **[Panduan Integrasi Model Context Protocol (`docs/mcp-guide.md`)](docs/mcp-guide.md)** | Cara menghubungkan Shadow Core ke Claude Desktop, Cursor, Cline, OpenCode, klasifikasi tools `[OFFLINE]`/`[HYBRID]`/`[LLM]`, dan CLI testing. |
| 🧠 **[Modul Memori Persisten Cognee (`docs/modules/cognee.md`)](docs/modules/cognee.md)** | Konfigurasi memori graf dan vektor persisten, integrasi Ollama lokal, dan skema tools memori. |

---

## ⚡ Apa itu Shadow Core?

**Shadow Core** adalah *local-first AI command plane & orchestrator* mandiri yang dirancang untuk mengoperasikan infrastruktur AI lokal secara aman, hemat sumber daya, dan terotomatisasi. 

Dengan Shadow Core, Anda dapat menjalankan:
1. **9Router Engine**: Gateway perutean multi-provider (OpenAI, Anthropic, Gemini, Groq, DeepSeek, Ollama) dengan fallback otomatis dan antarmuka web mandiri.
2. **Cognee Memory Engine**: Memori graf dan vektor persisten yang menggabungkan **SQLite WAL** (relasional), **LanceDB** (vektor), dan **Kùzu** (knowledge graph).
3. **Grimoire Vault**: Brankas kredensial terenkripsi **AES-256-GCM** berbasis SQLite lokal (*Zero-Plaintext Contract*). Kredensial tidak pernah tersimpan dalam teks polos di file `.env`.
4. **Universal MCP Bridge**: Menghubungkan seluruh tools dan memori lokal ke agen AI modern seperti **Claude Desktop**, **Cursor IDE**, dan **Cline**.

Semua ini berjalan dalam **satu CLI mandiri** dengan **0 npm external dependencies** (hanya memanfaatkan pustaka standar Node.js) dan menggunakan total memori hanya **~1.4 GiB RAM**.

---

## 🥊 Perbandingan: Shadow Core vs Solusi Lain

Bagaimana Shadow Core dibandingkan dengan tools AI populer lainnya di GitHub?

| Fitur / Dimensi | Shadow Core | LiteLLM / One-API | Mem0 / Letta (MemGPT) | Dify.ai / Flowise | Ollama / LocalAI |
|---|:---:|:---:|:---:|:---:|:---:|
| **Fokus Utama** | Local AI Command Plane | Model Gateway & Proxy | Agent Memory Layer | Low-Code App Platform | Model Inference Runtime |
| **Zero External NPM Deps** | ✅ **Ya (0 dependencies)** | ❌ (Banyak deps Python/Go) | ❌ (Python deps besar) | ❌ (10+ service containers) | ✅ (Binary Go/C++) |
| **Zero-Plaintext Vault** | ✅ **AES-256-GCM SQLite** | ❌ (Plaintext .env/DB) | ❌ (Plaintext API keys) | ❌ (Standard DB credentials)| ❌ (Plaintext CLI env) |
| **Model Gateway (Routing & Fallback)** | ✅ **Terintegrasi (9Router)** | ✅ Ya (Sangat lengkap) | ❌ Tidak ada | ⚠️ Terbatas | ❌ Tidak ada |
| **Tri-Layer Memory (Relational + Vector + Graph)**| ✅ **Terintegrasi (Cognee)** | ❌ Tidak ada | ⚠️ Vector / Basic Graph | ⚠️ Basic Vector DB | ❌ Tidak ada |
| **Universal MCP Orchestrator** | ✅ **Built-in CLI & Bridge** | ❌ Tidak ada | ⚠️ Client only | ❌ Tidak ada | ❌ Tidak ada |
| **Konsumsi RAM (Full Stack)** | 🟢 **~1.4 GiB RAM** | 🟡 ~300 MiB - 800 MiB | 🟡 ~800 MiB - 1.5 GiB | 🔴 4 GiB - 8 GiB+ | 🟡 Tergantung bobot model |
| **Bisa Jalan di VPS $5 / 2GB RAM** | ✅ **Sangat Stabil** | ✅ Ya | ⚠️ Butuh swap | ❌ Sering OOM Crash | ⚠️ Terbatas model kecil |

---

## 🏛️ Topologi Arsitektur

```mermaid
flowchart TB
    subgraph Clients["AI Clients & Antarmuka Pengembang"]
        CLI["Shadow Core CLI\n(shadow up / creds / mcp)"]
        TUI["Terminal Live Monitor\n(shadow tui)"]
        Claude["Claude Desktop"]
        Cursor["Cursor / Windsurf IDE"]
        Cline["Cline / Roo Code Agents"]
        Browser["Web Browser\n(9Router UI :20140)"]
    end

    subgraph HostPlane["Shadow Core Command Plane (Host Process)"]
        GrimoireVault[("Grimoire Vault\nSQLite WAL + AES-256-GCM\ndata/shadow-vault.db")]
        MCPBridge["Universal MCP Bridge\n(JSON-RPC / SSE Client)"]
        ModuleResolver["Module & Profile Resolver\n(Docker Compose Merger)"]
        HealthVerifier["Active Healthcheck & Probe Engine"]
    end

    subgraph DockerPlane["Jaringan Terisolasi Docker (127.0.0.1 Loopback)"]
        subgraph NineRouter["9Router AI Gateway (:20140)"]
            RouterProxy["Multi-Provider Model Router & Fallback"]
        end

        subgraph CogneeSvc["Cognee Memory Engine (:8001)"]
            MCPEndpoint["MCP Server (:8001/mcp)"]
            RelationalDB[("SQLite WAL\nRelational Metadata")]
            VectorDB[("LanceDB\nVector Embeddings")]
            GraphDB[("Kùzu Graph DB\nKnowledge Graph")]
        end
    end

    CLI --> GrimoireVault
    CLI --> ModuleResolver
    CLI --> MCPBridge
    TUI --> HealthVerifier
    Claude -.->|"JSON-RPC / SSE"| MCPEndpoint
    Cursor -.->|"JSON-RPC / SSE"| MCPEndpoint
    Cline -.->|"JSON-RPC / SSE"| MCPEndpoint
    Browser -->|"HTTP Web UI"| RouterProxy

    ModuleResolver -->|"docker compose up\n(Injeksi Kredensial Efemeral)"| DockerPlane
    MCPBridge -->|"Direct Probe & Call"| MCPEndpoint
```

---

## 🚀 Panduan Cepat 60 Detik (Quickstart)

### 1. Instalasi Global CLI
```bash
# Instal langsung dari GitHub (tanpa perlu clone manual):
npm install -g github:agunggnn/shadow-core

# Atau melalui npm registry:
npm install -g @agunggnn/shadow-core
```

### 2. Validasi Sistem & Auto-Repair
```bash
shadow doctor --fix
```
*Perintah ini memastikan engine Docker aktif, socket Docker dapat diakses oleh user non-root, dan versi Node.js memenuhi syarat (`>= 22.5.0`).*

### 3. Inisialisasi Proyek
```bash
shadow init
```
*Membuat Grimoire Vault lokal, mengunci izin file `.env` ke `chmod 600`, dan menghasilkan password login 9Router secara acak.*

### 4. Jalankan Service & Pantau Healthcheck
```bash
shadow up --wait
```

Buka **`http://127.0.0.1:20140`** di browser. Masukkan password yang dihasilkan. Lupa password? Tampilkan kapan saja:
```bash
shadow creds reveal nine-router-initial-password
```

---

## 🔐 Keamanan Zero-Plaintext (Grimoire Vault)

Kebanyakan developer menyimpan API key OpenAI, Anthropic, dan password database dalam bentuk teks polos di file `.env` yang berisiko ter-push ke repository publik. 

**Shadow Core mengeliminasi risiko ini dengan Triple-Layer Zero-Plaintext Defense:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│             TRIPLE-LAYER ZERO-PLAINTEXT ENGINE DI SHADOW CORE               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Layer 1: Transparent Secret Sniffer (< 2 ms Latency)                       │
│  ► Memindai prompt pengguna & argumen tool secara real-time.               │
│  ► Mendeteksi token (npm, OpenAI, Anthropic, Gemini, GitHub, AWS, dll).      │
│  ► Otomatis mengenkripsi ke Vault lokal & menggantinya jadi 'secretRef:'.   │
│  ► Model AI (Claude/Gemini/GPT) TIDAK PERNAH melihat token asli!           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Layer 2: Just-in-Time (JIT) Native Interactive Prompt                      │
│  ► Jika suatu tool membutuhkan rahasia yang belum ada di Vault,             │
│    sistem tidak crash atau memaksa buka terminal lain.                      │
│  ► Prompt masked muncul langsung di sesi berjalan, paste, eksekusi lanjut.  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Layer 3: Silent Ingestion (.env Auto-Vaulting on Boot)                     │
│  ► Menghapus kewajiban setup manual.                                       │
│  ► Jika user paste teks polos di .env, sistem saat boot otomatis            │
│    memindahkannya ke SQLite Vault terenkripsi dan mengganti ke 'secretRef:'. │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ⚡ Benchmark Latensi di Laptop/Desktop Pengembang: Shadow Core vs LLM-Guard

Banyak library guardrails (seperti *LLM-Guard*) menjadi lambat (800ms – 2500ms) karena menjalankan model Deep Learning (PyTorch/Transformers) yang berat di CPU. Shadow Core menggunakan algoritma DFA C++ V8 dan instruksi silikon perangkat keras (**AES-NI**):

| Parameter Uji | LLM-Guard (Python / PyTorch) | Shadow Core Sniffer (Pure Node.js stdlib) |
|---|:---:|:---:|
| **Metode Pemindaian** | Deep Learning Transformers (BERT/DeBERTa) | Regex DFA C++ V8 + Fast-Path Bailout |
| **Akselerasi Kriptografi**| Software Loop Python | **Instruksi Silikon Hardware (AES-NI)** |
| **Latensi di Laptop Biasa**| 🔴 **800 ms – 2.500 ms** (Terasa jeda) | 🟢 **< 2 milidetik (0.002 detik)** (Seketika) |
| **Dependensi Eksternal** | Butuh PyTorch, HuggingFace (~2GB) | **0 Dependencies** (100% Pustaka Standar) |
| **Konsumsi Memori Ekstra**| 1.5 GiB – 3.0 GiB RAM | **< 10 MiB RAM** |

### 🛡️ Batasan Privasi Pemindaian (Privacy Perimeter)
- **Hanya Memindai Konteks Aktif**: Yang dipindai hanyalah prompt yang dikirim pengguna, argumen tool yang dieksekusi agen AI, dan konfigurasi `.env` proyek lokal.
- **Tanpa Telemetri / Cloud Phoning**: 100% pemrosesan dilakukan di RAM dan database SQLite lokal (`127.0.0.1`).
- **Tidak Membaca File Pribadi**: Shadow Core tidak pernah memindai folder pribadi di luar workspace proyek aktif.

### Mengelola Kredensial via CLI:
```bash
# Uji coba pemindaian teks instan (<2ms)
shadow sniffer scan "Deploying with npm_abcdef1234567890abcdef12345678901234"

# Pindai dan otomatis amankan ke Vault
shadow sniffer redact "Deploying with npm_abcdef1234567890abcdef12345678901234"

# Lihat daftar rahasia tersimpan di Grimoire Vault
shadow creds list

# Tampilkan nilai rahasia tertentu
shadow creds reveal cognee-llm-api-key

# Simpan rahasia baru (akan meminta input masked jika nilai tidak disertakan)
shadow creds set cognee-llm-api-key
```

---

## 🧩 Universal AI Agent Skill (Mode Headless - 0 Docker, 0 RAM)

Ingin melindungi token Anda di **Cursor**, **Claude Desktop**, atau **Cline** tanpa perlu menyalakan Docker dan tanpa mengorbankan RAM?

Gunakan Shadow Core sebagai **Universal Agent Skill** (mirip konsep *antislop*):

```bash
# Pasang otomatis ke seluruh agent terdeteksi (Cursor, Claude, Cline, Antigravity):
shadow skill install

# Atau jalankan langsung via npx:
npx @agunggnn/shadow-core skill install
```

### Mengapa Sangat Ringan dan Tidak Membebani Komputer?
1. **0 Docker**: Tidak butuh Docker Engine berjalan di background.
2. **Pakai AI yang Sudah Aktif**: Otomatis menggunakan LLM bawaan pengguna (Claude 3.7 Sonnet di Claude Desktop, GPT-4o / Claude di Cursor, Gemini di Antigravity). Tidak memaksakan proxy gateway tambahan.
3. **0 MB RAM saat Idle**: MCP server berjalan melalui mode *stdio* bawaan Node.js. Proses hanya menyala dalam milidetik saat agent memanggil tool, lalu langsung idle/keluar.
4. **Penyimpanan Sangat Kecil**: Database Grimoire Vault lokal hanya berukuran ~100 KB di disk Anda.

Cek status integrasi agent yang terpasang di komputer Anda:
```bash
shadow skill status
```

---

## 🧠 Mengaktifkan Memori Persisten (Modul Cognee)

Cognee menyediakan memori graf dan vektor untuk agen AI Anda melalui protokol Model Context Protocol (MCP).

```bash
# 1. Aktifkan modul Cognee
shadow install cognee

# 2. Masukkan API Key LLM untuk ekstraksi entitas graf
shadow creds set cognee-llm-api-key "sk-proj-anda..."

# 3. Jalankan container Cognee dengan verifikasi healthcheck
shadow up --wait cognee

# 4. Daftarkan tools ke Claude Desktop / Cursor
shadow mcp configure
```

### Memanggil Tools MCP Langsung dari Terminal
Anda dapat menguji fungsi memori tanpa perlu membuka IDE:
```bash
# Cek latency endpoint MCP
shadow mcp ping cognee

# Lihat daftar tools dengan status [OFFLINE], [HYBRID], atau [LLM REASONING]
shadow mcp tools cognee

# Simpan konteks ke memori jangka panjang
shadow mcp call cognee remember '{"text": "Arsitektur database produksi menggunakan Postgres 16 di port 5432"}'

# Lakukan semantic search memori
shadow mcp call cognee recall '{"query": "database produksi port berapa?"}'
```

---

## 🤖 Pembuat Resep Modul Otomatis (AI Synthesizer)

Ingin menambahkan service atau container baru ke dalam ekosistem Shadow Core? Gunakan AI module synthesizer:

```bash
shadow module create my-custom-service --source https://github.com/user/my-repo
```
9Router akan menganalisis repository atau file compose sumber, mendeteksi port dan volume yang dibutuhkan, mengamankan binding ke `127.0.0.1`, dan menghasilkan resep `recipe.json` yang tervalidasi secara otomatis.

---

## 🛠️ Ringkasan Perintah CLI (Cheat Sheet)

| Perintah | Fungsi & Kegunaan |
|---|---|
| `shadow doctor [--fix]` | Memeriksa kesiapan sistem, Node.js, socket Docker, dan memperbaiki permission |
| `shadow init [dir]` | Menginisialisasi instance baru, membuat Grimoire Vault, dan mengamankan `.env` |
| `shadow up [srv\|all] [--wait]` | Menjalankan container dengan polling healthcheck dan HTTP smoketest aktif |
| `shadow down [-v]` | Menghentikan container (`-v` menghapus volume data jika ingin reset total) |
| `shadow status` | Menampilkan ringkasan status container, ports, dan image digests |
| `shadow logs [service]` | Streaming log container secara real-time |
| `shadow tui` | Membuka dashboard operations real-time di terminal |
| `shadow creds [list]` | Menampilkan seluruh kunci rahasia yang tersimpan di Grimoire Vault |
| `shadow creds reveal <id>` | Menampilkan nilai asli rahasia terenkripsi |
| `shadow creds set <id> [val]` | Menyimpan rahasia baru dengan enkripsi AES-256-GCM (masked prompt) |
| `shadow sniffer [scan\|redact]`| Pindai dan amankan kredensial dari teks/prompt secara instan (<2ms) |
| `shadow skill [install\|status]`| Pasang Universal AI Skill ke Cursor, Claude, Cline (0 Docker, 0 RAM) |
| `shadow modules` | Menampilkan daftar modul yang terinstal dan tersedia |
| `shadow install <module>` | Mengaktifkan modul baru melalui interactive wizard |
| `shadow remove <module>` | Menonaktifkan modul tanpa menghapus data persisten |
| `shadow module create <id>` | Membuat resep modul baru dengan bantuan analisis AI 9Router |
| `shadow mcp ping [service]` | Menguji handshake JSON-RPC dan latency endpoint MCP |
| `shadow mcp tools [service]` | Melihat daftar tools MCP dan klasifikasi `[OFFLINE]`/`[HYBRID]`/`[LLM]` |
| `shadow mcp call <srv> <tool>`| Mengeksekusi tool MCP secara langsung via CLI |
| `shadow mcp configure` | Mendaftarkan endpoint MCP aktif ke konfigurasi `.mcp.json` |

---

## 🗑️ Panduan Uninstall & Pembersihan Total

Untuk menghapus Shadow Core secara menyeluruh dari mesin Anda:

```bash
# 1. Hentikan container dan hapus volume persistent
shadow down -v

# 2. Hapus direktori proyek
cd .. && rm -rf shadow-core

# 3. Hapus binary CLI global
npm uninstall -g @agunggnn/shadow-core

# 4. (Opsional) Bersihkan image Docker yang tidak terpakai
docker image prune -a
```

---

## 📄 Lisensi

Didistribusikan di bawah lisensi resmi **Apache-2.0**. Lihat file [`LICENSE`](LICENSE) dan [`NOTICE`](NOTICE) untuk detail selengkapnya.
