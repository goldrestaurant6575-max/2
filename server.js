/* =========================================================================
   GOLD RESTAURANT — BACKEND SERVER (bitta faylda, to'liq)
   -------------------------------------------------------------------------
   Bu fayl butun backendni o'z ichiga oladi:
     - PostgreSQL (Railway) ga ulanish
     - Kerakli jadvallarni avtomatik yaratish (agar mavjud bo'lmasa)
     - Birinchi ishga tushganda boshlang'ich menyu/tarjima ma'lumotlarini
       bazaga yozib qo'yish (seed) — asl menu-data.js / i18n-data.js dagi
       ma'lumotlar shu maqsadda seed.json faylida saqlangan.
     - Admin panel (admin.html) uchun himoyalangan (PIN bilan) CRUD API
     - Public sayt (index.html) uchun ochiq (public) o'qish API'si
     - Statik fayllarni (index.html, admin.html, sw.js, va h.k.) berish

   ENDPOINTLAR:
     GET  /api/state                 -> butun holat (cats, subcats, menu,
                                          i18n va pinSet bayrog'i) — public
     PUT  /api/state                 -> to'liq holatni saqlash (admin,
                                          X-Admin-Pin header talab qilinadi)
     GET  /api/admin/status          -> { pinSet: boolean }
     POST /api/admin/set-pin         -> birinchi marta PIN o'rnatish
     POST /api/admin/verify-pin      -> PIN to'g'riligini tekshirish (login)
     POST /api/admin/change-pin      -> PIN kodni almashtirish
     POST /api/admin/reset           -> bazani asl (seed) holatga qaytarish
   ========================================================================= */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { Pool } = require('pg');

// -------------------------------------------------------------------------
// 1) DATABASE ULANISHI
// -------------------------------------------------------------------------
// Railway'da bu qiymat avtomatik DATABASE_URL muhit o'zgaruvchisi orqali
// beriladi. Lokal ishga tushirish uchun quyidagi RAILWAY_DEFAULT_DB_URL
// zaxira (fallback) sifatida ishlatiladi.
const RAILWAY_DEFAULT_DB_URL =
  'postgresql://postgres:hFKZGTveAwAirkHKVFTkrjfTFYJjtAUn@postgres.railway.internal:5432/railway';

const DATABASE_URL = process.env.DATABASE_URL || RAILWAY_DEFAULT_DB_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Railway ichki (internal) hostiga ulanganda SSL kerak emas, lekin
  // tashqi (public) hostga ulanganda ko'pincha SSL talab qilinadi.
  // Shu sabab avtomatik aniqlaymiz:
  ssl: DATABASE_URL.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false }
});

async function query(text, params) {
  return pool.query(text, params);
}

// -------------------------------------------------------------------------
// 2) JADVALLARNI YARATISH
// -------------------------------------------------------------------------
// Hamma narsani bitta oddiy "key -> jsonb value" jadvalida saqlaymiz.
// Bu admin.html dagi eski localStorage kalitlariga (LS.cats, LS.menu, ...)
// bevosita mos keladi va butun state'ni bitta so'rov bilan o'qish/yozish
// imkonini beradi.
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS app_store (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const STORE_KEYS = [
  'cats', 'subcats', 'menu',
  'uiI18n', 'catI18n', 'subcatI18n', 'itemI18n', 'variantI18n'
];

async function ensureSchema() {
  await query(CREATE_TABLE_SQL);
}

// -------------------------------------------------------------------------
// 3) BOSHLANG'ICH MA'LUMOT (SEED)
// -------------------------------------------------------------------------
// Asl menu-data.js / i18n-data.js fayllaridan bir marta chiqarib olingan
// ma'lumotlar shu yerda saqlanadi. Baza bo'sh bo'lsa (birinchi marta ishga
// tushganda) shu ma'lumotlar bazaga yoziladi. Shundan keyin admin panel
// orqali kiritilgan har qanday o'zgarish to'g'ridan-to'g'ri bazada
// saqlanadi va "asl holatga qaytarish" tugmasi ham shu seed'ga qaytaradi.
const SEED_PATH = path.join(__dirname, 'seed.json');
const SEED_DATA = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

async function seedIfEmpty() {
  const { rows } = await query('SELECT COUNT(*)::int AS c FROM app_store');
  if (rows[0].c > 0) return; // baza allaqachon to'ldirilgan

  console.log('[seed] app_store bo\'sh — boshlang\'ich ma\'lumotlar yozilmoqda...');
  for (const key of STORE_KEYS) {
    await query(
      `INSERT INTO app_store (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO NOTHING`,
      [key, JSON.stringify(SEED_DATA[key] ?? (Array.isArray(SEED_DATA[key]) ? [] : {}))]
    );
  }
  console.log('[seed] Tayyor.');
}

async function resetToSeed() {
  for (const key of STORE_KEYS) {
    await query(
      `INSERT INTO app_store (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(SEED_DATA[key] ?? {})]
    );
  }
}

// -------------------------------------------------------------------------
// 4) YORDAMCHI FUNKSIYALAR — STATE O'QISH / YOZISH
// -------------------------------------------------------------------------
async function readFullState() {
  const { rows } = await query('SELECT key, value FROM app_store');
  const state = {};
  STORE_KEYS.forEach((k) => { state[k] = Array.isArray(SEED_DATA[k]) ? [] : {}; });
  rows.forEach((r) => { state[r.key] = r.value; });
  return state;
}

async function writeStateKeys(partialState) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const key of STORE_KEYS) {
      if (!(key in partialState)) continue;
      await client.query(
        `INSERT INTO app_store (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(partialState[key])]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getPin() {
  const { rows } = await query('SELECT value FROM admin_settings WHERE key = $1', ['pin']);
  return rows.length ? rows[0].value : null;
}

async function setPin(pin) {
  await query(
    `INSERT INTO admin_settings (key, value) VALUES ('pin', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [pin]
  );
}

// -------------------------------------------------------------------------
// 5) EXPRESS ILOVASI
// -------------------------------------------------------------------------
const app = express();
// Admin panelda endi rasmlar galereyadan tanlanib, siqilgan holda
// "data:" havolasi sifatida to'g'ridan-to'g'ri holat (state) ichida
// yuboriladi — shuning uchun ruxsat etilgan so'rov hajmini oshiramiz.
app.use(express.json({ limit: '25mb' }));

// ---------------------------------------------------------------------
// CORS — endi frontend va backend BITTA papkada / bitta serverda
// joylashgan, shuning uchun aslida cross-origin so'rov bo'lmaydi.
// Baribir zarar qilmasligi uchun ruxsatni ochiq qoldiramiz (agar kimdir
// kelajakda frontendni boshqa joyga chiqarib qo'ysa ham ishlayveradi).
// ---------------------------------------------------------------------
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Pin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// MUHIM: endi frontend (index.html, admin.html, sw.js) shu BACKEND bilan
// BITTA papkada joylashgan, shuning uchun server ularni statik fayl
// sifatida to'g'ridan-to'g'ri o'zi beradi. Alohida frontend hosting
// kerak emas — bitta server hammasini beradi.
app.use(express.static(__dirname));

// ---- Admin PIN himoyasi (mutatsiya endpointlari uchun) ----
async function requireAdminPin(req, res, next) {
  try {
    const providedPin = req.header('X-Admin-Pin') || (req.body && req.body.pin);
    const currentPin = await getPin();
    if (!currentPin) {
      return res.status(403).json({ ok: false, error: 'PIN hali o\'rnatilmagan. Avval /api/admin/set-pin chaqiring.' });
    }
    if (!providedPin || providedPin !== currentPin) {
      return res.status(401).json({ ok: false, error: 'PIN noto\'g\'ri.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// ---- PUBLIC: butun state (sayt + admin panel bootstrap uchun) ----
app.get('/api/state', async (req, res, next) => {
  try {
    const state = await readFullState();
    const pin = await getPin();
    res.json({ ok: true, data: state, pinSet: !!pin });
  } catch (err) { next(err); }
});

// ---- ADMIN: to'liq state'ni saqlash (admin.html persist() shu yerga yozadi) ----
app.put('/api/state', requireAdminPin, async (req, res, next) => {
  try {
    const body = req.body || {};
    const allowed = {};
    STORE_KEYS.forEach((k) => { if (k in body) allowed[k] = body[k]; });
    await writeStateKeys(allowed);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- ADMIN AUTH ----
app.get('/api/admin/status', async (req, res, next) => {
  try {
    const pin = await getPin();
    res.json({ ok: true, pinSet: !!pin });
  } catch (err) { next(err); }
});

app.post('/api/admin/set-pin', async (req, res, next) => {
  try {
    const { pin } = req.body || {};
    if (!pin || String(pin).trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'PIN kamida 5 belgidan iborat bo\'lsin.' });
    }
    const existing = await getPin();
    if (existing) {
      return res.status(409).json({ ok: false, error: 'PIN allaqachon o\'rnatilgan.' });
    }
    await setPin(String(pin).trim());
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/admin/verify-pin', async (req, res, next) => {
  try {
    const { pin } = req.body || {};
    const currentPin = await getPin();
    if (!currentPin) return res.status(403).json({ ok: false, error: 'PIN hali o\'rnatilmagan.' });
    res.json({ ok: pin === currentPin });
  } catch (err) { next(err); }
});

app.post('/api/admin/change-pin', requireAdminPin, async (req, res, next) => {
  try {
    const { newPin } = req.body || {};
    if (!newPin || String(newPin).trim().length < 5) {
      return res.status(400).json({ ok: false, error: 'Yangi PIN kamida 5 belgidan iborat bo\'lsin.' });
    }
    await setPin(String(newPin).trim());
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/admin/reset', requireAdminPin, async (req, res, next) => {
  try {
    await resetToSeed();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- Health check (Railway uchun foydali) ----
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (err) {
    res.status(500).json({ ok: false, db: 'error', message: err.message });
  }
});

// Eslatma: "/" manzili endi yuqoridagi express.static orqali
// index.html faylini avtomatik beradi (chunki u shu papkada).
// Bu marshrut faqat API holatini tekshirish uchun qoldirildi.
app.get('/api/info', (req, res) => {
  res.json({
    ok: true,
    service: 'Gold Restaurant — backend + frontend (bitta papka, bitta server)',
    endpoints: ['/api/state', '/api/health', '/api/admin/status']
  });
});

// ---- Xatoliklarni ushlash ----
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  res.status(500).json({ ok: false, error: 'Server xatosi', message: err.message });
});

// -------------------------------------------------------------------------
// 6) SERVERNI ISHGA TUSHIRISH
// -------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await ensureSchema();
    await seedIfEmpty();
    app.listen(PORT, () => {
      console.log(`[server] Gold Restaurant backend ${PORT}-portda ishlamoqda`);
      console.log(`[server] DB host: ${DATABASE_URL.replace(/:\/\/.*@/, '://***@')}`);
    });
  } catch (err) {
    console.error('[server] Ishga tushirishda xato:', err);
    process.exit(1);
  }
}

start();