/**
 * Daftarkan webhook ClickUp agar dashboard update INSTAN (1-3 detik) saat
 * task dibuat/diubah. Jalankan SEKALI setelah server online di domain publik:
 *   node register-webhook.js
 *
 * Membaca dari .env: CLICKUP_TOKEN, CLICKUP_TEAM_ID, CLICKUP_WEBHOOK_SECRET,
 * dan BETTER_AUTH_URL (dipakai sebagai basis endpoint webhook).
 *
 * Syarat: BETTER_AUTH_URL harus URL HTTPS publik yang bisa dijangkau ClickUp.
 */
import 'dotenv/config';

const TOKEN = process.env.CLICKUP_TOKEN;
const TEAM_ID = process.env.CLICKUP_TEAM_ID || '90181116810'; // workspace KSP
const SECRET = process.env.CLICKUP_WEBHOOK_SECRET;
const BASE = (process.env.BETTER_AUTH_URL || '').replace(/\/$/, '');

if (!TOKEN) { console.error('✗ CLICKUP_TOKEN belum diisi di .env'); process.exit(1); }
if (!SECRET) { console.error('✗ CLICKUP_WEBHOOK_SECRET belum diisi di .env (isi string acak, mis. hasil openssl rand -hex 16)'); process.exit(1); }
if (!/^https:\/\//.test(BASE)) { console.error('✗ BETTER_AUTH_URL harus URL HTTPS publik (mis. https://traffic.domain-anda.id)'); process.exit(1); }

const endpoint = `${BASE}/api/clickup-webhook`;
const body = {
  endpoint,
  events: ['taskCreated', 'taskUpdated', 'taskStatusUpdated', 'taskDeleted', 'taskMoved', 'taskPriorityUpdated', 'taskDueDateUpdated'],
  secret: SECRET,
};

try {
  const res = await fetch(`https://api.clickup.com/api/v2/team/${TEAM_ID}/webhook`, {
    method: 'POST',
    headers: { Authorization: TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) { console.error('✗ Gagal daftar webhook:', JSON.stringify(json)); process.exit(1); }
  console.log('✓ Webhook terdaftar.');
  console.log('  id       :', json.id || json.webhook?.id);
  console.log('  endpoint :', endpoint);
  console.log('  events   :', body.events.join(', '));
  console.log('\nDashboard kini akan update dalam 1-3 detik saat ada perubahan task di ClickUp.');
} catch (err) {
  console.error('✗ Error jaringan:', err.message);
  process.exit(1);
}
process.exit(0);
