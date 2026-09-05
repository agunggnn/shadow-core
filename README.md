# Shadow Core

[![npm version](https://img.shields.io/npm/v/@agunggnn/shadow-core.svg)](https://www.npmjs.com/package/@agunggnn/shadow-core)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org/)
[![Docker Compose](https://img.shields.io/badge/docker--compose-v2-blue.svg)](https://docs.docker.com/compose/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Zero External Dependencies](https://img.shields.io/badge/dependencies-0%20(pure%20Node%20stdlib)-success.svg)](package.json)

**Shadow Core** adalah *local-first AI command plane & orchestrator* untuk mengelola gateway model AI (seperti **9Router**), memori persisten (**Cognee**), kredensial terenkripsi (*Zero-Plaintext Vault*), dan protokol **Model Context Protocol (MCP)** dengan satu CLI mandiri tanpa dependensi eksternal.

---

## ⚡ Mengapa Shadow Core?

Ketika menjalankan berbagai layanan AI lokal (model router, server MCP, memori graf/vektor), developer biasanya menghadapi masalah:
- ❌ **Kebocoran Kredensial**: API key dan password tersimpan dalam teks polos di file `.env` yang rentan ter-commit ke Git.
- ❌ **Konfigurasi Docker yang Rumit**: Mengelola banyak file `docker-compose` secara manual menyulitkan update digest dan aktivasi modul.
- ❌ **Kurangnya Wizard & Visibilitas**: Sulit mengetahui status health container dan kredensial awal yang dihasilkan.

**Shadow Core memecahkan masalah ini dengan:**
1. 🛡️ **Grimoire Vault (AES-256-GCM + SQLite)**: Menyimpan semua rahasia terenkripsi di database lokal. File `.env` hanya menyimpan referensi `secretRef:<id>` (*Zero-Plaintext*).
2. 🧩 **Arsitektur Modul**: Modul seperti **9Router** dan **Cognee** dapat diaktifkan (`install`), dinonaktifkan (`remove`), atau diperbarui (`update`) secara independen dengan satu perintah.
3. 🔑 **Manajemen Kredensial Interaktif (`shadow creds`)**: Periksa, simpan, atau ubah kredensial langsung dari CLI tanpa perlu menyentuh file `.env`.
4. 🌐 **Bridge MCP Universal**: Hubungkan seluruh layanan AI lokal langsung ke **Claude Desktop**, **Cursor**, **Cline**, dan agen AI lainnya.
5. 📊 **Terminal Operations TUI**: Monitor real-time status container, memory, dan port tanpa rekayasa metrik.

---

## 🚀 Panduan Instalasi Default CLI

### Metode 1: Instalasi Global via NPM (Direkomendasikan untuk Pengguna)

Instal `shadow` CLI secara global ke sistem Anda:

```bash
npm install -g @agunggnn/shadow-core
```

Setelah terinstal, buat proyek baru di mana saja:

```bash
mkdir my-ai-plane && cd my-ai-plane
shadow init
shadow up
shadow tui
```

### Metode 2: Tanpa Instalasi Global (via `npx`)

Anda juga bisa langsung menginisialisasi proyek tanpa instalasi global:

```bash
npx @agunggnn/shadow-core init my-ai-plane
cd my-ai-plane
npx @agunggnn/shadow-core up
```

### Metode 3: Dari Source Git (Untuk Developer & Kontributor)

```bash
git clone https://github.com/agunggnn/shadow-core.git
cd shadow-core
npm install
npm link
shadow init
shadow up
```

---

## 🧙‍♂️ Tutorial Awal & Alur Kredensial (Wizard)

### 1. Inisialisasi Proyek (`shadow init`)

Jalankan perintah inisialisasi pada direktori proyek Anda:

```bash
shadow init
```

CLI akan membuat struktur proyek, mengamankan file `.env` (izin akses `600`), menginisialisasi **Grimoire Vault** (`data/shadow-vault.db`), dan menampilkan wizard:

```text
================================================================================
  SHADOW CORE - INISIALISASI PROYEK BERHASIL
================================================================================
[v] Direktori Proyek  : /path/to/my-ai-plane
[v] File Konfigurasi  : .env (izin akses diamankan chmod 600)
[v] Grimoire Vault    : data/shadow-vault.db (Terenkripsi AES-256-GCM)
[v] MCP Server        : .mcp.json terkonfigurasi
--------------------------------------------------------------------------------
  INFORMASI LOGIN & KREDENSIAL AWAL 9ROUTER:
--------------------------------------------------------------------------------
  URL Web UI       : http://127.0.0.1:20140
  Username Default : admin
  Initial Password : 9f8a7b6c5d4e3f21

  CATATAN KEAMANAN (ZERO-PLAINTEXT):
  Password ini telah dienkripsi di Grimoire Vault (data/shadow-vault.db).
  File .env hanya menyimpan referensi aman:
    NINE_ROUTER_INITIAL_PASSWORD=secretRef:nine-router-initial-password
================================================================================
```

### 2. Mengapa file `.env` menggunakan `secretRef:`?

Shadow Core dirancang dengan prinsip **Zero-Plaintext**. Password atau API key tidak disimpan dalam teks polos di `.env`. Sebagai gantinya:
- Nilai rahasia dienkripsi dengan **AES-256-GCM** menggunakan kunci master `SHADOW_GRIMOIRE_KEY` dan disimpan di database SQLite `data/shadow-vault.db`.
- File `.env` hanya menyimpan referensi seperti `secretRef:nine-router-initial-password`.
- Saat Docker Compose dijalankan (`shadow up`), CLI secara otomatis membaca vault dan menginjeksi rahasia ke memori container secara aman.

### 3. Mengelola Kredensial dengan `shadow creds`

Anda **tidak perlu** mengedit file `.env` secara manual jika ingin melihat atau mengganti password.

#### A. Melihat Daftar Kredensial
```bash
shadow creds list
```
Menampilkan semua kredensial aktif beserta modul yang menggunakannya.

#### B. Melihat Nilai Rahasia (Password / Token)
Lupa password awal 9Router? Buka kapan saja:
```bash
shadow creds reveal nine-router-initial-password
```

#### C. Mengganti Password atau Menyetel API Key
Ingin mengganti password 9Router atau menyetel API key baru?
```bash
shadow creds set nine-router-initial-password PasswordBaruAnda123!
```
Perintah ini akan mengenkripsi password baru ke dalam vault dan memperbarui `.env` tanpa merusak format `secretRef:`. Setelah itu, terapkan dengan:
```bash
shadow up
```

---

## 🧩 Manajemen Modul

Shadow Core mendukung modularitas penuh. Modul bawaan adalah `core` (headless command plane) dan `9router` (AI gateway).

Lihat status semua modul:
```bash
shadow modules
```

### Modul 9Router (AI Gateway)
9Router bertugas sebagai gateway model AI cerdas untuk merutekan request ke provider (OpenAI, Anthropic, Gemini, Groq, Ollama, dll.) secara hemat dan dengan fallback otomatis.
- **Akses Web UI**: Buka `http://127.0.0.1:20140` di browser.
- **Login**: Masukkan password awal yang didapat dari `shadow creds reveal nine-router-initial-password`.
- **Update 9Router**:
  ```bash
  shadow update 9router
  ```
- **Menonaktifkan 9Router** (jika hanya ingin menggunakan command plane):
  ```bash
  shadow remove 9router
  shadow up
  ```
- **Mengaktifkan kembali 9Router**:
  ```bash
  shadow install 9router
  shadow up
  ```

### Modul Cognee (Persistent Memory)
Cognee adalah modul memori graf dan vektor persisten yang terhubung melalui Model Context Protocol (MCP).

1. **Aktifkan modul**:
   ```bash
   shadow install cognee
   ```
2. **Atur API Key LLM ke dalam Vault**:
   ```bash
   shadow creds set cognee-llm-api-key <api-key-llm-anda>
   ```
3. **Mulai service Cognee**:
   ```bash
   shadow up cognee
   ```
4. **Daftarkan endpoint MCP**:
   ```bash
   shadow mcp configure
   ```
   Tools berikut akan otomatis tersedia bagi agen MCP: `remember`, `recall`, `improve`, dan `forget_memory`.

---

## 🛠️ Ringkasan Perintah CLI

| Perintah | Deskripsi |
|---|---|
| `shadow init [dir]` | Inisialisasi proyek baru, amankan `.env`, dan buat Grimoire Vault |
| `shadow doctor` | Validasi instalasi Docker dan kontrak Docker Compose |
| `shadow up [target\|all]` | Unduh dan jalankan service (default menjalankan semua modul aktif) |
| `shadow update [target\|all]` | Migrasikan image pin digest, buat ulang container, dan verifikasi health |
| `shadow down` | Hentikan container tanpa menghapus volume data |
| `shadow status` | Tampilkan status container dan image |
| `shadow logs [service]` | Pantau log container secara real-time |
| `shadow modules` | Tampilkan daftar modul yang tersedia dan statusnya (enabled/disabled) |
| `shadow install <module>` | Aktifkan modul (contoh: `shadow install cognee`) |
| `shadow remove <module>` | Nonaktifkan modul tanpa menghapus data |
| `shadow creds [list]` | Tampilkan daftar kredensial dalam Grimoire Vault |
| `shadow creds reveal <id>` | Tampilkan nilai rahasia dan petunjuk penggunaannya |
| `shadow creds set <id> <val>`| Simpan atau perbarui nilai rahasia di dalam Vault terenkripsi |
| `shadow mcp configure` | Daftarkan endpoint MCP modul aktif ke `.mcp.json` |
| `shadow mcp serve` | Jalankan MCP bridge server |
| `shadow tui` | Buka terminal dashboard live operations view |

---

## 🔒 Keamanan & Batasan Jaringan

- **Loopback Binding**: Seluruh port layanan (misalnya port `20140` untuk 9Router dan `8001` untuk Cognee) secara default hanya di-bind ke `127.0.0.1`.
- **Master Key**: Jangan pernah membagikan atau meng-commit `SHADOW_GRIMOIRE_KEY` ke Git repository publik.
- **File Permissions**: File `.env` secara otomatis diberi izin akses ketat `chmod 600` pada sistem operasi berbasis Unix/POSIX.
- Lihat panduan lengkap di [`SECURITY.md`](SECURITY.md).

---

## 💻 Pengembangan & Kontribusi

```bash
# Menjalankan seluruh unit test
npm test

# Menjalankan static check & linting
npm run lint

# Menjalankan validasi paket
npm pack --dry-run
```

Lihat panduan lengkap kontribusi di [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## 📄 Lisensi

Didistribusikan di bawah lisensi **Apache-2.0**. Lihat file [`LICENSE`](LICENSE) dan [`NOTICE`](NOTICE) untuk informasi selengkapnya.
