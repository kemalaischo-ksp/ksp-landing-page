/**
 * Keamanan kata sandi dashboard KSP.
 * - Hash: Argon2id (rekomendasi utama OWASP) — m=64 MiB, t=3, p=1, salt acak per akun.
 * - Hash lama (scrypt bawaan Better Auth) tetap bisa login, lalu otomatis
 *   di-upgrade ke Argon2id saat login berhasil (tanpa perlu reset massal).
 * - Kebijakan: 12–128 karakter, ≥3 dari 4 jenis karakter, bukan sandi umum,
 *   tidak memuat nama/email, tidak berupa pengulangan/urutan.
 */
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { verifyPassword as legacyVerify } from 'better-auth/crypto';

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const ARGON_OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };

export function hashPassword(password) {
  return argonHash(password, ARGON_OPTS);
}

/** onLegacyMatch(oldHash, newHash) dipanggil saat hash scrypt lama cocok → simpan hash Argon2id. */
export function makeVerifier(onLegacyMatch) {
  return async ({ hash, password }) => {
    if (typeof hash !== 'string' || !hash) return false;
    if (hash.startsWith('$argon2')) {
      try { return await argonVerify(hash, password); } catch { return false; }
    }
    const ok = await legacyVerify({ hash, password }).catch(() => false);
    if (ok && onLegacyMatch) {
      try { onLegacyMatch(hash, await hashPassword(password)); }
      catch (e) { console.warn('[auth] upgrade hash gagal:', e.message); }
    }
    return ok;
  };
}

const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'qwerty', 'qwerty123', 'qwertyuiop',
  'admin', 'admin123', 'administrator', 'welcome', 'welcome1', 'letmein', 'iloveyou',
  '123456789012', '1234567890', '12345678', 'abc123', 'abcdef', 'bismillah', 'alhamdulillah',
  'indonesia', 'jakarta', 'rahasia', 'katasandi', 'sayang', 'alwildan', 'aischo', 'ksp',
]);

/** Kembalikan pesan kesalahan (Bahasa Indonesia) atau null bila sandi lolos kebijakan. */
export function checkPassword(password, { email = '', name = '' } = {}) {
  if (typeof password !== 'string') return 'Kata sandi wajib diisi.';
  if (password.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (password.length > PASSWORD_MAX) return `Kata sandi maksimal ${PASSWORD_MAX} karakter.`;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
  if (classes < 3) return 'Gunakan minimal 3 dari 4 jenis: huruf kecil, huruf besar, angka, simbol.';
  const low = password.toLowerCase();
  const core = low.replace(/[^a-z]/g, '');
  if (COMMON.has(low) || COMMON.has(core)) return 'Kata sandi terlalu umum — pilih yang lain.';
  if (/(.)\1{3,}/.test(password)) return 'Hindari karakter yang berulang (mis. "aaaa").';
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/.test(low)) return 'Hindari urutan mudah ditebak (mis. "1234", "qwer").';
  const parts = [email.split('@')[0], ...String(name).split(/\s+/)]
    .map(s => (s || '').toLowerCase()).filter(s => s.length >= 3);
  if (parts.some(p => low.includes(p))) return 'Kata sandi tidak boleh memuat nama atau email.';
  return null;
}
