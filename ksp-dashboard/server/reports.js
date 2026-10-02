/**
 * Riwayat Rekap Laporan — setiap ekspor (PDF/JPG) dari Studio Rekap disimpan:
 * metadata + pengaturan (SQLite reports.db) dan berkasnya (folder reports/),
 * di direktori data yang sama dengan auth.db (volume persisten di Docker).
 *
 * Alur ekspor dari browser:
 *   1. POST   /api/reports            → catat metadata, terima nomor dokumen
 *   2. PUT    /api/reports/:id/file   → unggah PDF/JPG (hanya pembuat, ≤15 menit)
 *   3. PUT    /api/reports/:id/thumb  → unggah thumbnail halaman 1
 * Tinjau:  GET list/detail/file/thumb · PATCH review (semua user login) · DELETE (admin)
 */
import express from 'express';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KINDS = { pdf: { ext: 'pdf', type: 'application/pdf' }, jpg: { ext: 'jpg', type: 'image/jpeg' } };
const PERIODS = new Set(['week', 'next', '2w', 'month', 'custom']);
const REVIEW = new Set(['pending', 'approved', 'revision']);
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;
const ID_RE = /^[a-f0-9]{24}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

export function reportsRouter({ requireAuth, requireAdmin, dataDir }) {
  const dir = path.join(dataDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dataDir, 'reports.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS report (
    id TEXT PRIMARY KEY, docNo TEXT NOT NULL, ym TEXT NOT NULL, seq INTEGER NOT NULL,
    kind TEXT NOT NULL, title TEXT, periodType TEXT, periodLabel TEXT, periodFrom INTEGER, periodUntil INTEGER,
    scope TEXT, sections TEXT, theme TEXT, orient TEXT, config TEXT,
    pages INTEGER, size INTEGER, hasFile INTEGER NOT NULL DEFAULT 0, hasThumb INTEGER NOT NULL DEFAULT 0,
    createdBy TEXT, createdByName TEXT, createdAt INTEGER NOT NULL,
    reviewStatus TEXT NOT NULL DEFAULT 'pending', reviewNote TEXT, reviewedBy TEXT, reviewedAt INTEGER);
    CREATE INDEX IF NOT EXISTS report_created ON report (createdAt);
    CREATE UNIQUE INDEX IF NOT EXISTS report_docno ON report (docNo);`);

  const fileOf = (r, thumb) => path.join(dir, r.id + (thumb ? '.thumb.jpg' : '.' + KINDS[r.kind].ext));
  const pub = r => ({
    id: r.id, docNo: r.docNo, kind: r.kind, title: r.title, periodType: r.periodType, periodLabel: r.periodLabel,
    periodFrom: r.periodFrom, periodUntil: r.periodUntil, scope: JSON.parse(r.scope || '[]'), sections: JSON.parse(r.sections || '[]'),
    theme: r.theme, orient: r.orient, pages: r.pages, size: r.size, hasThumb: !!r.hasThumb,
    createdBy: r.createdBy, createdByName: r.createdByName, createdAt: r.createdAt,
    reviewStatus: r.reviewStatus, reviewNote: r.reviewNote, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt,
  });
  const byId = id => (ID_RE.test(id) ? db.prepare('SELECT * FROM report WHERE id = ?').get(id) : null);

  // Entri yang tidak pernah selesai diunggah (tab ditutup di tengah ekspor) dibersihkan.
  function sweep() {
    const old = db.prepare('SELECT * FROM report WHERE hasFile = 0 AND createdAt < ?').all(Date.now() - UPLOAD_WINDOW_MS);
    for (const r of old) { for (const t of [false, true]) fs.rm(fileOf(r, t), { force: true }, () => {}); db.prepare('DELETE FROM report WHERE id = ?').run(r.id); }
  }
  sweep(); setInterval(sweep, 30 * 60 * 1000).unref();

  const nextNo = db.transaction(now => {
    const d = new Date(now + 7 * 3600 * 1000); // WIB
    const ym = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const seq = (db.prepare('SELECT MAX(seq) m FROM report WHERE ym = ?').get(ym).m || 0) + 1;
    return { ym, seq, docNo: `RKP/KSP/${ym}/${String(seq).padStart(4, '0')}` };
  });

  const r = express.Router();
  r.use(requireAuth);

  r.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM report WHERE hasFile = 1 ORDER BY createdAt DESC LIMIT 1000').all();
    res.json(rows.map(pub));
  });

  r.get('/:id', (req, res) => {
    const row = byId(req.params.id);
    if (!row || !row.hasFile) return res.status(404).json({ error: 'Laporan tidak ditemukan.' });
    let config = null; try { config = JSON.parse(row.config || 'null'); } catch {}
    res.json({ ...pub(row), config });
  });

  // 1) catat ekspor baru → nomor dokumen
  r.post('/', express.json({ limit: '64kb' }), (req, res) => {
    const b = req.body || {};
    if (!KINDS[b.kind]) return res.status(400).json({ error: 'Format tidak dikenal.' });
    const config = b.config && typeof b.config === 'object' ? JSON.stringify(b.config) : null;
    if (config && config.length > 32000) return res.status(400).json({ error: 'Pengaturan terlalu besar.' });
    const now = Date.now(), id = crypto.randomBytes(12).toString('hex');
    const arr = (v, n) => JSON.stringify((Array.isArray(v) ? v : []).slice(0, 60).map(x => str(String(x), n)));
    const { ym, seq, docNo } = nextNo(now);
    db.prepare(`INSERT INTO report (id, docNo, ym, seq, kind, title, periodType, periodLabel, periodFrom, periodUntil,
      scope, sections, theme, orient, config, createdBy, createdByName, createdAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, docNo, ym, seq, b.kind, str(b.title, 120), PERIODS.has(b.periodType) ? b.periodType : 'custom', str(b.periodLabel, 120),
      int(b.periodFrom), int(b.periodUntil), arr(b.scope, 120), arr(b.sections, 30), str(b.theme, 20), str(b.orient, 10),
      config, req.user.email, req.user.name || req.user.email, now);
    res.json({ id, docNo, createdAt: now });
  });

  // 2–3) unggah berkas & thumbnail — hanya pembuat, sekali, dalam jendela waktu
  function guardUpload(req, res, field) {
    const row = byId(req.params.id);
    if (!row) { res.status(404).json({ error: 'Laporan tidak ditemukan.' }); return null; }
    if (row.createdBy !== req.user.email || Date.now() - row.createdAt > UPLOAD_WINDOW_MS || row[field]) {
      res.status(409).json({ error: 'Unggahan tidak diizinkan untuk entri ini.' }); return null;
    }
    return row;
  }
  const raw = limit => express.raw({ type: ['application/pdf', 'image/jpeg'], limit });
  const isPdf = b => b.length > 4 && b.subarray(0, 4).toString() === '%PDF';
  const isJpg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

  r.put('/:id/file', raw('40mb'), (req, res) => {
    const row = guardUpload(req, res, 'hasFile'); if (!row) return;
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !(row.kind === 'pdf' ? isPdf(buf) : isJpg(buf))) return res.status(400).json({ error: 'Berkas tidak valid.' });
    const dest = fileOf(row), tmp = dest + '.tmp';
    fs.writeFileSync(tmp, buf); fs.renameSync(tmp, dest);
    db.prepare('UPDATE report SET hasFile = 1, size = ?, pages = ? WHERE id = ?').run(buf.length, Math.max(1, Math.min(500, int(req.get('X-Pages')) || 1)), row.id);
    res.json({ ok: true });
  });

  r.put('/:id/thumb', raw('1mb'), (req, res) => {
    const row = guardUpload(req, res, 'hasThumb'); if (!row) return;
    if (!Buffer.isBuffer(req.body) || !isJpg(req.body)) return res.status(400).json({ error: 'Thumbnail tidak valid.' });
    fs.writeFileSync(fileOf(row, true), req.body);
    db.prepare('UPDATE report SET hasThumb = 1 WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  r.get('/:id/file', (req, res) => {
    const row = byId(req.params.id);
    if (!row || !row.hasFile) return res.status(404).send('Tidak ditemukan');
    const name = `${row.docNo.replace(/\//g, '-')}_${(row.periodLabel || '').replace(/[^\p{L}\p{N} _.-]+/gu, '').replace(/\s+/g, '-')}.${KINDS[row.kind].ext}`;
    res.set({ 'Content-Type': KINDS[row.kind].type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    if (req.query.download) res.attachment(name); else res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    fs.createReadStream(fileOf(row)).on('error', () => res.status(404).end()).pipe(res);
  });

  r.get('/:id/thumb', (req, res) => {
    const row = byId(req.params.id);
    if (!row || !row.hasThumb) return res.status(404).end();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
    fs.createReadStream(fileOf(row, true)).on('error', () => res.status(404).end()).pipe(res);
  });

  // Tinjauan internal: semua user login (pimpinan/viewer pun bisa menyetujui).
  r.patch('/:id/review', express.json({ limit: '16kb' }), (req, res) => {
    const row = byId(req.params.id);
    if (!row || !row.hasFile) return res.status(404).json({ error: 'Laporan tidak ditemukan.' });
    const status = req.body?.status;
    if (!REVIEW.has(status)) return res.status(400).json({ error: 'Status tinjauan tidak valid.' });
    const note = str(req.body?.note, 2000);
    const pending = status === 'pending';
    db.prepare('UPDATE report SET reviewStatus = ?, reviewNote = ?, reviewedBy = ?, reviewedAt = ? WHERE id = ?')
      .run(status, note || null, pending ? null : (req.user.name || req.user.email), pending ? null : Date.now(), row.id);
    res.json(pub(byId(row.id)));
  });

  r.delete('/:id', requireAdmin, (req, res) => {
    const row = byId(req.params.id);
    if (!row) return res.status(404).json({ error: 'Laporan tidak ditemukan.' });
    for (const t of [false, true]) fs.rmSync(fileOf(row, t), { force: true });
    db.prepare('DELETE FROM report WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  return r;
}
