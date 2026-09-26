/**
 * Traffic Pekerjaan KSP — backend Express + Better Auth
 * -----------------------------------------------------
 * - Login single-admin via Better Auth (SQLite). Registrasi publik diblokir.
 * - Dashboard (index.html) & endpoint /api/dashboard-data dikunci di balik sesi login.
 * - Menarik data tugas live dari ClickUp API (workspace AIO-KSP), cache berkala.
 *
 * Menjalankan pertama kali:
 *   1. cp .env.example .env    lalu isi CLICKUP_TOKEN, BETTER_AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
 *   2. npm install
 *   3. npx @better-auth/cli migrate   (buat tabel auth di SQLite)
 *   4. node seed-admin.js             (buat akun admin KSP — sekali saja)
 *   5. npm start
 */
import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, '..', 'public');

const app = express();
// Berjalan di belakang reverse proxy (Caddy/cloudflared/Nginx) di VPS —
// agar req.secure & cookie sesi benar saat akses via HTTPS.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN || '';
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID || '901817330442';
// Interval refresh cache dari ClickUp. REFRESH_SECONDS diprioritaskan (floor 10 dtk
// utk lindungi rate-limit ClickUp). Untuk update INSTAN 1-3 dtk, pakai webhook.
const REFRESH_MS = process.env.REFRESH_SECONDS
  ? Math.max(10, Number(process.env.REFRESH_SECONDS)) * 1000
  : Number(process.env.REFRESH_MINUTES || 5) * 60 * 1000;
const WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET || '';
// Sumber tunggal progres proyek (panel Progress Launch). Default: PROGRESS.md
// di folder induk ksp-dashboard/. Di Docker di-override lewat PROGRESS_FILE.
const PROGRESS_FILE = process.env.PROGRESS_FILE || path.join(__dirname, '..', '..', 'PROGRESS.md');

/* ---------- SSE (real-time push ke browser) ---------- */
const sseClients = new Set();
function broadcast(event) {
  for (const c of sseClients) {
    try { c.write(`event: ${event}\ndata: {}\n\n`); } catch (e) { /* client pergi */ }
  }
}

/* ---------------- AUTH WIRING (urutan penting) ---------------- */

// Rate-limit percobaan login (5 gagal / 15 menit per IP).
const SIGNIN_MAX_TRIES = 5;
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const signInTries = new Map(); // ip -> { count, resetAt }

function trackSignIn(req, res, next) {
  if (!req._signInTrack) return next();
  res.on('finish', () => {
    const w = req._signInTrack;
    if (res.statusCode >= 200 && res.statusCode < 400) w.count = 0; // sukses → reset
    else w.count += 1;                                              // gagal → +1
  });
  next();
}

function rateLimitSignIn(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
  const now = Date.now();
  let w = signInTries.get(ip);
  if (!w || w.resetAt < now) { w = { count: 0, resetAt: now + SIGNIN_WINDOW_MS }; signInTries.set(ip, w); }
  if (w.count >= SIGNIN_MAX_TRIES) {
    return res.status(429).json({ error: 'Rate limited', message: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((w.resetAt - now) / 1000)} detik.` });
  }
  req._signInTrack = w;
  next();
}

// 1) Blokir registrasi publik — hanya akun hasil seed-admin.js yang boleh ada.
app.all(/^\/api\/auth\/sign-up/, (req, res) =>
  res.status(403).json({ error: 'Registrasi publik dinonaktifkan.' }));

// 2) Handler Better Auth (harus SEBELUM express.json()).
//    Login menempuh rate-limit khusus; endpoint auth lain tetap normal.
app.post('/api/auth/sign-in/email', rateLimitSignIn, trackSignIn, toNodeHandler(auth));
app.all(/^\/api\/auth\/sign-in\/(?!email)/, toNodeHandler(auth));
app.all(/^\/api\/auth\//, toNodeHandler(auth));

// 3) Webhook ClickUp — butuh body MENTAH untuk verifikasi tanda tangan (sebelum express.json()).
app.post('/api/clickup-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  if (WEBHOOK_SECRET) {
    const sig = req.get('X-Signature') || '';
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.body).digest('hex');
    if (sig !== expected) return res.status(401).send('invalid signature');
  }
  res.sendStatus(200); // balas cepat ke ClickUp
  await refreshCache();
  broadcast('update'); // dorong ke semua browser yang terbuka
});

// 4) Body parser untuk route selanjutnya.
app.use(express.json());

// Guard sesi.
async function requireAuth(req, res, next) {
  try {
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!s) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
      return res.redirect('/login.html');
    }
    req.user = s.user;
    next();
  } catch (e) {
    console.error('[auth] error:', e.message);
    res.status(500).json({ error: 'auth error' });
  }
}

// Guard admin.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Butuh hak admin.' });
  next();
}

/* ---------------- CLICKUP SYNC ---------------- */

let cache = { data: null, fetchedAt: 0 };

async function clickupFetchAllTasks(listId) {
  if (!CLICKUP_TOKEN) throw new Error('CLICKUP_TOKEN belum diisi di .env');
  const tasks = [];
  let page = 0;
  for (;;) {
    const url = `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&order_by=updated&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: CLICKUP_TOKEN } });
    if (!res.ok) throw new Error(`ClickUp API error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    tasks.push(...json.tasks);
    if (json.tasks.length < 100) break; // halaman pendek = selesai
    page += 1;
    if (page > 20) break;
  }
  return tasks;
}

function isoWeekStart(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildDashboardData(tasks, listName) {
  const now = Date.now();
  const total = tasks.length;
  const complete = tasks.filter(t => t.status?.status?.toLowerCase() === 'complete').length;
  const inProgress = tasks.filter(t => t.status?.status?.toLowerCase() === 'in progress').length;
  const todo = total - complete - inProgress;

  const openTasks = tasks.filter(t => t.status?.status?.toLowerCase() !== 'complete');
  const overdue = openTasks.filter(t => t.due_date && Number(t.due_date) <= now).length;
  const sevenDays = now + 7 * 24 * 3600 * 1000;
  const dueNext7d = openTasks.filter(t => t.due_date && Number(t.due_date) > now && Number(t.due_date) <= sevenDays).length;

  // Tren mingguan (13 minggu terakhir)
  const weeks = [];
  const start = isoWeekStart(now - 12 * 7 * 24 * 3600 * 1000);
  for (let i = 0; i < 13; i++) {
    const wStart = new Date(start); wStart.setDate(wStart.getDate() + i * 7);
    const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 7);
    const label = wStart.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    const updates = tasks.filter(t => { const u = Number(t.date_updated); return u >= wStart.getTime() && u < wEnd.getTime(); }).length;
    const done = tasks.filter(t => { const c = Number(t.date_closed); return c && c >= wStart.getTime() && c < wEnd.getTime(); }).length;
    weeks.push({ w: label, updates, done });
  }

  // Heatmap: update per hari (Sen..Ahad) x blok 3 jam (8 kolom), WIB (UTC+7)
  const heat = Array.from({ length: 7 }, () => new Array(8).fill(0));
  for (const t of tasks) {
    const u = Number(t.date_updated);
    if (!u) continue;
    const wib = new Date(u + 7 * 3600 * 1000);
    const dow = (wib.getUTCDay() + 6) % 7;
    const block = Math.floor(wib.getUTCHours() / 3);
    heat[dow][block] += 1;
  }

  // Beban per workstream: tag pertama, atau teks sebelum ":" di judul
  const groups = {};
  for (const t of tasks) {
    let key = (t.tags && t.tags[0]?.name) || (t.name.includes(':') ? t.name.split(':')[0].trim() : null) || 'Lainnya';
    key = key.slice(0, 40);
    groups[key] = (groups[key] || 0) + 1;
  }
  const workstreams = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));
  const topSum = workstreams.reduce((s, w) => s + w.count, 0);
  if (total - topSum > 0) workstreams.push({ name: 'Lainnya', count: total - topSum });

  const wsOf = t => ((t.tags && t.tags[0]?.name) || (t.name.includes(':') ? t.name.split(':')[0].trim() : 'Lainnya')).slice(0, 40);
  const statusOf = t => {
    const s = t.status?.status?.toLowerCase();
    if (s === 'complete') return 'done';
    if (s === 'in progress') return 'progress';
    if (t.due_date && Number(t.due_date) <= now) return 'overdue';
    return 'todo';
  };
  const relTime = ms => {
    const mins = Math.round((now - ms) / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins} menit lalu`;
    if (mins < 1440) return `${Math.round(mins / 60)} jam lalu`;
    return `${Math.round(mins / 1440)} hari lalu`;
  };

  const recent = tasks.slice(0, 12).map(t => ({
    cat: wsOf(t), name: t.name, status: t.status?.status?.toLowerCase() === 'complete' ? 'done'
      : t.status?.status?.toLowerCase() === 'in progress' ? 'progress' : 'todo',
    time: relTime(Number(t.date_updated)), url: t.url,
  }));

  // Daftar tugas lengkap (ringkas) — dipakai kartu statistik yang bisa diklik,
  // filter per-workstream di sidebar, dan pencarian global spesifik.
  const tasksList = tasks.map(t => {
    const due = Number(t.due_date) || null;
    const st = statusOf(t);
    const done = t.status?.status?.toLowerCase() === 'complete';
    return {
      id: t.id, name: t.name, ws: wsOf(t), status: st, url: t.url,
      due, overdue: !!(due && !done && due <= now),
      dueSoon: !!(due && !done && due > now && due <= sevenDays),
      updated: Number(t.date_updated) || null, time: relTime(Number(t.date_updated)),
    };
  });

  // Graph ala Obsidian: root -> workstream -> task
  const gnodes = [{ id: 'root', label: 'AIO-KSP', type: 'root' }];
  const gseen = new Set();
  const glinks = [];
  for (const t of tasks) {
    const ws = wsOf(t), wsId = 'ws:' + ws;
    if (!gseen.has(wsId)) { gseen.add(wsId); gnodes.push({ id: wsId, label: ws, type: 'ws' }); glinks.push({ source: 'root', target: wsId }); }
    gnodes.push({ id: t.id, label: t.name, type: 'task', ws: wsId, status: statusOf(t), url: t.url });
    glinks.push({ source: wsId, target: t.id });
  }
  const graph = { nodes: gnodes, links: glinks };

  // Notifikasi: terlambat, jatuh tempo ≤7 hari, selesai baru, tugas baru
  const notifications = [];
  for (const t of tasks) {
    const s = t.status?.status?.toLowerCase();
    const due = Number(t.due_date), created = Number(t.date_created), closed = Number(t.date_closed), updated = Number(t.date_updated);
    if (s !== 'complete' && due && due <= now) notifications.push({ type: 'overdue', title: t.name, cat: wsOf(t), ts: updated || due, url: t.url });
    else if (s !== 'complete' && due && due > now && due <= sevenDays) notifications.push({ type: 'due', title: t.name, cat: wsOf(t), ts: due, url: t.url });
    if (s === 'complete' && closed && now - closed < 3 * 864e5) notifications.push({ type: 'done', title: t.name, cat: wsOf(t), ts: closed, url: t.url });
    if (created && now - created < 3 * 864e5) notifications.push({ type: 'new', title: t.name, cat: wsOf(t), ts: created, url: t.url });
  }
  notifications.sort((a, b) => b.ts - a.ts);

  return {
    generatedAt: new Date(now).toISOString(),
    workspace: 'AIO-KSP', list: listName || 'List',
    totals: { total, complete, inProgress, todo, overdue, dueNext7d },
    weekly: weeks, heat, workstreams, recent, graph, tasks: tasksList,
    notifications: notifications.slice(0, 30),
  };
}

async function refreshCache() {
  try {
    const tasks = await clickupFetchAllTasks(CLICKUP_LIST_ID);
    const next = buildDashboardData(tasks, 'List');
    const changed = !cache.data || cache.data.totals.total !== next.totals.total
      || JSON.stringify(cache.data.recent) !== JSON.stringify(next.recent)
      || JSON.stringify(cache.data.notifications) !== JSON.stringify(next.notifications);
    const ts = Date.now();
    next.v = ts;                       // stempel versi (dipakai /api/version & browser)
    cache = { data: next, fetchedAt: ts };
    console.log(`[ksp-dashboard] cache refreshed: ${tasks.length} tugas @ ${new Date().toISOString()}`);
    if (changed) broadcast('update'); // dorong perubahan ke browser
  } catch (err) {
    console.error('[ksp-dashboard] gagal refresh dari ClickUp:', err.message);
  }
}

/* ---------------- ROUTES ---------------- */

// Publik: halaman login.
app.get('/login.html', (req, res) => res.sendFile(path.join(PUB, 'login.html')));

// Data dashboard — DIKUNCI.
app.get('/api/dashboard-data', requireAuth, async (req, res) => {
  if (!cache.data || Date.now() - cache.fetchedAt > REFRESH_MS) await refreshCache();
  if (!cache.data) return res.status(503).json({ error: 'Data belum tersedia, cek CLICKUP_TOKEN di .env' });
  res.json(cache.data);
});

// Info user login (untuk sambutan + role di dashboard).
app.get('/api/me', requireAuth, (req, res) =>
  res.json({ email: req.user.email, name: req.user.name, role: req.user.role || 'viewer' }));

// Cek versi data — MURAH (tanpa panggil ClickUp). Browser poll ini tiap 3 detik.
app.get('/api/version', requireAuth, (req, res) => res.json({ v: cache.fetchedAt }));

// Stream real-time (Server-Sent Events) — DIKUNCI.
app.get('/api/stream', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write(': connected\n\n');
  sseClients.add(res);
  const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(ka); sseClients.delete(res); });
});

/* ---------- ADMIN API (role admin saja) ---------- */
// Daftar akun.
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const out = await auth.api.listUsers({ query: { limit: 200 }, headers: fromNodeHeaders(req.headers) });
    const users = (out.users || out || []).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role || 'viewer' }));
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Buat akun baru (Admin membuat akun untuk atasan/viewer atau admin lain).
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !password || password.length < 8) return res.status(400).json({ error: 'Email & kata sandi (min. 8) wajib diisi.' });
  try {
    await auth.api.createUser({
      body: { email, password, name: name || email, role: role === 'admin' ? 'admin' : 'viewer' },
      headers: fromNodeHeaders(req.headers),
    });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message || 'Gagal membuat akun.' }); }
});

// Ubah role.
app.patch('/api/admin/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
  const role = req.body?.role === 'admin' ? 'admin' : 'viewer';
  try {
    await auth.api.setRole({ body: { userId: req.params.id, role }, headers: fromNodeHeaders(req.headers) });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Hapus akun.
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Tidak dapat menghapus akun sendiri.' });
  try {
    await auth.api.removeUser({ body: { userId: req.params.id }, headers: fromNodeHeaders(req.headers) });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/health', (req, res) => res.json({ ok: true, cachedAt: cache.fetchedAt, clients: sseClients.size }));

// Progres proyek dibaca langsung dari PROGRESS.md (sumber tunggal).
// Panel "Progress Launch" di index.html memakai endpoint ini.
function parseProgressMd(md) {
  const stages = [];
  const re = /^\|\s*(\d+)\s*\|(.+?)\|(.+?)\|(.*?)\|\s*$/;
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const statusRaw = m[3].trim();
    let statusKey = 'pending';
    if (/selesai|done|✅/i.test(statusRaw)) statusKey = 'done';
    else if (/berjalan|proses|progress|🔄/i.test(statusRaw)) statusKey = 'ongoing';
    else if (/tunda|belum|pending|⏳/i.test(statusRaw)) statusKey = 'pending';
    stages.push({
      no: Number(m[1]),
      stage: m[2].trim().replace(/`/g, ''),
      status: statusRaw,
      statusKey,
      note: m[4].trim().replace(/`/g, ''),
    });
  }
  return stages;
}

app.get('/api/progress', requireAuth, async (req, res) => {
  try {
    const md = await fs.promises.readFile(PROGRESS_FILE, 'utf8');
    const stages = parseProgressMd(md);
    const stat = await fs.promises.stat(PROGRESS_FILE).catch(() => null);
    const summary = {
      total: stages.length,
      done: stages.filter(s => s.statusKey === 'done').length,
      ongoing: stages.filter(s => s.statusKey === 'ongoing').length,
      pending: stages.filter(s => s.statusKey === 'pending').length,
    };
    res.json({
      updatedAt: stat ? stat.mtime.toISOString() : new Date().toISOString(),
      source: PROGRESS_FILE,
      summary,
      stages,
    });
  } catch (err) {
    res.status(404).json({ error: `PROGRESS.md tidak terbaca: ${err.message}` });
  }
});

// Halaman dashboard — DIKUNCI.
app.get(['/', '/index.html'], requireAuth, (req, res) => res.sendFile(path.join(PUB, 'index.html')));

// Aset statis lain (tanpa index otomatis, agar index.html tidak lolos guard).
app.use(express.static(PUB, { index: false }));

app.listen(PORT, () => {
  console.log(`[ksp-dashboard] server berjalan di http://localhost:${PORT}`);
  refreshCache();
  setInterval(refreshCache, REFRESH_MS);
});
