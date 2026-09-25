/**
 * Traffic Pekerjaan KSP — backend sinkronisasi ClickUp
 * -----------------------------------------------------
 * Server Express ringan untuk di-deploy di VPS KSP.
 * - Menarik data tugas dari ClickUp API (workspace AIO-KSP)
 *   menggunakan personal API token.
 * - Menghitung agregat (status, overdue, tren mingguan,
 *   beban per workstream, aktivitas terbaru).
 * - Menyajikan hasilnya di endpoint GET /api/dashboard-data,
 *   yang otomatis dipakai oleh public/index.html jika tersedia.
 * - Cache in-memory dengan refresh berkala (default 5 menit)
 *   agar tidak membebani rate limit ClickUp API.
 *
 * Menjalankan:
 *   1. cp .env.example .env   lalu isi CLICKUP_TOKEN & CLICKUP_LIST_ID
 *   2. npm install
 *   3. npm start               (default port 3000)
 *
 * Deploy di VPS (mengikuti pola Docker yang sudah dipakai KSP
 * untuk SIPRES/SIM-HR): lihat README.md di folder ini.
 */

const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN || '';
const CLICKUP_LIST_ID = process.env.CLICKUP_LIST_ID || '901817330442'; // list "List" di space AIO-KSP
const REFRESH_MS = Number(process.env.REFRESH_MINUTES || 5) * 60 * 1000;
const RETRY_MS = 30 * 1000; // jeda minimum antar percobaan saat gagal, cegah hammer API

// Berjalan di belakang reverse proxy (Caddy/Nginx) di VPS
app.set('trust proxy', 1);

// Header keamanan dasar. X-Frame-Options sengaja tidak di-set agar dashboard
// tetap bisa disematkan sebagai iframe di landing page KSP.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

let cache = { data: null, fetchedAt: 0 };
let lastAttempt = 0;

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
    // ClickUp v2 returns up to 100 tasks/page; a short page means we're done.
    if (json.tasks.length < 100) break;
    page += 1;
    if (page > 20) break; // safety cap
  }
  return tasks;
}

function isoWeekStart(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0
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

  // Weekly activity trend (last 13 weeks) from date_updated / date_closed
  const weeks = [];
  const start = isoWeekStart(now - 12 * 7 * 24 * 3600 * 1000);
  for (let i = 0; i < 13; i++) {
    const wStart = new Date(start);
    wStart.setDate(wStart.getDate() + i * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wEnd.getDate() + 7);
    const label = wStart.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    const updates = tasks.filter(t => {
      const u = Number(t.date_updated);
      return u >= wStart.getTime() && u < wEnd.getTime();
    }).length;
    const done = tasks.filter(t => {
      const c = Number(t.date_closed);
      return c && c >= wStart.getTime() && c < wEnd.getTime();
    }).length;
    weeks.push({ w: label, updates, done });
  }

  // Weekly heatmap: updates by day-of-week (Mon..Sun) x 3-hour block (8 cols), WIB (UTC+7)
  const heat = Array.from({ length: 7 }, () => new Array(8).fill(0));
  for (const t of tasks) {
    const u = Number(t.date_updated);
    if (!u) continue;
    const wib = new Date(u + 7 * 3600 * 1000); // shift to WIB, then read UTC fields
    const dow = (wib.getUTCDay() + 6) % 7;      // Mon=0 .. Sun=6
    const block = Math.floor(wib.getUTCHours() / 3); // 0..7
    heat[dow][block] += 1;
  }

  // Workstream grouping: use text before " : " or first tag, fallback "Lainnya"
  const groups = {};
  for (const t of tasks) {
    let key = (t.tags && t.tags[0]?.name) || (t.name.includes(':') ? t.name.split(':')[0].trim() : null) || 'Lainnya';
    key = key.slice(0, 40);
    groups[key] = (groups[key] || 0) + 1;
  }
  const workstreams = Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count })); // colors assigned by the frontend
  const topSum = workstreams.reduce((s, w) => s + w.count, 0);
  if (total - topSum > 0) workstreams.push({ name: 'Lainnya', count: total - topSum });

  const recent = tasks.slice(0, 12).map(t => {
    const status = t.status?.status?.toLowerCase() === 'complete' ? 'done'
      : t.status?.status?.toLowerCase() === 'in progress' ? 'progress' : 'todo';
    const mins = Math.round((now - Number(t.date_updated)) / 60000);
    let time;
    if (mins < 60) time = `${mins} menit lalu`;
    else if (mins < 1440) time = `${Math.round(mins / 60)} jam lalu`;
    else time = `${Math.round(mins / 1440)} hari lalu`;
    const cat = (t.tags && t.tags[0]?.name) || (t.name.includes(':') ? t.name.split(':')[0].trim() : 'Umum');
    return { cat, name: t.name, status, time, url: t.url };
  });

  return {
    generatedAt: new Date(now).toISOString(),
    workspace: 'AIO-KSP',
    list: listName || 'List',
    totals: { total, complete, inProgress, todo, overdue, dueNext7d },
    weekly: weeks,
    heat,
    workstreams,
    recent,
  };
}

async function refreshCache() {
  lastAttempt = Date.now();
  try {
    const tasks = await clickupFetchAllTasks(CLICKUP_LIST_ID);
    cache = { data: buildDashboardData(tasks, 'List'), fetchedAt: Date.now() };
    console.log(`[ksp-dashboard] cache refreshed: ${tasks.length} tugas @ ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[ksp-dashboard] gagal refresh dari ClickUp:', err.message);
  }
}

app.get('/api/dashboard-data', async (req, res) => {
  const stale = !cache.data || Date.now() - cache.fetchedAt > REFRESH_MS;
  const canRetry = Date.now() - lastAttempt > RETRY_MS;
  if (stale && canRetry) {
    await refreshCache();
  }
  if (!cache.data) return res.status(503).json({ error: 'Data belum tersedia, cek CLICKUP_TOKEN di .env' });
  res.json(cache.data);
});

app.get('/api/health', (req, res) => res.json({ ok: true, cachedAt: cache.fetchedAt }));

app.listen(PORT, () => {
  console.log(`[ksp-dashboard] server berjalan di http://localhost:${PORT}`);
  refreshCache();
  setInterval(refreshCache, REFRESH_MS);
});
