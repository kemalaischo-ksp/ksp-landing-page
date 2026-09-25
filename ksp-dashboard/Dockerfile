# Dashboard Traffic Pekerjaan KSP — Node serve static + API ClickUp
FROM node:22-bookworm-slim

WORKDIR /app

# Dependency server saja (produksi)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Aplikasi: server + halaman statis (public)
COPY server/ ./server/
COPY public/ ./public/

WORKDIR /app/server
ENV PORT=3100
EXPOSE 3100

CMD ["node", "server.js"]
