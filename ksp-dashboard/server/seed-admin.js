/**
 * Seed akun admin pertama (KSP) — jalankan SEKALI setelah migrate:
 *   node seed-admin.js   (atau: npm run seed)
 * Membaca ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME dari .env.
 * Membuat akun lalu menetapkan role 'admin' langsung di SQLite
 * (menghindari kebutuhan sesi admin yang belum ada saat pertama kali).
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME || 'KSP';

if (!email || !password) {
  console.error('✗ Isi ADMIN_EMAIL dan ADMIN_PASSWORD di file .env terlebih dahulu.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('✗ ADMIN_PASSWORD minimal 8 karakter.');
  process.exit(1);
}

try {
  await auth.api.signUpEmail({ body: { email, password, name } });
  console.log(`✓ Akun dibuat: ${email}`);
} catch (err) {
  console.warn('• Sign-up dilewati (email mungkin sudah ada):', err.message || err);
}

// Tetapkan role admin langsung di DB.
try {
  const db = new Database(process.env.AUTH_DB_PATH || path.join(__dirname, 'auth.db'));
  const res = db.prepare('UPDATE user SET role = ? WHERE email = ?').run('admin', email);
  if (res.changes > 0) console.log(`✓ Role admin ditetapkan untuk ${email}`);
  else console.warn('• Tidak ada baris user yang diperbarui — pastikan migrate sudah dijalankan.');
  db.close();
} catch (err) {
  console.error('✗ Gagal menetapkan role admin:', err.message || err);
  process.exit(1);
}
process.exit(0);
