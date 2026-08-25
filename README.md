# Gold Restaurant — Frontend + Backend (alohida joylashadigan)

Loyiha ikki mustaqil qismdan iborat, ikkalasi ham TURLI joylarda deploy qilinadi:

```
gold-restaurant/
├── backend/     ← Railway'ga (yoki istalgan Node.js hostingga) deploy qilinadi
│   ├── server.js       (butun backend logikasi — bitta faylda)
│   ├── package.json
│   ├── seed.json        (boshlang'ich menyu ma'lumotlari)
│   └── .env.example
└── frontend/    ← istalgan statik hosting'ga deploy qilinadi
    ├── index.html        (mijozlar ko'radigan sayt)
    ├── admin.html         (admin panel)
    └── sw.js
```

## 1-qadam — Backend'ni Railway'ga joylash

1. Railway'da yangi loyiha yarating, PostgreSQL xizmatini qo'shing (agar
   hali qo'shmagan bo'lsangiz).
2. `backend/` papkasidagi fayllarni GitHub repo'ga yuklang (yoki Railway
   CLI orqali `railway up` bilan to'g'ridan-to'g'ri joylang).
3. Railway "Variables" bo'limida quyidagilarni tekshiring/kiriting:
   - `DATABASE_URL` — odatda Railway buni Postgres xizmatidan avtomatik
     ulaydi (agar bir xil loyihada bo'lsa). Bo'lmasa, o'zingiz qo'ying:
     `postgresql://postgres:hFKZGTveAwAirkHKVFTkrjfTFYJjtAUn@postgres.railway.internal:5432/railway`
   - `CORS_ORIGIN` — frontend'ingiz manzili, masalan
     `https://gold-restaurant.vercel.app` (frontend domenini bilguningizcha
     `*` qoldirsangiz ham bo'ladi, keyin almashtirasiz).
4. Deploy tugagach, Railway sizga backend manzilini beradi, masalan:
   `https://gold-restaurant-backend-production.up.railway.app`
5. Tekshirish: brauzerda `https://.../api/health` ni oching —
   `{"ok":true,"db":"connected"}` chiqishi kerak.

Backend birinchi marta ishga tushganda `seed.json` dagi ma'lumotlarni
(181 ta taom, 13 kategoriya va tarjimalar) avtomatik ravishda bazaga
yozib qo'yadi — qo'lda hech narsa qilish shart emas.

## 2-qadam — Frontend'ni sozlash va joylash

1. `frontend/index.html` va `frontend/admin.html` fayllarining boshida
   quyidagi qatorni toping:

   ```html
   window.API_BASE_URL = "https://SIZNING-BACKEND-MANZILINGIZ.up.railway.app";
   ```

   va uni 1-qadamda olgan haqiqiy backend manzilingiz bilan almashtiring
   (ikkala faylda ham).

2. `frontend/` papkasini istalgan statik hosting'ga joylang (Netlify,
   Vercel, GitHub Pages, cPanel, oddiy Nginx/Apache server va h.k.).

3. Endi sayt (`index.html`) va admin panel (`admin.html`) shu backend
   API'siga murojaat qilib ishlaydi.

## Admin panelga birinchi kirish

`admin.html` ochilganda tizim PIN hali o'rnatilmaganini aniqlaydi va
sizdan yangi PIN o'rnatishni so'raydi (kamida 5 belgi). Shundan keyin
har safar shu PIN bilan kirasiz.

## API endpointlar (qisqacha)

| Metod | Manzil                     | Tavsif                                   | Himoya       |
|-------|-----------------------------|-------------------------------------------|--------------|
| GET   | `/api/state`                | Butun menyu + tarjima ma'lumotlari        | Ochiq        |
| PUT   | `/api/state`                | To'liq holatni saqlash                    | `X-Admin-Pin`|
| GET   | `/api/admin/status`         | PIN o'rnatilganmi?                        | Ochiq        |
| POST  | `/api/admin/set-pin`        | Birinchi marta PIN o'rnatish              | Ochiq (bir marta)|
| POST  | `/api/admin/verify-pin`     | Login uchun PIN tekshirish                | Ochiq        |
| POST  | `/api/admin/change-pin`     | PIN kodni almashtirish                    | `X-Admin-Pin`|
| POST  | `/api/admin/reset`          | Bazani boshlang'ich holatga qaytarish     | `X-Admin-Pin`|
| GET   | `/api/health`               | Server/baza holatini tekshirish           | Ochiq        |

`X-Admin-Pin` — so'rov sarlavhasida joriy PIN kod yuborilishi kerak
bo'lgan endpointlar (mutatsiya/yozish amallari).

## Lokal ishga tushirish (test uchun)

```bash
cd backend
npm install
cp .env.example .env   # kerak bo'lsa DATABASE_URL / CORS_ORIGIN ni tahrirlang
npm start
```

Keyin `frontend/index.html` va `admin.html` dagi `API_BASE_URL` ni
`http://localhost:3000` ga o'zgartirib, frontend fayllarini brauzerda
(yoki `npx serve frontend`) ochib sinab ko'rishingiz mumkin.
