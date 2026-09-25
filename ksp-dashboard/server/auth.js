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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const auth = betterAuth({
  // File DB SQLite; dibuat otomatis saat `npx @better-auth/cli migrate` dijalankan.
  database: new Database(process.env.AUTH_DB_PATH || path.join(__dirname, 'auth.db')),

  // WAJIB diisi di production (.env). Domain publik dashboard, mis. https://traffic.domainanda.id
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',

  // Kunci rahasia untuk enkripsi sesi. Buat dengan: openssl rand -base64 32
  secret: process.env.BETTER_AUTH_SECRET || 'DEV-ONLY-ganti-dengan-secret-acak-panjang',

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // sesi berlaku 7 hari
    updateAge: 60 * 60 * 24,     // perpanjang tiap 1 hari aktif
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
