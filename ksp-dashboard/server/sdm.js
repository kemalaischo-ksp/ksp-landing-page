/**
 * Panel SDM — ringkasan data karyawan dari database aplikasi HR (hr.office-alwildan.id).
 *
 * KSP TIDAK membaca tabel karyawan HR. Akun database `ksp_reader` hanya bisa SELECT
 * dua view di skema `ksp_ro` (lihat server/sql/hr_ksp_ro.sql):
 *   - ksp_ro.karyawan     : nama, unit, jabatan, posisi, gender, tahun aktif + flag kelengkapan (ya/tidak)
 *   - ksp_ro.gaji_ringkas : total & rata-rata THP saja (tanpa gaji per orang)
 * Rumus agregat mengikuti Dashboard HR (sdm-v31) agar angkanya sama.
 *
 * GET /api/sdm/summary  → agregat (cache 5 menit) · admin
 * GET /api/sdm/people   → daftar nama + unit + jabatan untuk satu filter (drill-down) · admin
 * Live: tiap 30 dtk dicek sidik jari ringan (jumlah + waktu ubah terakhir); bila berubah,
 *       cache dibuang & event SSE "sdm" dikirim → panel yang terbuka memuat ulang sendiri.
 * Butuh env HR_DB_URL=postgres://ksp_reader:***@hr30-db:5432/hr30_v31
 */
import express from 'express';
import pg from 'pg';

const CACHE_MS = 5 * 60 * 1000;
const WATCH_MS = 30 * 1000;

// Sama dengan roleGroup() di Dashboard HR
function roleGroup(e) {
  const j = (e.jabatan || '').toLowerCase(), p = (e.posisi || '').toLowerCase();
  if (j.includes('guru') || p.includes('guru')) return 'Guru';
  if (['itba', 'musyrif', 'muhafiz', 'native'].some(k => j.includes(k)) || p.includes('musyrif') || p.includes('itba')) return 'Pengasuhan/ITBA';
  if (['security', 'fcs', 'dapur', 'laundry', 'kebun', 'sarpras'].some(k => j.includes(k)) || p.includes('cleaning') || p.includes('cctv')) return 'Support/Sarpras';
  if (['management', 'kepala', 'finance', 'keuangan', 'humas', 'staff'].some(k => j.includes(k)) || ['management', 'finance', 'tata usaha', 'marketing'].some(k => p.includes(k))) return 'Manajemen/Staf';
  return 'Lainnya';
}
const unitSort = (a, b) => {
  const na = +String(a).replace(/\D/g, ''), nb = +String(b).replace(/\D/g, '');
  return (na || 999) - (nb || 999) || String(a).localeCompare(b);
};
const yearOf = e => { const y = String(e.thn_aktif || '').trim(); return /^\d{4}$/.test(y) ? y : null; };
const countBy = (rows, fn) => { const m = new Map(); for (const r of rows) { const k = fn(r); m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };

export function sdmRouter({ requireAuth, requireAdmin, onChange }) {
  const url = process.env.HR_DB_URL;
  const pool = url ? new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, statement_timeout: 8000 }) : null;
  if (pool) pool.on('error', e => console.error('[sdm] pool error:', e.message));
  let cache = { at: 0, rows: null, gaji: null, err: null };
  let inflight = null;

  async function load(force) {
    if (!pool) throw Object.assign(new Error('Panel SDM belum terhubung ke database HR (HR_DB_URL belum diisi).'), { code: 'NOCONF' });
    if (!force && cache.rows && Date.now() - cache.at < CACHE_MS) return cache;
    // banyak panel memuat ulang bersamaan (setelah event live) → cukup satu kueri ke HR
    if (inflight) return inflight;
    inflight = (async () => {
      const [k, g] = await Promise.all([
        pool.query('SELECT * FROM ksp_ro.karyawan'),
        pool.query('SELECT n_valid, total_thp, rata_thp FROM ksp_ro.gaji_ringkas'),
      ]);
      cache = { at: Date.now(), rows: k.rows, gaji: g.rows[0] || { n_valid: 0, total_thp: 0, rata_thp: 0 } };
      return cache;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  // Sidik jari perubahan. Kolom diubah_pada (opsional di view) menangkap edit data;
  // tanpa kolom itu, tetap mendeteksi penambahan/penghapusan lewat jumlah & id terbesar.
  let lastFp = null, fpSql = 'SELECT count(*)::text || \'|\' || coalesce(max(diubah_pada)::text, \'\') AS fp FROM ksp_ro.karyawan';
  async function watch() {
    try {
      let fp;
      try { fp = (await pool.query(fpSql)).rows[0].fp; }
      catch (e) {
        if (!/diubah_pada/.test(e.message)) throw e;
        fpSql = 'SELECT count(*)::text || \'|\' || coalesce(max(id), \'\') AS fp FROM ksp_ro.karyawan';
        fp = (await pool.query(fpSql)).rows[0].fp;
      }
      if (lastFp !== null && fp !== lastFp) {
        cache.at = 0; // buang cache → permintaan berikutnya membaca data baru
        console.log('[sdm] data HR berubah → panel diperbarui');
        if (onChange) onChange();
      }
      lastFp = fp;
    } catch (e) { console.warn('[sdm] cek perubahan gagal:', e.message); }
  }
  if (pool) { watch(); setInterval(watch, WATCH_MS).unref(); }

  function summarize({ rows, gaji, at }) {
    const total = rows.length, nowY = new Date().getFullYear();
    const byUnit = countBy(rows, e => e.unit || '—');
    const byRole = countBy(rows, roleGroup);
    const gender = { pria: 0, perempuan: 0, kosong: 0 };
    for (const e of rows) { if (e.gender === 'Pria') gender.pria++; else if (e.gender === 'Perempuan') gender.perempuan++; else gender.kosong++; }
    const ym = new Map();
    for (const e of rows) { const y = yearOf(e); if (y && +y >= 2013 && +y <= nowY) ym.set(y, (ym.get(y) || 0) + 1); }
    const recruit = [...ym].sort((a, b) => a[0].localeCompare(b[0]));
    const pct = f => rows.filter(r => r[f]).length;
    const completeness = [
      ['ada_nik', 'NIK & Biodata'], ['ada_foto', 'Foto'], ['ada_rekening', 'Rekening'], ['ada_pendidikan', 'Pendidikan'],
      ['ada_email', 'Email'], ['ada_kesehatan', 'Link Form Kesehatan'], ['ada_gaji', 'Data Gaji'], ['menikah', 'Status Menikah'],
    ].map(([f, label]) => ({ key: f, label, n: pct(f) }));
    // Heatmap tahun × cabang: 12 unit terbesar, tahun ≥ 2018 (seperti Dashboard HR)
    const years = recruit.map(r => r[0]).filter(y => +y >= 2018);
    const topUnits = byUnit.slice(0, 12).map(r => r[0]);
    const heat = topUnits.map(u => years.map(y => rows.filter(e => (e.unit || '—') === u && yearOf(e) === y).length));
    const latest = rows.filter(yearOf).sort((a, b) => +yearOf(b) - +yearOf(a) || String(a.nama).localeCompare(b.nama)).slice(0, 8)
      .map(e => ({ nama: e.nama, unit: e.unit, jabatan: e.jabatan, thnAktif: yearOf(e) }));
    return {
      generatedAt: at, total, units: [...new Set(rows.map(e => e.unit).filter(Boolean))].sort(unitSort),
      byUnit, byRole, gender, recruit, completeness, heat: { units: topUnits, years, matrix: heat }, latest,
      payroll: { nValid: Number(gaji.n_valid), total: Number(gaji.total_thp), avg: Number(gaji.rata_thp) },
      status: countBy(rows, e => e.status_kerja || 'Tidak diisi'),
    };
  }

  const r = express.Router();
  r.use(requireAuth, requireAdmin);

  r.get('/summary', async (req, res) => {
    try { res.json(summarize(await load(req.query.refresh === '1'))); }
    catch (e) {
      if (e.code !== 'NOCONF') console.error('[sdm] summary:', e.message);
      res.status(503).json({ error: e.code === 'NOCONF' ? e.message : 'Tidak dapat membaca database HR: ' + e.message, notConfigured: e.code === 'NOCONF' });
    }
  });

  // Drill-down: filter di server, keluaran hanya nama + unit + jabatan
  r.get('/people', async (req, res) => {
    try {
      const { rows } = await load(false);
      const q = req.query, s = v => (typeof v === 'string' ? v.slice(0, 120) : '');
      const unit = s(q.unit), year = s(q.year), role = s(q.role), gender = s(q.gender), flag = s(q.missing);
      const FLAGS = new Set(['ada_nik', 'ada_foto', 'ada_rekening', 'ada_pendidikan', 'ada_email', 'ada_kesehatan', 'ada_gaji']);
      const list = rows.filter(e =>
        (!unit || (e.unit || '—') === unit) && (!year || yearOf(e) === year) && (!role || roleGroup(e) === role) &&
        (!gender || (gender === 'kosong' ? !['Pria', 'Perempuan'].includes(e.gender) : e.gender === gender)) &&
        (!flag || (FLAGS.has(flag) && !e[flag])))
        .map(e => ({ nama: e.nama, unit: e.unit || '—', jabatan: e.jabatan || '—' }))
        .sort((a, b) => unitSort(a.unit, b.unit) || a.nama.localeCompare(b.nama));
      res.json({ total: list.length, people: list.slice(0, 2000) });
    } catch (e) { res.status(503).json({ error: e.message }); }
  });

  return r;
}
