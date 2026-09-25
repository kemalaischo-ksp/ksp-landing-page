# Traffic Pekerjaan KSP — Dashboard AIO-KSP

Dashboard traffic pekerjaan yang menampilkan status, beban, dan aktivitas tugas
dari workspace ClickUp **AIO-KSP** (list "List", ID `901817330442`), bergaya
[PaceUI Logs Analytics](https://paceui.com/preview/templates/ultimate-dashboard/dashboards/logs),
dengan branding AL-WILDAN / AISCHO.

## Isi folder

```
ksp-dashboard/
├── public/
│   └── index.html      # Halaman dashboard (statis, berjalan sendiri tanpa server)
├── server/
│   ├── server.js        # Backend Express — sinkron live ke ClickUp API
│   ├── package.json
│   └── .env.example
├── Dockerfile           # Image produksi (Node serve index.html + API)
├── docker-compose.yml   # Deploy di VPS, bind 127.0.0.1:3100
└── .env.prod.example    # Template konfigurasi produksi
```

`public/index.html` bisa dibuka langsung sebagai file statis (memakai data
snapshot 25 Sep 2026 yang sudah ditanam di dalamnya). Begitu di-deploy di
belakang server Express (`server/server.js`), halaman yang **sama persis**
otomatis mengambil data live dari `/api/dashboard-data` — tidak perlu ubah
apa pun di file HTML.

## Menjalankan lokal

```bash
cd server
cp .env.example .env
# isi CLICKUP_TOKEN dengan Personal API Token dari ClickUp
# (Settings → Apps → API Token, diawali "pk_")
npm install
npm start
```

Buka `http://localhost:3000` — dashboard akan menampilkan data live dari
ClickUp, refresh otomatis tiap 5 menit (bisa diubah lewat `REFRESH_MINUTES`
di `.env`).

## Deploy ke VPS (Docker — mengikuti pola HR 3.0)

Target: `ksp.office-alwildan.id` → VPS Ubuntu + Docker + Caddy (reverse proxy & SSL).

```bash
# 1. Dari Mac — kirim folder (tanpa node_modules & secret lokal)
cd "/Users/kemal/Documents/KSP-AI/BLACK MIRROR/LANDING PAGE KSP"
rsync -avz --exclude 'node_modules' --exclude 'server/node_modules' \
  --exclude '.env' --exclude '.DS_Store' \
  ksp-dashboard/ ubuntu@43.156.130.183:~/ksp-dashboard/

# 2. Di VPS — siapkan konfigurasi & jalankan
cd ~/ksp-dashboard
cp .env.prod.example .env && chmod 600 .env
nano .env                      # isi CLICKUP_TOKEN (pk_...)
docker compose up -d --build
sleep 10
curl http://127.0.0.1:3100/api/health
docker compose logs --tail 15 ksp-dashboard
```

### DNS + Caddy (go-live)

1. Cloudflare → DNS: record **A** `ksp` → `43.156.130.183`, **Proxied ON**.
2. Di VPS, arahkan Caddy ke port container:

```bash
sudo nano /etc/caddy/Caddyfile
# tambahkan:
# ksp.office-alwildan.id {
#     reverse_proxy 127.0.0.1:3100
# }
sudo systemctl reload caddy
```

3. Verifikasi `https://ksp.office-alwildan.id` (gembok hijau). Bila SSL/TLS
   Cloudflare di-set **Full (strict)**, Caddy akan menerbitkan sertifikat
   otomatis.

Update aplikasi di kemudian hari:

```bash
cd ~/ksp-dashboard
rsync ...                        # kirim ulang dari Mac
docker compose up -d --build     # rebuild & restart
```


## Menghubungkan ke landing page KSP

Dashboard ini adalah halaman web mandiri (`index.html` + API). Dua cara
menyematkannya di landing page KSP:

- **Tautan langsung** — tombol/menu "Traffic Pekerjaan" di landing page yang
  mengarah ke `https://ksp.office-alwildan.id`.
- **Iframe** — server sengaja tidak mengirim header `X-Frame-Options`, jadi
  embed cross-origin diperbolehkan:
  `<iframe src="https://ksp.office-alwildan.id" style="width:100%;height:100vh;border:0"></iframe>`.

## Menyesuaikan sumber data

- Default menyinkronkan **satu list** (`List`, di space `AIO-KSP`). Untuk
  menggabungkan list lain di workspace KSP (mis. `ALL IN ONE` atau
  `UPSKILLING & UPGRADING KSP` di space `KSP_WS`), tambahkan pemanggilan
  `clickupFetchAllTasks` per list ID di `server.js` dan gabungkan hasilnya
  sebelum `buildDashboardData`.
- Pengelompokan "Workstream" otomatis diambil dari tag ClickUp pertama pada
  tugas, atau dari teks sebelum tanda `:` di judul tugas (pola penamaan yang
  sudah dipakai di AIO-KSP, mis. `HRIS-KSP : ...`, `MKT : CP SEPT 2026 ...`).

## Data snapshot di dalam index.html

Snapshot yang ditanam di `public/index.html` (variabel `SNAPSHOT`) adalah
agregat nyata dari 374 tugas di list AIO-KSP per 25 September 2026:

| Metrik | Nilai |
|---|---|
| Total tugas | 374 |
| Selesai | 169 (45,2%) |
| Sedang dikerjakan | 20 |
| Belum mulai | 185 |
| Terlambat (overdue) | 102 |
| Jatuh tempo 7 hari ke depan | 23 |

Setelah server live berjalan, angka-angka ini otomatis digantikan data real
time dari ClickUp — snapshot hanya dipakai sebagai fallback bila API belum
terhubung.
