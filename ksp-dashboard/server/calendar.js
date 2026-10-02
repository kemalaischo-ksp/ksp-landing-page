/**
 * Kalender KSP — agenda manual tim KSP (terpisah dari kalender HR).
 * Kaldik AL-WILDAN (public/kaldik.js) & jatuh tempo tugas ClickUp dihitung di browser;
 * di sini hanya agenda manual. Lihat: semua user login · Tambah/ubah/hapus: admin.
 * Disimpan di calendar.db, satu folder dengan auth.db (volume persisten di Docker).
 */
import express from 'express';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';

const KATEGORI = new Set(['agenda', 'rapat', 'deadline', 'libur', 'ujian', 'kaldik']);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const toUI = r => ({
  id: r.id, d: r.tgl, end: r.tglAkhir || null, jam: r.jam || '', t: r.judul, k: r.kategori,
  note: r.catatan || '', by: r.createdBy || '', byNama: r.byNama || '', createdAt: r.createdAt, updatedAt: r.updatedAt,
});

function clean(b, partial) {
  const o = {};
  if (!partial || b.t !== undefined) {
    const t = String(b.t || '').trim().slice(0, 160);
    if (!t) return { err: 'Judul agenda wajib diisi.' };
    o.judul = t;
  }
  if (!partial || b.d !== undefined) {
    if (!isDate(b.d)) return { err: 'Tanggal tidak valid.' };
    o.tgl = b.d;
  }
  if (b.end !== undefined) {
    if (b.end && !isDate(b.end)) return { err: 'Tanggal akhir tidak valid.' };
    o.tglAkhir = b.end || null;
  }
  if (b.jam !== undefined) {
    if (b.jam && !isTime(b.jam)) return { err: 'Jam tidak valid (HH:MM).' };
    o.jam = b.jam || null;
  }
  if (b.k !== undefined || !partial) o.kategori = KATEGORI.has(b.k) ? b.k : 'agenda';
  if (b.note !== undefined) o.catatan = String(b.note || '').slice(0, 1000) || null;
  return { o };
}

export function calendarRouter({ requireAuth, requireAdmin, dataDir }) {
  const db = new Database(path.join(dataDir, 'calendar.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS event (
    id TEXT PRIMARY KEY, tgl TEXT NOT NULL, tglAkhir TEXT, jam TEXT, judul TEXT NOT NULL,
    kategori TEXT NOT NULL DEFAULT 'agenda', catatan TEXT,
    createdBy TEXT, byNama TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS event_tgl ON event (tgl);`);
  const byId = id => db.prepare('SELECT * FROM event WHERE id = ?').get(String(id).slice(0, 40));

  const r = express.Router();
  r.use(requireAuth);

  r.get('/', (req, res) => {
    res.json({ events: db.prepare('SELECT * FROM event ORDER BY tgl, jam, createdAt').all().map(toUI) });
  });

  r.post('/', requireAdmin, express.json({ limit: '16kb' }), (req, res) => {
    const { o, err } = clean(req.body || {}, false);
    if (err) return res.status(400).json({ error: err });
    if (o.tglAkhir && o.tglAkhir < o.tgl) return res.status(400).json({ error: 'Tanggal akhir sebelum tanggal mulai.' });
    const now = Date.now(), id = 'ev' + crypto.randomBytes(9).toString('hex');
    db.prepare(`INSERT INTO event (id, tgl, tglAkhir, jam, judul, kategori, catatan, createdBy, byNama, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, o.tgl, o.tglAkhir || null, o.jam || null, o.judul, o.kategori, o.catatan || null,
      req.user.email, req.user.name || req.user.email, now, now);
    res.json({ ok: true, event: toUI(byId(id)) });
  });

  r.patch('/:id', requireAdmin, express.json({ limit: '16kb' }), (req, res) => {
    const ev = byId(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Agenda tidak ditemukan.' });
    const { o, err } = clean(req.body || {}, true);
    if (err) return res.status(400).json({ error: err });
    const m = { ...ev, ...o };
    if (m.tglAkhir && m.tglAkhir < m.tgl) return res.status(400).json({ error: 'Tanggal akhir sebelum tanggal mulai.' });
    db.prepare('UPDATE event SET tgl=?, tglAkhir=?, jam=?, judul=?, kategori=?, catatan=?, updatedAt=? WHERE id=?')
      .run(m.tgl, m.tglAkhir || null, m.jam || null, m.judul, m.kategori, m.catatan || null, Date.now(), ev.id);
    res.json({ ok: true, event: toUI(byId(ev.id)) });
  });

  r.delete('/:id', requireAdmin, (req, res) => {
    const ev = byId(req.params.id);
    if (!ev) return res.status(404).json({ error: 'Agenda tidak ditemukan.' });
    db.prepare('DELETE FROM event WHERE id = ?').run(ev.id);
    res.json({ ok: true });
  });

  return r;
}
