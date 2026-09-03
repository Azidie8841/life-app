# Dockerfile = arahan step-by-step untuk bina "kotak" (container) yang
# mengandungi semua benda perlu untuk jalankan app ini — tak kira
# komputer mana pun ia dijalankan (laptop kau, server Render, dll.),
# hasilnya akan sama. Ini konsep teras DevOps: "it works on my machine"
# tak lagi jadi masalah sebab kita hantar seluruh persekitaran sekali.

FROM node:20-alpine

WORKDIR /app/server

# Salin package.json dulu sahaja (bukan semua kod) supaya Docker boleh
# cache langkah "npm install" — build kali kedua jadi jauh lebih laju
# selagi dependency tak berubah.
COPY server/package*.json ./
RUN npm install --omit=dev

# Baru salin baki kod backend, dan frontend statik
COPY server/ ./
COPY public/ /app/public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/app.js"]
