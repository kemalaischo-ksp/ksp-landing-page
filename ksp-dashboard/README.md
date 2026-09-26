# Traffic Pekerjaan KSP — Dashboard AIO-KSP

Dashboard traffic pekerjaan untuk **AL-WILDAN ISLAMIC SCHOOL HOLDING / AISCHO**:
menampilkan status, tren, heatmap, dan beban tugas dari workspace ClickUp
**AIO-KSP** (list "List", ID `901817330442`), bergaya
[PaceUI Logs Analytics](https://paceui.com/preview/templates/ultimate-dashboard/dashboards/logs),
dengan **login Better Auth (SQLite)** — akun admin & atasan (view-only).

## Fitur

- **Stat cards** — total tugas, penyelesaian, terlambat, sedang dikerjakan, jatuh tempo 7 hari.
- **Traffic Aktivitas** — grafik update & penyelesaian per minggu (13/8/4 minggu) + tooltip kursor.
- **Heatmap Aktivitas Mingguan** — intensitas per hari × blok jam (WIB).
- **Distribusi Status** — donut interaktif (Selesai / Dikerjakan / Belum / Terlambat).
- **Live Feed & Aktivitas Terbaru** — kejadian terkini + pencarian live.
- **Peta Tugas (Graph)** — graph interaktif ala Obsidian (root → workstream → tugas),
  klik cabang untuk fokus, seret/zoom, hasil pencarian ikut tersorot (d3).
- **Notifikasi** — lonceng real-time: tugas terlambat, jatuh tempo ≤7 hari,
  baru selesai, tugas baru (data dari `/api/dashboard-data`).
- **Beban per Workstream & Kapasitas/Risiko** — distribusi beban, tooltip saat hover.
- **Panel "Progress Launch"** — progres proyek dibaca otomatis dari `../PROGRESS.md`
  (`GET /api/progress`); ubah `.md` → panel ikut berubah tanpa ubah kode.
- **Real-time** — auto-poll 3 dtk ke `/api/version` (murah) + SSE
  `GET /api/stream` saat webhook ClickUp memicu refresh + auto-refresh 30 dtk.
- **Login Better Auth** — email + password, sesi cookie httpOnly, registrasi publik dimatikan.
- **Panel Admin & Role** — Admin membuat/mengatur/menghapus akun; **Atasan/Viewer**
  hanya melihat (tidak bisa klik tugas, tanpa panel admin).

## Isi folder

```
ksp-dashboard/
├── public/
│   ├── index.html      # Dashboard (dikunci login saat dijalankan via server)
│   ├── login.html      # Halaman login (Better Auth, tema putih PaceUI)
│   └── ...
├── server/
│   ├── server.js        # Express + Better Auth + sinkron ClickUp + rate-limit login
│   ├── auth.js          # Konfigurasi Better Auth (SQLite, single-admin)
│   ├── seed-admin.js    # Buat akun admin KSP (otomatis di container, sekali jalan)
│   ├── register-webhook.js # Daftarkan webhook ClickUp utk update instan (sekali)
│   ├── package.json
│   └── .env.example
├── Dockerfile           # Image produksi (build toolchain utk better-sqlite3)
├── docker-compose.yml   # Deploy di VPS, bind 127.0.0.1:3100, volume auth.db + PROGRESS.md
├── deploy-vps.sh        # rsync → VPS → docker compose up (opsional cloudflared)
└── .env.prod.example    # Template konfigurasi produksi
```

`public/index.html` bisa dibuka langsung sebagai file statis untuk **pratinjau**
(snapshot 25 Sep 2026). Di balik server, halaman yang sama memakai data live
dari `/api/dashboard-data` — tanpa mengubah HTML.

## Menjalankan lokal

```bash
cd server
cp .env.example .env
# isi: CLICKUP_TOKEN, CLICKUP_TEAM_ID (opsional), BETTER_AUTH_SECRET (openssl rand -base64 32),
#      ADMIN_EMAIL, ADMIN_PASSWORD (min 8); opsional CLICKUP_WEBHOOK_SECRET utk webhook
npm install

# 1. Buat tabel auth di SQLite
npx @better-auth/cli migrate

# 2. Buat akun admin KSP (sekali saja)
npm run seed

# 3. (Opsional) Daftarkan webhook utk update instan
npm run register-webhook

# 4. Jalankan
npm start
```

Buka `http://localhost:3000` → otomatis diarahkan ke halaman **login**. Masuk
dengan `ADMIN_EMAIL` / `ADMIN_PASSWORD`, dashboard tampil dengan data live
(pratinjau static bila belum bisa akses ClickUp).

> **Keamanan:** registrasi publik diblokir — hanya akun admin pertama dan akun
> yang dibuat lewat **Panel Admin** yang bisa login. Login di-rate-limit
> (5 percobaan gagal / 15 menit per IP).

## Role & akun untuk atasan (view-only)

Login sebagai admin → buka **Panel Admin** di bagian bawah dashboard (atau menu
sidebar):

- **Buat akun** — isi nama, email, kata sandi, role:
  - **Admin** — akses penuh, termasuk panel admin.
  - **Atasan / Viewer** — hanya melihat dashboard. Tidak bisa mengklik tugas,
    tidak ada panel admin. Cocok untuk pimpinan.
- Ubah role / hapus akun langsung dari tabel.

## Real-time

1. **Auto-refresh (default)** — browser mem-poll `/api/version` tiap 3 detik
   (endpoint murah, tidak memanggil ClickUp); saat angka berubah, data ditarik
   ulang. Cadangan: auto-refresh data tiap 30 detik. Server menyegarkan cache
   ClickUp tiap `REFRESH_SECONDS` (min 10 dtk) atau `REFRESH_MINUTES` (bila
   `REFRESH_SECONDS` kosong).
2. **Webhook ClickUp (opsional, 1-3 dtk)** — isi `CLICKUP_WEBHOOK_SECRET`
   (acak, mis. `openssl rand -hex 16`) lalu daftarkan sekali:
   ```bash
   cd server
   npm run register-webhook   # butuh BETTER_AUTH_URL HTTPS publik
   ```
   Server verifikasi `X-Signature`, refresh cache, lalu push ke browser via SSE
   (`GET /api/stream`).

> Webhook butuh domain publik HTTPS. Tanpa webhook, dashboard tetap update
> otomatis via polling (1-3 dtk dibatasi refresh berkala, atau set
> `REFRESH_SECONDS=10`).

## Deploy ke VPS (Docker — mengikuti pola HR 3.0)

Target: `ksp.office-alwildan.id` → VPS Ubuntu + Docker + Caddy (reverse proxy & SSL).

```bash
# 1. Dari Mac — kirim folder (tanpa node_modules & secret lokal)
cd "/Users/kemal/Documents/KSP-AI/BLACK MIRROR/LANDING PAGE KSP"
rsync -avz --exclude 'node_modules' --exclude 'server/node_modules' \
  --exclude '.env' --exclude '.DS_Store' \
  ksp-dashboard/ ubuntu@43.156.130.183:~/ksp-dashboard/

# 2. Di VPS — siapkan konfigurasi & jalankan (migrate + seed otomatis tiap start)
cd ~/ksp-dashboard
cp .env.prod.example .env && chmod 600 .env
nano .env                      # isi CLICKUP_TOKEN, BETTER_AUTH_SECRET, ADMIN_*
docker compose up -d --build
sleep 10
curl http://127.0.0.1:3100/api/health
docker compose logs --tail 15 ksp-dashboard
```

`CMD` container menjalankan `migrate → seed-admin → server` otomatis dan
idempotent; DB auth persist di volume `ksp-auth-data` (`/app/data/auth.db`).

### DNS + Caddy (go-live)

1. Cloudflare → DNS: record **A** `ksp` → `43.156.130.183`, **Proxied ON**.
2. Caddy pasang reverse proxy ke container:

```
ksp.office-alwildan.id {
    reverse_proxy 127.0.0.1:3100
}
```

3. Verifikasi `https://ksp.office-alwildan.id`. **Penting di produksi:** nilai
   `BETTER_AUTH_URL` & `TRUSTED_ORIGINS` harus `https://ksp.office-alwildan.id`
   agar cookie sesi & proteksi CSRF benar. Backup volume `ksp-auth-data`.

Update aplikasi: `rsync ... ; docker compose up -d --build`.

## Menghubungkan ke landing page KSP

- **Tautan langsung** — tombol "Traffic Pekerjaan" → `https://ksp.office-alwildan.id`
  (pengunjung diminta login dulu).
- **Iframe** — dari masukan keamanan (T19) kini **diblokir default**
  (`X-Frame-Options: SAMEORIGIN` + `CSP frame-ancestors 'self'`). Bila landing
  page masih butuh embed, ubah `frame-ancestors 'self'` ke
  `frame-ancestors 'self' https://<domain-landing>` di `server.js`.

## Menyesuaikan sumber data

- Default menyinkronkan satu list (`List` di space `AIO-KSP`). Untuk
  menggabungkan list lain, tambahkan `clickupFetchAllTasks(listId)` per list di
  `server.js` lalu gabungkan sebelum `buildDashboardData`.
- Workstream diambil dari tag ClickUp pertama atau teks sebelum `:` pada judul
  tugas (pola penamaan AIO-KSP).

## Snapshot fallback

Tanpa server, `index.html` memakai snapshot nyata per 25 Sep 2026: **374 tugas**
— 169 selesai, 20 dikerjakan, 185 belum, 102 terlambat, 23 jatuh tempo 7 hari.
Setelah server live, seluruh angka diganti data real-time ClickUp.