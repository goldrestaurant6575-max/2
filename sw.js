/* ==========================================================================
   MEDIA CACHE SERVICE WORKER
   Maqsad: rasm va videolarni (Cloudinary, ImageKit) brauzerning o'z
   Cache Storage'ida saqlab qo'yish — birinchi ochilishda internetdan
   yuklanadi, keyingi safarlarda esa keshdan bir zumda chiqadi va
   qayta yuklanmaydi (localStorage emas — u katta fayllar uchun mos
   emas, buning o'rniga shu maxsus browser API ishlatiladi).

   MUHIM TUZATISH (v2): Video pleyer video faylni bittada emas,
   "Range" so'rovlari bilan bo'lak-bo'lak (masalan "bytes=0-1",
   keyin "bytes=0-524287" va h.k.) so'rab yuklaydi. Eski versiya
   shu bo'laklarning BIRINCHISINI butun fayl deb keshga saqlab
   qo'yardi va keyingi barcha so'rovlarga (qaysi qism so'ralishidan
   qat'iy nazar) o'sha bir xil kichik bo'lakni qaytarardi — natijada
   video "buzilib" faqat bittasi (birinchi to'liq yuklangani) to'g'ri
   ishlar, qolganlari ishlamas edi. Bu versiyada video har doim
   TO'LIQ holda keshlanadi, Range so'rovlariga esa shu to'liq
   nusxadan kerakli qismi o'zimiz kesib beriladi (206 Partial
   Content) — bu brauzerning haqiqiy server xatti-harakatiga mos.
   ========================================================================== */

const CACHE_NAME = 'menu-media-v2'; // versiya oshirildi — eski (noto'g'ri saqlangan) yozuvlar avtomatik tozalanadi

// Shu domenlardan kelgan fayllar (rasm/video) keshlanadi
const MEDIA_HOSTS = [
  'res.cloudinary.com',
  'ik.imagekit.io'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  const isMedia = MEDIA_HOSTS.some((h) => url.hostname.includes(h));
  if (!isMedia) return; // HTML/JS/CSS — brauzerning odatiy yuklashiga qo'yamiz

  event.respondWith(handleMediaFetch(req));
});

// Range sarlavhasidan qat'iy nazar, bitta fayl uchun BITTA (toza) kesh
// kaliti ishlatamiz — shunda faylning turli qismlari bir-birining
// ustidan yozilib, keshni buzib qo'ymaydi.
function cacheKeyFor(req) {
  return new Request(req.url, { method: 'GET' });
}

async function handleMediaFetch(req) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = cacheKeyFor(req);
  const rangeHeader = req.headers.get('range');

  let fullResponse = await cache.match(cacheKey);

  // Keshda yo'q bo'lsa — TO'LIQ faylni (Range'siz) tarmoqdan olib,
  // to'liq holda keshga solib qo'yamiz.
  if (!fullResponse) {
    try {
      const networkResponse = await fetch(new Request(req.url, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store'
      }));

      if (networkResponse && networkResponse.ok) {
        cache.put(cacheKey, networkResponse.clone());
        fullResponse = networkResponse;
      } else {
        // CORS yo'q / cross-origin cheklovi bor ("opaque" javob) —
        // bunday javobni xavfsiz keshlab-kesish imkonsiz, shuning
        // uchun asl so'rovni to'g'ridan-to'g'ri tarmoqqa yuboramiz
        return fetch(req);
      }
    } catch (err) {
      // Internet yo'q va keshda ham topilmadi
      return fetch(req).catch(() => Response.error());
    }
  }

  // Range so'ralmagan bo'lsa — to'liq faylni shundayligicha qaytaramiz
  if (!rangeHeader) {
    return fullResponse.clone();
  }

  // Range so'ralgan bo'lsa — to'liq (keshlangan) fayldan kerakli
  // qismini o'zimiz kesib, 206 Partial Content sifatida qaytaramiz
  try {
    const buffer = await fullResponse.clone().arrayBuffer();
    const size = buffer.byteLength;
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : size - 1;
    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= size) end = size - 1;

    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: { 'Content-Range': `bytes */${size}` }
      });
    }

    const chunk = buffer.slice(start, end + 1);
    const headers = new Headers(fullResponse.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(chunk.byteLength));
    headers.set('Accept-Ranges', 'bytes');

    return new Response(chunk, {
      status: 206,
      statusText: 'Partial Content',
      headers
    });
  } catch (err) {
    // Kesish muvaffaqiyatsiz bo'lsa (masalan "opaque" javob bo'lib
    // qolgan bo'lsa) — asl so'rovni to'g'ridan-to'g'ri tarmoqqa yuboramiz
    return fetch(req).catch(() => Response.error());
  }
}