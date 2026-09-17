# Catatan Meraki — Deployment & Hardening

> Fork ini (`Meraki-Karya-Teknologi/waha`) dipakai buat 2 hal: (1) referensi kalau
> nanti perlu patch sendiri karena vendor lambat/gak respons ke laporan security, dan
> (2) tempat nyimpen catatan operasional WAHA yang dipakai Meraki — sebelumnya sempat
> nyampur di repo `meraki-erp` (gak berhubungan, WAHA bukan bagian ERPNext), dipindah
> ke sini 2026-09-17.

## Deployment

Container jalan di VPS Contabo yang sama dengan `meraki-erp`, `pt-mkt.com`,
`wa-rotator`, n8n, BentoPDF (VPS **shared**, bukan dedicated — lihat
`meraki-erp/docs/DEPLOYMENT.md` buat detail server-nya).

- Path di server: `/opt/waha/docker-compose.yml`
- Image: `devlikeapro/waha:latest` (WAHA Core, gratis — bukan WAHA Plus)
- Port: container `127.0.0.1:3355` → `3000`, di-reverse-proxy nginx ke
  `waha.pt-mkt.com` (SSL via Certbot, pola sama kayak subdomain lain di server ini)
- Session WhatsApp persisten di named volume `waha_sessions:/app/.sessions` —
  **tapi restart/recreate container kadang tetap bikin session perlu discan ulang**
  (WEBJS engine gak selalu restore mulus, ditemukan 2026-09-17), jangan asumsikan
  volume = pasti gak perlu scan ulang.
- Kredensial (`WAHA_API_KEY`, `WAHA_DASHBOARD_USERNAME/PASSWORD`,
  `WHATSAPP_SWAGGER_USERNAME/PASSWORD`) disimpan di password manager Yusuf —
  **jangan pernah `cat` file compose-nya langsung**, dia hardcode plaintext value
  (bukan env var reference) — pakai `docker inspect waha --format ... | grep <NAMA_VAR>`
  buat cek nama variabelnya doang tanpa nampilin value ke layar/log.

## Insiden & Perbaikan (2026-09-17)

- Dashboard sempat gagal connect karena config API key di browser masih nilai
  default `admin` — bukan bug server, cuma field yang belum diisi value asli.
- `WAHA_API_KEY`, `WAHA_DASHBOARD_PASSWORD`, `WHATSAPP_SWAGGER_PASSWORD` sempat
  kelihatan plaintext di transkrip sesi Claude Code (`cat` compose file gak
  sengaja) — **ketiganya sudah dirotate** (generate langsung di server via
  `openssl rand`, gak pernah lewat chat). Dashboard & Swagger password sebelumnya
  ternyata reuse value yang sama — sekarang sudah beda-beda.
- Update image ke `:latest` dicoba — versi tetap `2026.8.2`, belum ada rilis lebih
  baru dari vendor per tanggal ini.

## Security: CVE-2026-6979 (SSRF) — DIKONFIRMASI MASIH ADA di 2026.8.2

**Dibuktikan langsung baca source** (bukan cuma dari changelog vendor yang gak
nyebut fix apa pun buat CVE ini):

- `src/api/media.controller.ts:79-80` — `session.fetch(file.url)` nge-fetch URL dari
  user **tanpa validasi apa pun** (gak ada cek skema, gak ada blokir IP
  internal/private).
- `src/utils/fetch.ts` — implementasi `fetchBuffer()`: `axios.get(url, ...)` polos,
  plus **`rejectUnauthorized: false`** (verifikasi sertifikat TLS dimatikan total
  buat semua fetch — temuan tambahan di luar CVE aslinya).
- Endpoint kena: `POST /api/{session}/media/convert/voice` dan `/convert/video`,
  cuma butuh API key biasa (bukan admin-only). **Hasil fetch dikembalikan ke
  pemanggil** — bukan blind SSRF, penyerang bisa baca isi response dari target
  internal (mis. cloud metadata, service lain di server yang sama).
- Vendor gak respons ke laporan CVE ini (per riset awal); gak ada rilis resmi yang
  menyebut fix-nya sampai `2026.8.2`.

### Rencana Mitigasi (belum dieksekusi per 2026-09-17)

1. **Outbound: blokir akses container WAHA ke rentang IP privat/internal**
   (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`,
   `169.254.0.0/16` — termasuk cloud metadata endpoint) via firewall/iptables di
   level Docker, biarkan akses internet publik tetap normal. Ini mitigasi standar
   SSRF (blokir tujuan internal, bukan whitelist tujuan eksternal) — gak butuh
   daftar domain WhatsApp/CDN spesifik apa pun. **Prioritas lebih tinggi** dari
   item Cloudflare Access di bawah — SSRF ini bisa dieksploitasi siapa pun yang
   pegang API key, gak terhalang proteksi inbound sama sekali.
2. **Inbound: pasang Cloudflare Access (Zero Trust)** di depan `waha.pt-mkt.com`
   — dipilih dibanding IP allowlist WAF biasa karena gak butuh IP tetap (jalan
   dari mana aja asal email terdaftar). Setup: Cloudflare dashboard →
   Security/Zero Trust → Access → Applications → Add application → domain
   `waha.pt-mkt.com` → policy izinkan login pakai One-Time PIN, kombinasi 2
   aturan "Include": **Emails ending in `@pt-mkt.com`** + **Emails** (daftar
   spesifik di luar domain itu kalau ada partner/vendor yang perlu akses).
   Eksekusi manual di dashboard Cloudflare — di luar akses Claude (gak ada API
   token buat Cloudflare di sesi ini).
3. **Opsi jangka panjang (belum diputuskan): patch sendiri.** Fork ini
   (`Meraki-Karya-Teknologi/waha`) bisa dipakai buat nambahin validasi URL
   (tolak skema selain http/https, tolak IP privat/internal, `rejectUnauthorized:
   true`) di `src/utils/fetch.ts`, lalu build custom Docker image dari fork ini
   dan deploy ke server (ganti `image: devlikeapro/waha:latest` di
   `/opt/waha/docker-compose.yml` jadi image custom) — pola yang sama kayak
   custom Docker image `meraki_erp_customizations` di repo `meraki-erp`. Belum
   dikerjakan, ini opsi kalau mitigasi network-level (poin 1-2) dirasa belum
   cukup atau vendor tetap gak respons dalam waktu lama.

## Sumber

Dipindah dari `meraki-erp/docs/BACKLOG.md` (2026-09-17) — WAHA bukan bagian
ERPNext, gak seharusnya nyampur di sana. Audit source & temuan CVE dikerjakan
pakai skill `security-audit` (`cloudflare/security-audit-skill`) dalam mode
guidance/scoped investigation, bukan full 6-phase audit.
