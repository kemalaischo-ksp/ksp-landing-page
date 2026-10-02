/**
 * Better Auth — konfigurasi autentikasi untuk dashboard Traffic Pekerjaan KSP.
 * Single-admin: email + password, registrasi publik dimatikan.
 * Database SQLite (better-sqlite3) — sesuai pola SQLite yang sudah dipakai KSP.
 */
import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, makeVerifier, PASSWORD_MIN, PASSWORD_MAX } from './password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const authDb = new Database(process.env.AUTH_DB_PATH || path.join(__dirname, 'auth.db'));

// Tolak start di production (NODE_ENV=production atau BETTER_AUTH_URL https) bila secret sesi masih default/terlalu pendek.
const IS_PROD = process.env.NODE_ENV === 'production' || (process.env.BETTER_AUTH_URL || '').startsWith('https://');
const SECRET = process.env.BETTER_AUTH_SECRET || '';
if (IS_PROD && (SECRET.length < 32 || /ganti|DEV-ONLY/i.test(SECRET))) {
  throw new Error('BETTER_AUTH_SECRET wajib diisi (min. 32 karakter acak) di production. Buat dengan: openssl rand -base64 32');
}

// Upgrade otomatis hash scrypt lama → Argon2id saat login berhasil.
const upgradeHash = authDb.prepare("UPDATE account SET password = ?, updatedAt = ? WHERE providerId = 'credential' AND password = ?");
const onLegacyMatch = (oldHash, newHash) => {
  const r = upgradeHash.run(newHash, new Date().toISOString(), oldHash);
  if (r.changes) console.log('[auth] hash kata sandi di-upgrade ke Argon2id');
};

export const auth = betterAuth({
  // File DB SQLite; dibuat otomatis saat `npx @better-auth/cli migrate` dijalankan.
  database: authDb,

  // WAJIB diisi di production (.env). Domain publik dashboard, mis. https://traffic.domainanda.id
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

  // Kunci rahasia untuk enkripsi sesi. Buat dengan: openssl rand -base64 32
  secret: SECRET || 'DEV-ONLY-ganti-dengan-secret-acak-panjang',

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: PASSWORD_MIN,
    maxPasswordLength: PASSWORD_MAX,
    // Argon2id menggantikan scrypt bawaan (lihat password.js)
    password: { hash: hashPassword, verify: makeVerifier(onLegacyMatch) },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // sesi berlaku 7 hari
    updateAge: 60 * 60 * 24,     // perpanjang tiap 1 hari aktif
  },

  // Cookie sesi: httpOnly + SameSite=Lax (default Better Auth); Secure otomatis bila BETTER_AUTH_URL https.
  advanced: {
    useSecureCookies: (process.env.BETTER_AUTH_URL || '').startsWith('https://'),
  },

  // Plugin admin: manajemen user + role.
  // Role: 'admin' (akses penuh) & 'viewer' (atasan, hanya lihat). User baru default 'viewer'.
  plugins: [
    admin({
      defaultRole: 'viewer',
      adminRoles: ['admin'],
    }),
  ],

  // Origin yang diizinkan (tambahkan domain produksi Anda di .env, pisahkan dengan koma)
  trustedOrigins: (process.env.TRUSTED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
});
