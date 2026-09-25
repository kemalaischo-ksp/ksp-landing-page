# Traffic Pekerjaan KSP — Express + Better Auth (SQLite) + API ClickUp
FROM node:22-bookworm-slim

# Tool-chain native untuk better-sqlite3 bila prebuilt biner tidak tersedia
# (node:22-bookworm-slim tidak punya gcc/python secara default).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency server (produksi). @better-auth/cli sengaja ikut dependency
# agar `migrate` & `seed` bisa berjalan di dalam container saat start.
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Aplikasi: server + halaman statis (public)
COPY server/ ./server/
COPY public/ ./public/

WORKDIR /app/server
ENV PORT=3100
EXPOSE 3100

# Migrasi DB auth + seed admin otomatis di tiap start (idempotent),
# lalu jalankan server. auth.db diarahkan ke AUTH_DB_PATH (volume compose).
CMD ["sh", "-c", "npx @better-auth/cli migrate --yes && node seed-admin.js && node server.js"]