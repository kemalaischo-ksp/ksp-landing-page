# KSP Landing Project — Log Progres

Dokumen ini mencatat setiap tahapan yang sudah diproses dari beberapa terminal
untuk proyek **KSP Landing Page / Dashboard Traffic Pekerjaan KSP**.

- Tanggal: 25 September 2026
- Lokasi proyek: `/Users/kemal/Documents/KSP-AI/BLACK MIRROR/LANDING PAGE KSP`
- Repo: https://github.com/kemalaischo-ksp/ksp-landing-page (public)
- Domain target: `ksp.office-alwildan.id`

## Ringkasan Status

| # | Tahapan | Status | Keterangan |
|---|---|---|---|
| 1 | Susun struktur dashboard (public + server) | ✅ Selesai | `ksp-dashboard/` |
| 2 | Jalankan server lokal | ✅ Selesai | Port `3100` (3000 dipakai HRIS) |
| 3 | Input token ClickUp & live sync | ✅ Selesai | 339 tugas tersinkron |
| 4 | Siapkan aset deploy VPS (Docker) | ✅ Selesai | `Dockerfile`, `docker-compose.yml` |
| 5 | Skrip deploy VPS + cloudflared | ✅ Selesai | `deploy-vps.sh` |
| 6 | Git init + commit | ✅ Selesai | Commit `e731cb5` |
| 7 | Buat repo GitHub + push | ✅ Selesai | `ksp-landing-page` (public) |
| 8 | Deploy ke VPS | ⏳ Tertunda | Butuh SSH key + isi `.env` VPS |
| 9 | Pasang tunnel Cloudflare | ⏳ Tertunda | Public Hostname → `http://localhost:3100` |
| 10 | DNS + go-live ke landing page | ⏳ Tertunda | Arahkan domain/subdomain |
| 11 | Panel "Progress Launch" di dashboard | ✅ Selesai | Baca otomatis dari `PROGRESS.md` via `/api/progress` |
| 12 | Panel login "better auth" (simple & elegan) | ✅ Selesai | Login page + session cookie, proteksi seluruh dashboard |
| 13 | Review build external Claude vs build saat ini | ✅ Selesai | Keputusan: adopsi build external (Better Auth) sebagai basis deploy |
| 14 | Adopsi sistem Better Auth (external) sebagai basis deploy | ✅ Selesai | Merge ke `ksp-dashboard/`, backport Progress panel + Docker + rate-limit |
| 15 | Update terbaru (external): Graph, Notifikasi, webhook instan | ✅ Selesai | Di-merge ke `ksp-dashboard/` + backport Progress/rate-limit/trust proxy |
| 16 | Update #2 (external): Tugas klikable, modal, filter workstream, search popup | ✅ Selesai | Merge `UPDATE/U#2/` + backport Progress/rate-limit/trust proxy |
| 17 | Update #3 (external): Tulis ke ClickUp — ubah status & buat tugas | ✅ Selesai | Merge `UPDATE/U#3/` + backport Progress/rate-limit/trust proxy |

---

## Log per Tahapan

### T1 — Struktur proyek

- Folder `ksp-dashboard/` berisi halaman statis `public/index.html` (dengan
  snapshot fallback) dan backend Express `server/server.js`.
- Data sumber: ClickUp list `List` (`901817330442`) di space AIO-KSP.

### T2 — Server lokal & konflik port

- Port `3000` ternyata dipakai aplikasi lain (`hris-app`, judul "HRIS AL-WILDAN").
- Dashboard KSP dialihkan ke port **3100** lewat `ksp-dashboard/server/.env`
  (`PORT=3100`) agar tidak bertabrakan.
- Perintah: `npm install && npm start` di `ksp-dashboard/server`.

### T3 — Token ClickUp & sinkronisasi live

- `CLICKUP_TOKEN` diisi di `ksp-dashboard/server/.env` (file ini **tidak**
  di-commit, ter-gitignore).
- Hasil sync: total **339** tugas → selesai 155, in progress 20, todo 164,
  overdue 90, jatuh tempo 7 hari 27.
- Endpoint: `/api/dashboard-data` dan `/api/health`.

### T4 — Aset deploy VPS (Docker)

- `Dockerfile` (node:22-bookworm-slim, `PORT=3100`).
- `docker-compose.yml` bind `127.0.0.1:3100:3100` (konsisten pola HR 3.0).
- `.env.prod.example`, `.dockerignore`, `.gitignore`.

### T5 — Skrip deploy

- `ksp-dashboard/deploy-vps.sh`: rsync folder → VPS, siapkan `.env`,
  `docker compose up -d --build`, opsional install & jalankan cloudflared.
- Target VPS: `ubuntu@43.156.130.183`.

### T6 — Git init + commit

- `git init -b main`, commit awal `e731cb5`
  ("Initial commit: Dashboard Traffic Pekerjaan KSP (AIO-KSP)").
- `server/.env` terverifikasi **tidak** ikut ter-commit.

### T7 — Repo GitHub + push

- Repo dibuat via `gh` (login dengan token): `kemalaischo-ksp/ksp-landing-page`.
- Branch `main` ter-push dan tracking `origin/main`.
- `.env` terverifikasi tidak ada di remote.

### T8 — Deploy ke VPS (TERTUNDA)

Blocker: SSH dari Mac masih `Permission denied (publickey,password)`.

Langkah lanjutan:
```bash
ssh-copy-id ubuntu@43.156.130.183
cd "/Users/kemal/Documents/KSP-AI/BLACK MIRROR/LANDING PAGE KSP/ksp-dashboard"
CLOUDFLARE_TUNNEL_TOKEN='<token-tunnel>' ./deploy-vps.sh
```
Isi dulu `CLICKUP_TOKEN` di `.env` VPS (dari `.env.prod.example`).

### T9 — Tunnel Cloudflare (TERTUNDA)

- `cloudflared` belum terpasang di Mac maupun VPS.
- Setelah tunnel jalan: Cloudflare Zero Trust → Networks → Tunnels →
  **Public Hostname** → Service: `http://localhost:3100`.

### T10 — DNS + go-live (TERTUNDA)

- Cloudflare DNS: record **A** `ksp` → `43.156.130.183`, Proxied ON.
- Reverse proxy (Caddy/cloudflared) → `127.0.0.1:3100`.
- Sambungkan dari landing page: tautan langsung atau iframe
  `<iframe src="https://ksp.office-alwildan.id" style="width:100%;height:100vh;border:0"></iframe>`.

### T11 — Panel "Progress Launch" (SELESAI)

- Dashboard kini punya panel **Progress Launch Proyek** yang menampilkan tabel
  Ringkasan Status di dokumen ini sebagai stepper + progress bar.
- Sumber tunggal: `PROGRESS.md`. Server Express membaca file ini di endpoint
  `GET /api/progress` lalu mem-parse baris tabel; mengubah `.md` otomatis
  mengubah panel (tanpa ubah kode).
- Lokasi file default: `../PROGRESS.md` relatif ke `ksp-dashboard/`. Di Docker
  di-mount read-only `../PROGRESS.md:/app/PROGRESS.md` dan diset lewat env
  `PROGRESS_FILE=/app/PROGRESS.md` (lihat `docker-compose.yml`).
- Bila dashboard dibuka sebagai file statis (tanpa server), panel otomatis
  disembunyikan.

### T12 — Panel login "better auth" (SELESAI)

Dashboard `ksp-dashboard` kini diamankan dengan halaman login gaya simple-clean
(palet zinc selaras `index.html`, font Inter, dark-mode via
`prefers-color-scheme`). Tanpa dependency tambahan (tetap `express` + `dotenv`):

- `public/login.html` (baru) — kartu login terpusat, field nama pengguna &
  kata sandi, tombol show/hide password, loading state, pesan error halus,
  footer *AL-WILDAN ISLAMIC SCHOOL HOLDING*.
- `server/server.js` (auth) — `POST /api/login` (token session via
  `crypto.randomBytes`, Map in-memory, TTL `SESSION_HOURS` default 12),
  `POST /api/logout`, `GET /api/me`, middleware proteksi semua route kecuali
  `/login`, `/api/login`, `/api/health` (utk healthcheck deploy). GET belum
  login → redirect 302 ke `/login`; `/api/*` → 401.
- Rate limit login in-memory: 5 percobaan gagal / 15 menit per IP → `429`.
- Credentials via env: `ADMIN_USER` + `ADMIN_PASS_HASH` (SHA-256 hex,
  divalidasi 64 hex saat boot, dibanding pakai `crypto.timingSafeEqual`);
  fallback `ADMIN_PASS` plaintext hanya utk dev. Generate:
  `echo -n "PASSWORD" | shasum -a 256`.
- Sesi tersimpan in-memory (direset saat server restart — wajar utk dashboard
  internal). Cookie `ksp_session` httpOnly, SameSite=Lax, Secure saat di
  belakang HTTPS/proxy.
- File yang disentuh: `public/login.html` (baru), `server/server.js`,
  `server/.env.example`, `.env.prod.example`, `docker-compose.yml`,
  `README.md`.
- Verifikasi: uji curl penuh lulus — redirect `/`→`/login`, 401 utk API tanpa
  sesi, login benar→cookie→akses `/` 200, logout→sesi batal, rate-limit 429,
  guard boot utk hash invalid.

---

## Review — External build (Claude) vs build saat ini

Tanggal review: 25 Sep 2026. External build ada di folder `UPDATE_CLAUDE/`
(duplikat penuh: `public/index.html` 48 KB, `public/login.html`, `server/`
dengan Better Auth SQLite). Build saat ini = `ksp-dashboard/` (T11 + T12).

### Perbandingan

| Dimensi | External (`UPDATE_CLAUDE/`) | Saat ini (`ksp-dashboard/`) | Lebih siap |
|---|---|---|---|
| Library auth | Better Auth + better-sqlite3 (hash aman, sesi persist 7 hari, CSRF) | Buatan sendiri (SHA-256, sesi in-memory, cookie httpOnly) | **External** ⭐ |
| Role & manajemen akun | Admin + Viewer/Atasan (read-only), Panel Admin (buat/hapus/ubah role) | Single user (admin) | **External** ⭐ |
| Registrasi publik | Diblokir server | Tidak ada jalur sign-up | **External** ⭐ |
| Rate limit login | Tidak ada | Ada (5 gagal/15 mnt/IP) | **Saat ini** ⭐ |
| Real-time | SSE + webhook ClickUp (instan) + auto-refresh 30 dtk | Refresh berkala saja | **External** ⭐ |
| Fitur dashboard UI | Donut status, live search, preview role, tooltip interaktif | Dasar PaceUI | **External** ⭐ |
| Panel Progress Launch (T11) | Tidak ada | Ada (via `/api/progress`) | **Saat ini** ⭐ |
| Dependency tambahan | better-auth, better-sqlite3 (native), CLI | `express` + `dotenv` saja | **Saat ini** ⭐ |
| Deploy | pm2 manual, tanpa Dockerfile | Docker + Caddy/cloudflared siap | **Saat ini** ⭐ |
| `trust proxy` / cookie behind proxy | Tidak diset | Diset (`app.set('trust proxy',1)`) | **Saat ini** ⭐ |
| Jalur statis tanpa server | Pratinjau + snapshot (login dikunci saat di server) | Tetap jalan + snapshot | **Saat ini** ⭐ |

### Kesimpulan

- **Paling siap go-live hari ini (cepat, fitur inti):** `ksp-dashboard/` —
  sudah Docker, zero-dep, panel Progress, dan proteksi login lengkap.
- **Paling siap untuk kebutuhan riil (atasan read-only, akun terkelola,
  real-time):** build **External** — auth enterprise-grade & fitur UI jauh lebih
  kaya, TAPI belum siap deploy: tidak ada Dockerfile, tanpa rate-limit, tanpa
  `trust proxy`, tanpa panel Progress.

### Rekomendasi (paths yang disarankan)

Gabungkan kekuatan keduanya — pakai **External sebagai basis**, lalu backport
dari build saat ini:

1. **Panel Progress Launch** — salin panel `#progress` + `renderProgress` +
   endpoint `/api/progress` (sudah ada di `server.js` saat ini).
2. **Docker** — `Dockerfile` + `docker-compose.yml` + `deploy-vps.sh`; tambah
   catatan build-essential fallback untuk `better-sqlite3` bila tanpa prebuilt.
3. **Rate-limit login** — aktifkan rate limit Better Auth atau middleware IP.
4. **`app.set('trust proxy', 1)`** + `BETTER_AUTH_URL` & `TRUSTED_ORIGINS`=https
   di produksi; `ADMIN_*` dari env; backup `auth.db`.
5. Sebelum go-live: **regenerasi token ClickUp** (saat ini invalid,
   ECODE `OAUTH_025`) dan isi `ADMIN_PASSWORD` (min 8).

Flows: login → `/api/auth/sign-in/email`; sesi 7 hari; atasan pakai akun
`viewer` → dashboard read-only otomatis.

---

## Log per Tahapan (lanjutan)

### T14 — Adopsi sistem Better Auth (SELESAI)

Sistem yang **akan di-deploy** = build **external** (`UPDATE_CLAUDE/`, dibuat
Claude) yang di-merge ke dalam `ksp-dashboard/` sebagai basis:

- Basis: `public/index.html` (donut, live search, preview role, tooltip,
  admin panel UI) + `public/login.html` (email+password, remember me) +
  `server/server.js` (Express ESM) + `server/auth.js` (Better Auth SQLite,
  sesi 7 hari, registrasi publik diblokir) + `server/seed-admin.js`.
- Backport dari build sebelumnya:
  - `app.set('trust proxy', 1)` → cookie sesi benar di belakang Caddy/cloudflared.
  - Rate-limit login (`/api/auth/sign-in/email`): 5 gagal / 15 mnt per IP → 429,
    direset saat login sukses (in-memory).
  - Panel **Progress Launch** + endpoint `GET /api/progress` (baca `PROGRESS.md`).
- Deploy siap: `Dockerfile` (toolchain `python3 make g++` utk better-sqlite3,
  `@better-auth/cli` di `dependencies`, `CMD` = `migrate → seed → server`),
  `docker-compose.yml` (volume `ksp-auth-data` utk `auth.db` + mount
  `PROGRESS.md` ro), `.env.prod.example` diisi `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`/`TRUSTED_ORIGINS`=https, `ADMIN_*`.
- `.gitignore`: `UPDATE_CLAUDE/`, `Screenshot*.png`, `server/*.db`.
- **Verifikasi lokal (Node 22, DB SQLite temp)** — semua lulus:
  `/`→302 `/login.html`; sign-up publik→403; sign-in salah→401; rate-limit
  6× gagal→429 (terkunci, pesan `Rate limited`); sign-in benar→200+cookie;
  `/api/me` role `admin`/`viewer` benar; `/api/admin/users` oleh viewer→403
  (`Butuh hak admin`); `/`, `/api/progress`, `/api/health`, SSE `/api/stream`
  →200 (SSE `text/event-stream`); panel Progress memuat 14 tahapan
  (11 selesai · 3 tertunda — T8/T9/T10).
- Catatan saat verifikasi: `better-sqlite3` di macOS Node 24 gagal kompilasi
  native karena binary node ter-tag `com.apple.provenance` (Data Protection
  macOS) → dipakai **Node 22 LTS** (nvm; prebuilt tersedia), selaras dengan
  `node:22-bookworm-slim` di Dockerfile.

### T15 — Update terbaru (Graph, Notifikasi, Real-time) (SELESAI)

Update eksternal terbaru di folder `UPDATE/` di-merge ke `ksp-dashboard/` sbg
basis deploy, dengan re-backport fitur sebelumnya:

- **Peta Tugas (Graph)** — grafik interaktif ala Obsidian (root → workstream →
  tugas, d3 v7 CDN), klik cabang fokus, seret/zoom, sorotan hasil pencarian.
- **Notifikasi** — lonceng: terlambat, jatuh tempo ≤7 hari, baru selesai,
  tugas baru (`data.notifications`, partisi 30).
- **Update instan + polling murah** — `GET /api/version` (browser poll 3 dtk,
  tanpa panggil ClickUp), `stempel v` di cache, `REFRESH_SECONDS` (min 10 dtk),
  dan **`register-webhook.js`** (`npm run register-webhook`) utk webhook
  ClickUp 1-3 dtk → SSE `/api/stream`.
- Backport dipertahankan: `trust proxy`, rate-limit login (5 gagal/15 mnt),
  panel **Progress Launch** + `GET /api/progress` + `PROGRESS_FILE`.
- Deploy di-update: `.env.prod.example` & `docker-compose.yml`
  (`CLICKUP_TEAM_ID`, `REFRESH_SECONDS`, `CLICKUP_WEBHOOK_SECRET`); README
  diperbarui.
- **Verifikasi (Node 22)**: login admin `kemal@alwildan.id` → 200; `/api/me`
  role admin; `/api/version` 200 `{"v":0}`; `/api/progress` 200 (14 tahapan,
  11 done); `/`→302 tanpa login; `/api/version`/`/api/progress` → 401 tanpa
  login; rate-limit 6× gagal → 429; `/api/dashboard-data` → 503 (token ClickUp
  masih invalid). `index.html` berisi gabungan graph+notif+version+progress.

### T16 — Update #2 (Tugas klikable, Modal, Filter Workstream) (SELESAI)

Update eksternal terbaru dari folder `UPDATE/U#2/` di-merge ke `ksp-dashboard/`
(`public/index.html` + `server/server.js`), dengan re-backport fitur:

- **Daftar tugas lengkap (`data.tasks`)** — backend kini mengirim semua tugas
  ringkas (id, nama, workstream, status, due, overdue, dueSoon, reltime).
- **Kartu statistik yang bisa diklik** — menampilkan daftar tugas terkait
  (fallback dari graph bila tanpa `tasks`).
- **Modal tugas** — klik tugas → detail + tautan langsung ke ClickUp.
- **Filter per-workstream di sidebar** (`wsNav`) + hasil pencarian tersorot.
- **Search popup** (`searchPop`, `spViewAll`) — pencarian global spesifik.
- Backport dipertahankan: `trust proxy`, rate-limit login (5 gagal/15 mnt),
  panel **Progress Launch** + `GET /api/progress` + `PROGRESS_FILE`.
- **Verifikasi (Node 22)**: login `kemal@alwildan.id`→200; `/api/me` admin;
  `/api/version` 200; `/api/progress` 200 (15 tahapan, 12 done, 3 pending);
  `/`→302 tanpa login; API→401 tanpa login; `index.html` 200 berisi
  tasks+modal+wsNav+searchPop+graph+notif+progress.

### T17 — Update #3 (Tulis ke ClickUp: Ubah Status & Buat Tugas) (SELESAI)

Update eksternal terbaru dari folder `UPDATE/U#3/` di-merge ke `ksp-dashboard/`
(`public/index.html` + `server/server.js`), dengan re-backport fitur:

- **Write API ke ClickUp (role admin saja)**:
  - `PATCH /api/task/:id/status` — ubah status tugas → langsung ke ClickUp,
    lalu refresh & dorong via SSE ke semua browser.
  - `POST /api/task` — buat tugas baru di List (nama, status, due_date,
    priority 1-4); validasi nama/status/tanggal.
  - Helper `clickupFetchStatuses` (`data.statuses` = daftar status List utk
    dropdown), `clickupUpdateTaskStatus`, `clickupCreateTask`.
- **Frontend** — tombol **"Tambah Tugas"** (`newTaskBtn` + modal `createModal`),
  dropdown ubah status di modal tugas, toast notifikasi; semua elemen tulis
  disembunyikan utk role viewer.
- Backport dipertahankan: `trust proxy`, rate-limit login (5 gagal/15 mnt),
  panel **Progress Launch** + `GET /api/progress` + `PROGRESS_FILE`.
- **Verifikasi (Node 22)**: write API tanpa login → 401; utk viewer → 403
  (`Butuh hak admin`); admin `POST /api/task` → 502 (token ClickUp masih
  invalid — rute sampai panggil ClickUp); `/api/progress` 200 (17 tahapan,
  14 done? — lihat tabel); login/`/api/me`/`/api/version` OK.

---

## Auto-log ke PROGRESS.md

Agar setiap update otomatis tercatat, repo ini memakai:

- `log-progress.sh` — menambahkan blok "Update otomatis" ke `PROGRESS.md`
  untuk setiap commit baru (sejak titik `.last-progress`).
- `.git/hooks/post-commit` — memanggil `log-progress.sh` otomatis setelah tiap
  commit, lalu membuat commit kecil `docs: log otomatis update ke PROGRESS.md`
  (tanpa re-hook, dan titik `.last-progress` dikonsumsi agar tak dobel-log).
- Nonaktifkan sementara: `KSP_DISABLE_PROGRESS_LOG=1 <git ...>` atau
  `git -c core.hooksPath=/dev/null commit ...`.
- `.last-progress` ter-gitignore (state lokal, bukan bagian dari repo).

---

## Catatan Keamanan

- `server/.env` berisi token ClickUp — **jangan** pernah di-commit/di-push.
- Sebelum go-live, **wajib** isi `ADMIN_PASS_HASH` (SHA-256) di `.env` VPS.
  Bila kosong, server memakai default `admin/admin` (hanya untuk dev).
- Personal Access Token GitHub yang pernah dipakai sebaiknya di-revoke dan
  login ulang via `gh auth login`.
- Token tunnel Cloudflare bersifat rahasia; rotate bila pernah tersebar.
- Token ClickUp di `ksp-dashboard/server/.env` saat ini terdeteksi **invalid**
  (401 `Token invalid`, ECODE `OAUTH_025`) — regenerasi di ClickUp lalu
  perbarui sebelum sinkronisasi live dipakai lagi.

### Update otomatis — 25 Sep 2026 20:42

Commit baru:

    **`f6dc0bc build: adopsi sistem Better Auth (external) sbg basis deploy — roles admin/viewer, real-time (SSE+webhook), panel admin, Progress Launch, Docker ready, rate-limit login, trust proxy`**

File yang berubah:

    - `.gitignore`
    - `PROGRESS.md`
    - `ksp-dashboard/.env.prod.example`
    - `ksp-dashboard/.gitignore`
    - `ksp-dashboard/Dockerfile`
    - `ksp-dashboard/README.md`
    - `ksp-dashboard/docker-compose.yml`
    - `ksp-dashboard/public/index.html`
    - `ksp-dashboard/public/login.html`
    - `ksp-dashboard/server/.env.example`
    - `ksp-dashboard/server/auth.js`
    - `ksp-dashboard/server/package-lock.json`
    - `ksp-dashboard/server/package.json`
    - `ksp-dashboard/server/seed-admin.js`
    - `ksp-dashboard/server/server.js`
    - `log-progress.sh`

### Update otomatis — 26 Sep 2026 20:52

Commit baru:

    **`ae133e0 feat: update external — Peta Tugas (Graph d3), Notifikasi, /api/version (poll 3 detik), webhook ClickUp register; backport Progress Launch, rate-limit login, trust proxy`**

File yang berubah:

    - `.gitignore`
    - `PROGRESS.md`
    - `ksp-dashboard/.env.prod.example`
    - `ksp-dashboard/README.md`
    - `ksp-dashboard/docker-compose.yml`
    - `ksp-dashboard/public/index.html`
    - `ksp-dashboard/server/.env.example`
    - `ksp-dashboard/server/.gitignore`
    - `ksp-dashboard/server/package-lock.json`
    - `ksp-dashboard/server/package.json`
    - `ksp-dashboard/server/register-webhook.js`
    - `ksp-dashboard/server/server.js`

### Update otomatis — 26 Sep 2026 21:46

Commit baru:

    **`e9eabf6 feat: update #2 — daftar tugas klikable (data.tasks), modal detail tugas, filter workstream sidebar, pencarian popup; backport Progress Launch, rate-limit login, trust proxy`**

File yang berubah:

    - `PROGRESS.md`
    - `ksp-dashboard/public/index.html`
    - `ksp-dashboard/server/server.js`

### Update otomatis — 26 Sep 2026 21:47

Commit baru:

    **`088e2dc fix: log-progress.sh fallback aman saat titik tercatat orphan (usai rebase)`**

File yang berubah:

    - `log-progress.sh`

### Update otomatis — 26 Sep 2026 22:58

Commit baru:

    **`efee059 feat: update #3 — write API ke ClickUp (ubah status tugas, buat tugas baru) utk role admin, dropdown status, button tambah tugas; backport Progress Launch, rate-limit login, trust proxy`**

File yang berubah:

    - `PROGRESS.md`
    - `ksp-dashboard/public/index.html`
    - `ksp-dashboard/server/server.js`
