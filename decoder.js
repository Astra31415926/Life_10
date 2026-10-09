/* ═══════════════════════════════════════════════════════════════════════════
   decoder.js — TAINA Decoder v1.0
   Новый декодер, написанный с нуля под камеру мобильного телефона.

   НОТАЦИЯ РАЗМЕРА (стандарт проекта):
     T = внешняя рамка(1) + зебра(1) + данные(n) + зебра(1) + внешняя рамка(1)
     T = n + 4        n = T - 4        Tz (кольцо зебры) = T - 2

   КОНВЕЙЕР:
     кадр → уменьшенная копия → контуры → 4-угольники → гипотезы стиска
          → зебра → структура внешней рамки → warp ИЗ ОРИГИНАЛА
          → выборка клеток → RGB/каналы → TAINA decode → обратная сверка

   ДВА ПРАВИЛА, НА КОТОРЫХ ДЕРЖИТСЯ НАДЁЖНОСТЬ:
     1. Уменьшенная копия кадра используется ТОЛЬКО для поиска контуров.
        Любая выборка пикселей идёт из оригинального кадра. Пересэмплинг
        убивает и мелкие коды (T=11), и крупные (T=61).
     2. Результат выдаётся, только если пройдены ОБЕ проверки:
        структура внешней рамки ≥ 0.95  И  обратная сверка ≥ 0.90.
        Иначе NO CODE.

   ПУБЛИЧНОЕ API — в конце файла.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
(function () {

/* ───────────────────────────── НАСТРОЙКИ ───────────────────────────── */

const CFG = {
  DETECT_MAX:      900,    // макс. сторона уменьшенной копии для поиска контуров
  PROBE_SIZE:      360,    // базовий розмір дешевого warp-а для гіпотез
  /* Проба мусить розрізняти ОКРЕМІ модулі. У великого коду (n за 80)
     при фіксованих 360 px на модуль лишається 4 px, і зебра перестає
     рахуватись. Тому проба росте за кандидатом. (з версії 1.9) */
  PROBE_MAX:       760,
  FINAL_MIN:       240,    // границы размера финального warp-а
  FINAL_MAX:      1100,
  SQUARENESS_MIN:  0.55,   // минимальная «квадратность» кандидата
  INSETS:   [1, 0.5, 1.5, 0, 2, 2.5, 3],  // гипотезы стиска, в модулях
  /* Долевые гипотезы — на случай, когда контур поймал чёрную обводку или белое
     поле и Tz по такому квадрату вообще не читается (характерно для мелких
     кодов, где один модуль занимает десятую часть стороны). */
  INSETS_FRAC: [0, 0.015, 0.03, 0.045, 0.06, 0.08, 0.105, 0.13],
  FRAME_MIN:       0.95,   // порог структуры внешней рамки
  AGREE_MIN:       0.90,   // порог обратной сверки при чистом коде
  /* Пом'якшений режим для перекритого коду: розбіжності приймаються,
     якщо вони зібрані в одну пляму, а не розсипані по полю. */
  AGREE_BLOB:      0.70,   // мінімальна звірка, коли розбіжності — одна пляма
  BLOB_MAX_AREA:   0.30,   // пляма не більша за 30% поля
  BLOB_MAX_BBOX:   0.40,   // габарит плями не більший за 40% поля
  T_MIN:           9,      // T = 9 → n = 5
  T_MAX:          201,
  MIN_CONTRAST:    50,     // минимальный контраст строки для анализа зебры
  IMAGE:  { maxQuads: 14, timeBudgetMs: 2500 },
  CAMERA: { maxQuads:  6, timeBudgetMs:  500 }
};

/* ── АВТОЗАГРУЗКА OpenCV.js ───────────────────────────────────────────────
   OpenCV нужен для поиска контуров. Декодер подтягивает его сам, чтобы
   оставаться drop-in: подключил decoder.js — и всё работает.
   Если на странице уже есть свой <script> с opencv.js, повторно не грузим. */
const OPENCV_URL = 'https://docs.opencv.org/4.8.0/opencv.js';
let _cvPromise = null;
function ensureOpenCV() {
  if (_cvPromise) return _cvPromise;
  _cvPromise = new Promise(resolve => {
    if (window.cv && window.cv.Mat) return resolve(true);
    let doc;
    try { doc = document; } catch (e) { return resolve(false); }
    if (!doc || !doc.head) return resolve(false);
    try {
      if (!doc.querySelector('script[data-taina-opencv]') &&
          !doc.querySelector('script[src*="opencv.js"]')) {
        const s = doc.createElement('script');
        s.src = OPENCV_URL; s.async = true;
        s.setAttribute('data-taina-opencv', '1');
        doc.head.appendChild(s);
      }
    } catch (e) { return resolve(false); }
    const t0 = Date.now();
    (function poll() {
      if (window.cv && window.cv.Mat) return resolve(true);
      if (Date.now() - t0 > 25000) return resolve(false);
      setTimeout(poll, 120);
    })();
  });
  return _cvPromise;
}

/* ТІЛЬКИ ×8 (октант). Симетрії ×4 і ×2 з формату вилучені.
   На тестовому наборі жодна з них не дала жодного правильного читання —
   лише хибні спрацювання: ×4 дала 55 гіпотез, ×2 дала 41, усі до єдиної
   сміття. Причина проста: чим менше дзеркал, тим легше випадковій області
   виявитися «самоузгодженою». ×8 вимагає збігу восьми відображень. */
const MODES = ['oct'];
const RGB_MAIN = { r: [255, 0, 0],    g: [0, 255, 0],    b: [0, 0, 255]   };
const RGB_GAL  = { r: [220, 50, 60],  g: [65, 195, 65],  b: [60, 70, 215] };
const REFBITS  = [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]];

/* Місткість октанта і мінімальний розмір поля під задану кількість біт.
   Генератор бере найменше поле, куди влазять дані (pickN). Якщо знятий
   текст влазить у поле на два кроки менше — сітку зсунуто. */
function capacityOct(n) { const R = (n - 1) / 2; return (R + 1) * (R + 2) / 2; }
function minimalOctN(bits) {
  for (let n = 7; n <= CFG.T_MAX; n += 2) if (capacityOct(n) >= bits) return n;
  return CFG.T_MAX;
}

const _enc = new TextEncoder();
const _dec = new TextDecoder('utf-8', { fatal: true });

/* ═════════════════════ ЧАСТЬ 1. ЯДРО ФОРМАТА TAINA ═════════════════════
   Перенесено из рабочего декодера проекта без изменения логики.
   Формат не меняется — меняется только то, как мы до него добираемся.
   ═══════════════════════════════════════════════════════════════════════ */

function isClean(t) {
  for (const ch of t) {
    const o = ch.codePointAt(0);
    if (o === 0 || (o < 32 && ch !== '\n' && ch !== '\t')) return false;
  }
  return true;
}

function bytesToText(by) {
  by = by.slice();
  while (by.length && by[by.length - 1] === 0) by.pop();
  if (!by.length) return null;
  try {
    const t = _dec.decode(new Uint8Array(by));
    return isClean(t) ? t : null;
  } catch (e) { return null; }
}

function textBits(t) {
  const d = _enc.encode(t), b = new Uint8Array(d.length * 8);
  for (let i = 0; i < d.length; i++)
    for (let k = 0; k < 8; k++) b[i * 8 + k] = (d[i] >> (7 - k)) & 1;
  return b;
}

function Rof(n) { return (n - 1) / 2; }

const _bcCache = new Map();
function baseCells(m, n) {
  const key = m + ':' + n;
  if (_bcCache.has(key)) return _bcCache.get(key);
  const c = Rof(n), o = [];
  if (m === 'oct') {
    for (let i = 0; i <= c; i++) for (let j = 0; j <= i; j++) o.push([c + i, c + j]);
  } else if (m === 'quad') {
    for (let i = 0; i <= c; i++) for (let j = 0; j <= c; j++) o.push([c + i, c + j]);
  } else {
    for (let y = 0; y < n; y++) for (let i = 0; i <= c; i++) o.push([c + i, y]);
  }
  _bcCache.set(key, o);
  return o;
}

function mirrors(m, n, x, y) {
  const c = Rof(n), i = x - c, j = y - c;
  let p;
  if (m === 'oct')       p = [[i,j],[j,i],[-i,j],[-j,i],[i,-j],[j,-i],[-i,-j],[-j,-i]];
  else if (m === 'quad') p = [[i,j],[-i,j],[i,-j],[-i,-j]];
  else                   p = [[i,j],[-i,j]];
  const o = [];
  for (const [a, b] of p) {
    const X = c + a, Y = c + b;
    if (X >= 0 && Y >= 0 && X < n && Y < n) o.push([X, Y]);
  }
  return o;
}

function fillChannel(t, n, m, markBit) {
  const g = new Uint8Array(n * n), bc = baseCells(m, n);
  let seq = textBits(t);
  if (markBit != null) {
    const s2 = new Uint8Array(seq.length + 1);
    s2[0] = markBit; s2.set(seq, 1); seq = s2;
  }
  const lim = Math.min(seq.length, bc.length);
  for (let i = 0; i < lim; i++) {
    const [x, y] = bc[i];
    if (seq[i]) for (const [X, Y] of mirrors(m, n, x, y)) g[Y * n + X] = 1;
  }
  return g;
}

function markCell(g, n, m) {
  const [x, y] = baseCells(m, n)[0];
  return g[y * n + x] ? 1 : 0;
}

/* обратная сверка: доля совпавших клеток между снятой и перестроенной матрицей */
function agreeOf(g, chk, n) {
  let ok = 0;
  for (let z = 0; z < n * n; z++) ok += ((chk[z] ? 1 : 0) === g[z]) ? 1 : 0;
  return ok / (n * n);
}

/**
 * Чи утворюють розбіжності ОДНУ компактну пляму.
 * Клякса на коді дає розбіжності одним згустком; випадковий збіг —
 * розсипом по всьому полю. Це і відрізняє перекритий код від сміття.
 */
function mismatchShape(masks, n) {
  const N = n * n;
  const bad = new Uint8Array(N);
  let total = 0;
  for (const [g, chk] of masks)
    for (let i = 0; i < N; i++)
      if (!bad[i] && (chk[i] ? 1 : 0) !== g[i]) { bad[i] = 1; }
  for (let i = 0; i < N; i++) if (bad[i]) total++;
  if (!total) return { frac: 0, bbox: 0 };
  /* Міряємо КОМПАКТНІСТЬ, а не зв'язність. Під плямою збігаються ті
     клітинки, де справжній біт і так дорівнював кольору плями, — тому
     розбіжності всередині плями йдуть розсипом і зв'язної компоненти
     не утворюють. А от габарит у них маленький. Сміття ж розкидане
     по всьому полю, і габарит у нього — усе поле. */
  let x0 = n, y0 = n, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) {
    if (!bad[i]) continue;
    const x = i % n, y = (i / n) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { frac: total / N, bbox: ((x1 - x0 + 1) * (y1 - y0 + 1)) / N };
}

/* декод с голосованием по зеркалам — избыточность орнамента как error correction */
function decodeVoted(g, n, m, off, conf) {
  const bc = baseCells(m, n), by = [];
  for (let i = off || 0; i + 7 < bc.length; i += 8) {
    let v = 0;
    for (let b = 0; b < 8; b++) {
      const [x, y] = bc[i + b], cells = mirrors(m, n, x, y);
      let bit;
      if (conf) {
        let w1 = 0, w0 = 0;
        for (const [X, Y] of cells) {
          const cv = conf[Y * n + X];
          if (cv < 0.15) continue;           // серая клякса — клетка исключается
          if (g[Y * n + X]) w1 += cv; else w0 += cv;
        }
        bit = (w1 === 0 && w0 === 0) ? (g[y * n + x] ? 1 : 0) : (w1 > w0 ? 1 : 0);
      } else {
        let ones = 0;
        for (const [X, Y] of cells) ones += g[Y * n + X] ? 1 : 0;
        const cnt = cells.length;
        bit = ones * 2 > cnt ? 1 : (ones * 2 < cnt ? 0 : (g[y * n + x] ? 1 : 0));
      }
      v = (v << 1) | bit;
    }
    by.push(v);
  }
  return bytesToText(by);
}

function refsFor(S) {
  const mix = (r, g, b) => [
    Math.min(255, (r ? S.r[0] : 0) + (g ? S.g[0] : 0) + (b ? S.b[0] : 0)),
    Math.min(255, (r ? S.r[1] : 0) + (g ? S.g[1] : 0) + (b ? S.b[1] : 0)),
    Math.min(255, (r ? S.r[2] : 0) + (g ? S.g[2] : 0) + (b ? S.b[2] : 0))
  ];
  return REFBITS.map(c => ({ bits: c, col: mix(c[0], c[1], c[2]) }));
}

/**
 * Поканальний поріг за Отсу — без опори на абсолютні кольори палітри.
 * Еталонна палітра ламається від балансу білого: тепле світло тягне
 * червоний угору, синій униз, і зіставлення з абсолютним кольором
 * починає промахуватись. Розподіл усередині КАНАЛУ від цього не їде:
 * нулі лишаються знизу, одиниці зверху, поріг просто зсувається разом
 * із ними. Тому це основний шлях, а палітра — запасний.
 */
function classifyOtsu(cells, n) {
  const N = n * n;
  const cr = new Uint8Array(N), cg = new Uint8Array(N), cb = new Uint8Array(N);
  const out = [cr, cg, cb];
  let sep = 0;
  for (let c = 0; c < 3; c++) {
    const hist = new Int32Array(256);
    let mn = 255, mx = 0;
    for (let i = 0; i < N; i++) {
      const v = Math.max(0, Math.min(255, Math.round(cells[i * 3 + c])));
      hist[v]++; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    /* Канал без розмаху несе не дані, а шум: підфарбований монохром має
       порожній третій канал. Ділити шум порогом не можна — вийде хаос. */
    if (mx - mn < 40) { for (let i = 0; i < N; i++) out[c][i] = 0; continue; }
    let thr = (mn + mx) >> 1;
    {
      let sum = 0;
      for (let i = 0; i < 256; i++) sum += i * hist[i];
      let wb = 0, sb = 0, best = -1;
      for (let t = 0; t < 256; t++) {
        wb += hist[t]; if (!wb) continue;
        const wf = N - wb; if (!wf) break;
        sb += t * hist[t];
        const mb = sb / wb, mf = (sum - sb) / wf;
        const v = wb * wf * (mb - mf) * (mb - mf);
        if (v > best) { best = v; thr = t; }
      }
    }
    sep += (mx - mn);
    for (let i = 0; i < N; i++) out[c][i] = cells[i * 3 + c] > thr ? 1 : 0;
  }
  return { name: 'поканальна', cr, cg, cb, sep: sep / 3 };
}

function classifyCells(cells, n) {
  let best = null;
  for (const [name, S] of [['насичена', RGB_MAIN], ['галерейна', RGB_GAL]]) {
    const refs = refsFor(S);
    let err = 0;
    const cr = new Uint8Array(n * n), cg = new Uint8Array(n * n), cb = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const R = cells[i * 3], G = cells[i * 3 + 1], B = cells[i * 3 + 2];
      let bi = 0, bd = 1e9;
      for (let k = 0; k < refs.length; k++) {
        const q = refs[k].col;
        const dr = R - q[0], dg = G - q[1], db = B - q[2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; bi = k; }
      }
      err += bd;
      const t = refs[bi].bits;
      cr[i] = t[0]; cg[i] = t[1]; cb[i] = t[2];
    }
    if (!best || err < best.err) best = { name, err, cr, cg, cb };
  }
  return best;
}

/**
 * ЧИТАННЯ ПО ЯСКРАВОСТІ — обидві полярності.
 *
 * Пробуємо матрицю як є І перевернуту. Друге потрібне декоративним кодам,
 * де візерунок ТЕМНИЙ на світлому полі, а тиха зона лишається світлою:
 * структура рамки в такого коду звичайна (позитив), а дані — навпаки,
 * тож перевернути кадр цілком не можна, інакше розсиплеться рамка.
 * Переставити полярність лише даних — безпечно: хибне читання все одно
 * не пройде ні UTF-8, ні зворотну звірку, ні перевірку мінімальності поля.
 */
function monoRead(L, n) {
  const N = n * n;
  let lmin = 1e9, lmax = -1e9;
  for (let i = 0; i < N; i++) { const v = L[i]; if (v < lmin) lmin = v; if (v > lmax) lmax = v; }
  if (lmax - lmin < 20) return null;

  /* ТРИ ЯРУСИ ЯСКРАВОСТІ.
     Декоративний код малюється трьома фарбами: фон і дві фарби візерунка —
     скажімо біле поле, чорні й червоні клітинки. Але так само правильно
     намалювати чорне поле з червоними й білими клітинками. Яка пара фарб
     означає одиницю, з картинки невідомо, і вгадувати не треба: обидві
     групи дають свій поріг, обидві пробуємо, валідним виявиться лише один.
     Пороги шукаємо по найбільших розривах у відсортованій яскравості —
     саме там проходять межі між ярусами. */
  const thrs = [(lmin + lmax) / 2];
  const srt = Array.from(L).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < N; i++) {
    const g = srt[i] - srt[i - 1];
    if (g > 24) gaps.push({ g, t: (srt[i] + srt[i - 1]) / 2 });
  }
  gaps.sort((a, b) => b.g - a.g);
  for (const q of gaps.slice(0, 2))
    if (!thrs.some(t => Math.abs(t - q.t) < 6)) thrs.push(q.t);

  let best = null;
  for (const thr of thrs) {
    const g0 = new Uint8Array(N), conf = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      g0[i] = L[i] > thr ? 1 : 0;
      conf[i] = Math.min(1, Math.abs(L[i] - thr) / (thr / 2 + 1));
    }
    /* Полярність теж невідома: візерунок буває темним на світлому полі
       (тоді рамка звичайна, а дані перевернуті) і навпаки. */
    for (const flip of [false, true]) {
      let g = g0;
      if (flip) { g = new Uint8Array(N); for (let i = 0; i < N; i++) g[i] = g0[i] ? 0 : 1; }
      for (const m of MODES) {
        const txt = decodeVoted(g, n, m, 0, conf);
        if (txt === null) continue;
        const chk = fillChannel(txt, n, m, null);
        const a = agreeOf(g, chk, n);
        if (!best || a > best.agree)
          best = { text: txt, agree: a, mode: m, flip, thr, grid: g, chk };
      }
    }
  }
  if (!best) return null;
  best.shape = mismatchShape([[best.grid, best.chk]], n);
  return best;
}

/**
 * МОНОХРОМ ПО ОКРЕМИХ КАНАЛАХ (з 2.4).
 * Яскравість — це суміш трьох каналів, і вона гірша за найкращий з них.
 * Палітри сайту мають «несучий канал», де нитка й фон розходяться найдужче,
 * а мотив перефарбовує лише два інші канали. Тож пробуємо прочитати код
 * по яскравості і по кожному каналу R, G, B окремо; канал із шумом мотиву
 * не пройде UTF-8 і зворотну звірку, чистий — пройде. Нічия — яскравості.
 */
function monoReadAny(cells, L, n) {
  const N = n * n;
  let best = monoRead(L, n);
  if (best) best.chan = 'L';
  for (let c = 0; c < 3; c++) {
    const v = new Float64Array(N);
    for (let i = 0; i < N; i++) v[i] = cells[i * 3 + c];
    const r = monoRead(v, n);
    if (r && (!best || r.agree > best.agree + 1e-9)) { r.chan = 'RGB'[c]; best = r; }
  }
  return best;
}

/**
 * Декод снятых клеток.
 * @param cells Float64Array длиной n*n*3 — средний RGB каждой клетки
 * @param Tz    размер кольца зебры (Tz = T - 2)
 */
function decodeCells(cells, Tz) {
  const n = Tz - 2;
  if (n < 5 || n % 2 === 0) return null;
  const N = n * n;

  const L = new Float64Array(N);
  let lmin = 1e9, lmax = -1e9;
  for (let i = 0; i < N; i++) {
    const v = (cells[i*3] + cells[i*3+1] + cells[i*3+2]) / 3;
    L[i] = v; if (v < lmin) lmin = v; if (v > lmax) lmax = v;
  }
  const thr = (lmin + lmax) / 2;
  const gl = new Uint8Array(N), confM = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    gl[i] = L[i] > thr ? 1 : 0;
    confM[i] = Math.min(1, Math.abs(L[i] - thr) / (thr / 2 + 1));
  }

  const sats = new Float64Array(N);
  let coloredCnt = 0;
  for (let i = 0; i < N; i++) {
    const r = cells[i*3], g = cells[i*3+1], b = cells[i*3+2];
    sats[i] = Math.max(r, g, b) - Math.min(r, g, b);
    if (sats[i] > 60) coloredCnt++;
  }
  const sorted = Array.from(sats).sort((a, b) => a - b);
  const medSat = sorted[N >> 1];
  const isColored = medSat > 25 || coloredCnt >= Math.max(3, n * 0.15);

  if (!isColored) {
    const best = monoReadAny(cells, L, n);
    if (!best) return { kind: 'mono', text: null, agree: 0, n, colored: false };
    return { kind: 'mono', text: best.text, parts: [best.text], agree: best.agree,
             mode: best.mode, n, colored: false, palette: null, shape: best.shape,
             dataFlip: best.flip };
  }

  const clsOtsu = classifyOtsu(cells, n);
  const clsPal  = classifyCells(cells, n);
  const cls = clsOtsu;

  /* ПІДФАРБОВАНИЙ МОНОХРОМ.
     Користувач пофарбував одноколірний код з палітри: жовтий = R+G,
     блакитний = G+B. Канали при цьому несуть ОДИН І ТОЙ САМИЙ візерунок,
     а не три різні тексти. Читати такий код поканально не можна —
     вийде подвоєний або побитий текст. Читаємо по яскравості. */
  {
    const chans = [cls.cr, cls.cg, cls.cb].filter(ch => {
      let ones = 0; for (let i = 0; i < N; i++) ones += ch[i];
      return ones > N * 0.02 && ones < N * 0.98;     // канал не порожній і не суцільний
    });
    /* Канал може нести той самий візерунок ПЕРЕВЕРНУТИМ — і це нормально.
       Жовте (R+G) на темно-синьому (B): у R і G світліші одиниці, а в B
       світліші якраз нулі. Раніше такий канал вважався «іншим», код ішов
       у кольоровий розбір, синій канал не читався — і весь код відкидало
       як «втрачений канал». Тепер збіг прямий АБО повний зворотний
       означає той самий візерунок, тобто підфарбований монохром. */
    let identical = chans.length > 0;
    for (let k = 1; k < chans.length && identical; k++) {
      let same = 0;
      for (let i = 0; i < N; i++) if (chans[k][i] === chans[0][i]) same++;
      /* Допуск 3%: трохи зсунута сітка дає кілька розбіжних клітинок із
         сотень. У справжнього RGB-коду канали несуть РІЗНІ шматки тексту
         й збігаються приблизно наполовину — сплутати неможливо. */
      const f = same / N;
      if (f < 0.97 && f > 0.03) identical = false;
    }
    if (identical) {
      const best = monoReadAny(cells, L, n);
      if (best) {
        return { kind: 'mono', text: best.text, parts: [best.text], agree: best.agree,
                 mode: best.mode, n, colored: false, tinted: true,
                 palette: cls.name, shape: best.shape, dataFlip: best.flip };
      }
    }
  }
  const cR = new Float64Array(N), cG = new Float64Array(N), cB = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    cR[i] = Math.min(1, Math.abs(cells[i*3]   - 128) / 90);
    cG[i] = Math.min(1, Math.abs(cells[i*3+1] - 128) / 90);
    cB[i] = Math.min(1, Math.abs(cells[i*3+2] - 128) / 90);
  }

  /* Пробуємо ОБИДВА способи розбору кольору і беремо той, що дав кращу
     зворотну звірку. Поканальний поріг виграє на знятих камерою кадрах,
     еталонна палітра — на чистих PNG зі старою галерейною гамою.
     Обирати «перший, що спрацював» не можна: спрацьовують часто обидва,
     і хибний варіант тоді витісняє правильний. */
  /* ПОЛЯРНІСТЬ КОЖНОГО КАНАЛУ ОКРЕМО (з 2.3).
     Канали RGB-коду незалежні, тож і полярність у кожного своя: сайт уміє
     інвертувати будь-який набір каналів (8 колірних схем). Для кожного
     каналу пробуємо обидві полярності й беремо ту, що прочиталась і краще
     зійшлася зворотною звіркою. Хибна полярність не проходить UTF-8.
     Метку rmark читаємо вже в правильній полярності каналу R. */
  const flipArr = a => { const o = new Uint8Array(N); for (let i = 0; i < N; i++) o[i] = a[i] ? 0 : 1; return o; };
  function tryCls(cand) {
    const chArr = [cand.cr, cand.cg, cand.cb], confs = [cR, cG, cB];
    let bst = null;
    for (const m of MODES) {
      const res = [null, null, null];
      for (let c = 0; c < 3; c++) {
        for (const p of [0, 1]) {
          const g = p ? flipArr(chArr[c]) : chArr[c];
          let t, mk = 0;
          if (c === 0) {
            mk = markCell(g, n, m);
            t = decodeVoted(g, n, m, mk ? 1 : 0, confs[0]);
            if (mk && t === null) { t = decodeVoted(g, n, m, 0, confs[0]); mk = 0; }
          } else t = decodeVoted(g, n, m, 0, confs[c]);
          if (t === null) continue;
          const chk = fillChannel(t, n, m, c === 0 && mk ? 1 : null);
          const a = agreeOf(g, chk, n);
          if (!res[c] || a > res[c].a) res[c] = { t, g, p, a, mk, chk };
        }
      }
      const nn = res.filter(r => r);
      if (!nn.length) continue;
      const sc = nn.length * 1000 + nn.reduce((x, r) => x + r.t.length, 0);
      if (!bst || sc > bst.sc)
        bst = { vr: res[0] ? res[0].t : null, vg: res[1] ? res[1].t : null, vb: res[2] ? res[2].t : null,
                sc, m, rmark: res[0] ? res[0].mk : markCell(chArr[0], n, m), res,
                pol: res.map(r => r ? r.p : -1) };
    }
    if (!bst) return null;
    /* ВТРАЧЕНИЙ КАНАЛ: не прочитався, хоча не порожній. Порожній канал
       після інверсії стає суцільним — це теж «порожній». */
    let lost = 0;
    if (bst.rmark) {
      for (let c = 0; c < 3; c++) {
        if (bst.res[c]) continue;
        let ones = 0;
        for (let i = 0; i < N; i++) ones += chArr[c][i];
        if (ones > N * 0.02 && ones < N * 0.98) lost++;
      }
    }
    const ags = [], masks = [];
    for (const r of bst.res) { if (!r) continue; ags.push(r.a); masks.push([r.g, r.chk]); }
    const agree = ags.length ? ags.reduce((x, y) => x + y, 0) / ags.length : 0;
    return { bst, agree, masks, cand, chans: ags.length, lost };
  }

  /* ПОЛЯРНІСТЬ ФАРБ. Колір буває «світлом» (біт = світлий канал, фон
     чорний) або «фарбою на папері» (біт = канал З'ЇДЕНО, фон світлий:
     блакитний, маджента, жовтий). Сайт тепер малює RGB саме так — фон
     і тиха зона найсвітліші. Пробуємо обидві полярності; хибна не
     пройде UTF-8 і зворотну звірку, а з двох вірних перемагає повніша. */
  let pick = null;
  for (const cand of [clsOtsu, clsPal]) {
    const r = tryCls(cand);
    if (!r) continue;
    /* Порядок порівняння: спершу СКІЛЬКИ каналів вдалося прочитати —
       втрачений канал означає втрачений шматок тексту, і зворотна звірка
       цього не бачить: вона перевіряє лише те, що прочиталося. Далі —
       звірка, далі — довжина. */
    if (!pick ||
        r.chans > pick.chans ||
        (r.chans === pick.chans && r.agree > pick.agree + 1e-9) ||
        (r.chans === pick.chans && Math.abs(r.agree - pick.agree) < 1e-9 && r.bst.sc > pick.bst.sc))
      pick = r;
  }
  /* ДЕКОРАТИВНИЙ МОНОХРОМ (вишиванка).
     Візерунок намальовано ДВОМА фарбами — скажімо червоною і чорною — на
     світлому полі. Обидві фарби означають ту саму одиницю, колір тут суто
     оздоблення й даних не несе. Поканальний розбір такий код ламає: у
     червоному каналі червона фарба світла, а чорна темна, і канал виходить
     несхожий на інші — перевірка «однакових каналів» вище його не ловить.
     Але по ЯСКРАВОСТІ все на місці: обидві фарби темні, поле світле.
     Тож пробуємо прочитати по яскравості й беремо це читання, коли воно
     СТРОГО краще за кольорове за зворотною звіркою. Справжній RGB-код так
     не відібрати: його яскравість — суміш трьох текстів, яка в UTF-8 не
     складається, а якщо раптом складеться, то гірше за поканальне читання.
     Нічия завжди лишається кольоровому. Мітку rmark тут за ознаку брати
     не можна: це одна центральна клітинка червоного каналу, і в
     декоративному коді вона буває одиницею випадково. */
  const monoAlt = monoReadAny(cells, L, n);
  /* ПЕРЕВІРКА «ОДИН ТЕКСТ У ТРЬОХ КАНАЛАХ».
     Генератор ділить текст на три послідовні третини (по символах). Якщо
     прочитані канали так не складаються — це не RGB-код, а одноколірний
     візерунок, який кілька каналів побачили КОЖЕН ЦІЛКОМ (вишиванка: у
     G і B той самий орнамент). Такий код читаємо по яскравості. */
  let monolithBad = false;
  if (pick && pick.bst.rmark) {
    const ps = [pick.bst.vr, pick.bst.vg, pick.bst.vb];
    const whole = ps.map(t => t || '').join('');
    const ch = [...whole], k = Math.ceil(ch.length / 3);
    const want = [ch.slice(0, k).join(''), ch.slice(k, 2 * k).join(''), ch.slice(2 * k).join('')];
    monolithBad = ps.some((t, i) => (t || '') !== want[i]);
  }
  const monoWins = monoAlt && monoAlt.agree >= CFG.AGREE_MIN &&
                   (!pick || monolithBad ||
                    (monoAlt.agree > pick.agree + 1e-9 && pick.chans < 3 &&
                     /* канал-одиночка не перебиває справжній RGB-моноліт:
                        у нього кожен канал — окрема третина тексту */
                     (monoAlt.chan === 'L' || !pick.bst.rmark)));
  if (monoWins) {
    return { kind: 'mono', text: monoAlt.text, parts: [monoAlt.text],
             agree: monoAlt.agree, mode: monoAlt.mode, n, colored: false,
             tinted: true, decorative: true, palette: cls.name,
             shape: monoAlt.shape, dataFlip: monoAlt.flip };
  }

  if (!pick) return { kind: 'color', text: null, agree: 0, n, colored: true, palette: cls.name };

  const best = pick.bst, useCls = pick.cand, agree = pick.agree;
  const lostChannels = pick.lost;
  const shape = mismatchShape(pick.masks, n);

  const parts = [best.vr, best.vg, best.vb].filter(t => t !== null);
  /* ОДНАКОВИЙ ТЕКСТ У КАНАЛАХ БЕЗ КОЛЬОРОВОЇ МІТКИ = ОДИН ТЕКСТ.
     Це підфарбований монохром, який канали прочитали кожен окремо. */
  if (!best.rmark && parts.length > 1 && parts.every(t => t === parts[0])) {
    return { kind: 'mono', text: parts[0], parts: [parts[0]], agree, shape,
             lostChannels: 0, mode: best.m, n, colored: false, tinted: true,
             palette: useCls.name };
  }
  const text = best.rmark
    /* rmark=1 тепер означає, що R прочитався саме зі зсувом на мітку, —
       це справжній «один текст у трьох каналах». Однакові третини
       («666» → «6»,«6»,«6») склеюємо, а не схлопуємо в одну. */
    ? parts.join('')
    : parts.join(' · ');

  return { kind: best.rmark ? 'monolith' : 'three', text, parts, agree, shape,
           lostChannels,
           mode: best.m, n, colored: true, palette: useCls.name, rmark: best.rmark,
           channels: [best.vr, best.vg, best.vb],
           /* інверсія каналу відносно стандарту сайту (біт = канал «з'їдено»):
              1 — канал інвертовано, 0 — ні, null — порожній канал */
           chanInv: best.pol.map((p, c) => {
             if (p >= 0) return 1 - p;
             /* порожній канал: полярність видно з фону — світлий фон
                у каналі означає стандарт сайту */
             const a = [useCls.cr, useCls.cg, useCls.cb][c];
             let ones = 0; for (let i = 0; i < N; i++) ones += a[i];
             return ones > N / 2 ? 0 : 1;
           }) };
}

/* ═════════════════════ ЧАСТЬ 2. ГЕОМЕТРИЯ ═════════════════════
   Гомография своя, чистый JS — чтобы выборка пикселей всегда шла
   из оригинального кадра, без промежуточных canvas и пересэмплингов.
   ══════════════════════════════════════════════════════════════ */

function gaussElim(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let mr = c, mv = Math.abs(M[c][c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > mv) { mv = Math.abs(M[r][c]); mr = r; }
    [M[c], M[mr]] = [M[mr], M[c]];
    const pv = M[c][c];
    if (Math.abs(pv) < 1e-12) return null;
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / pv;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

function computeH(s4, d4) {
  const rows = [], rhs = [];
  for (let i = 0; i < 4; i++) {
    const sx = s4[i][0], sy = s4[i][1], dx = d4[i][0], dy = d4[i][1];
    rows.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); rhs.push(dx);
    rows.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); rhs.push(dy);
  }
  const h = gaussElim(rows, rhs);
  if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

function applyH(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w,
          (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

/** Порядок углов: TL, TR, BR, BL */
function orderCorners(pts) {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
  const withA = pts.map(p => ({ p, a: Math.atan2(p[1] - cy, p[0] - cx) }));
  withA.sort((u, v) => u.a - v.a);
  let s = 0, bd = Infinity;
  withA.forEach((u, i) => {
    let d = Math.abs(u.a - (-3 * Math.PI / 4));
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < bd) { bd = d; s = i; }
  });
  const out = [];
  for (let i = 0; i < 4; i++) out.push(withA[(s + i) % 4].p);
  return out;
}

function squareness(p) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sides = [d(p[0],p[1]), d(p[1],p[2]), d(p[2],p[3]), d(p[3],p[0])];
  const mn = Math.min(...sides), mx = Math.max(...sides);
  if (mx === 0) return 0;
  const d1 = d(p[0], p[2]), d2 = d(p[1], p[3]);
  return (mn / mx) * (Math.min(d1, d2) / Math.max(d1, d2));
}

function meanSide(p) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return (d(p[0],p[1]) + d(p[1],p[2]) + d(p[2],p[3]) + d(p[3],p[0])) / 4;
}

/**
 * Сжать (k>0) или расширить (k<0) квадрат на k модулей — через ту же гомографию.
 * Работает в координатах ОРИГИНАЛЬНОГО кадра: никакой обрезки готового warp-а.
 */
function insetCorners(pts, kMod, Tz, S) {
  S = S || 1000;
  const dst = [[0,0],[S,0],[S,S],[0,S]];
  const H = computeH(dst, pts);      // warp-квадрат → оригинал
  if (!H) return null;
  const d = kMod * (S / Tz);
  const box = [[d,d],[S-d,d],[S-d,S-d],[d,S-d]];
  return box.map(([x, y]) => applyH(H, x, y));
}

/** Стиск в долях стороны — когда Tz ещё неизвестен (контур поймал обводку/поле) */
function insetCornersFrac(pts, frac, S) {
  S = S || 1000;
  const dst = [[0,0],[S,0],[S,S],[0,S]];
  const H = computeH(dst, pts);
  if (!H) return null;
  const d = frac * S;
  const box = [[d,d],[S-d,d],[S-d,S-d],[d,S-d]];
  return box.map(([x, y]) => applyH(H, x, y));
}

/**
 * Який канал нести структуру. Підфарбований код може майже не мати
 * контрасту в яскравості: жовте чорнило на кремовому тлі дає розкид 12,
 * а в синьому каналі — 79. Шукати зебру по яскравості там марно.
 */
function pickStructureChannels(px, W, H0) {
  let step = Math.max(1, Math.floor((W * H0) / 20000)) * 4;
  const s = [0, 0, 0, 0], s2 = [0, 0, 0, 0];
  let N = 0;
  for (let i = 0; i + 3 < px.length; i += step) {
    const r = px[i], g = px[i+1], b = px[i+2];
    const v = [(r * 77 + g * 150 + b * 29) >> 8, r, g, b];
    for (let k = 0; k < 4; k++) { s[k] += v[k]; s2[k] += v[k] * v[k]; }
    N++;
  }
  if (!N) return [-1];
  const sd = [];
  for (let k = 0; k < 4; k++) {
    const mu = s[k] / N;
    sd.push(Math.sqrt(Math.max(0, s2[k] / N - mu * mu)));
  }
  /* Яскравість першою, далі канали за спаданням розкиду (з 2.4).
     У палітр сайту рамка найчистіша в несучому каналі, а мотив додає
     розкиду іншим каналам — тож пробуємо всі помітні канали. */
  const chans = [0, 1, 2].filter(c => sd[c + 1] > 20).sort((a, b) => sd[b + 1] - sd[a + 1]);
  return [-1].concat(chans);
}

/** Быстрый warp в серое, ближайший сосед — для проверки гипотез.
 *  ch: -1 — яскравість, 0/1/2 — окремий канал R/G/B. */
function warpGrayNN(px, W, H0, pts, S, ch) {
  const H = computeH([[0,0],[S,0],[S,S],[0,S]], pts);
  if (!H) return null;
  const out = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const w = H[2][0] * i + H[2][1] * j + H[2][2];
      const x = (H[0][0] * i + H[0][1] * j + H[0][2]) / w;
      const y = (H[1][0] * i + H[1][1] * j + H[1][2]) / w;
      const xi = x | 0, yi = y | 0;
      if (xi < 0 || yi < 0 || xi >= W || yi >= H0) { out[j * S + i] = 127; continue; }
      const p = (yi * W + xi) * 4;
      out[j * S + i] = (ch == null || ch < 0)
        ? (px[p] * 77 + px[p+1] * 150 + px[p+2] * 29) >> 8
        : px[p + ch];
    }
  }
  return out;
}

/** Точный warp в RGB, билинейный — только для финального кандидата */
function warpRGB(px, W, H0, pts, S) {
  const H = computeH([[0,0],[S,0],[S,S],[0,S]], pts);
  if (!H) return null;
  const out = new Float32Array(S * S * 3);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const w = H[2][0] * i + H[2][1] * j + H[2][2];
      const x = (H[0][0] * i + H[0][1] * j + H[0][2]) / w;
      const y = (H[1][0] * i + H[1][1] * j + H[1][2]) / w;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const o = (j * S + i) * 3;
      for (let c = 0; c < 3; c++) {
        const g = (sx, sy) => {
          if (sx < 0 || sy < 0 || sx >= W || sy >= H0) return 127;
          return px[(sy * W + sx) * 4 + c];
        };
        out[o + c] = g(x0, y0) * (1-fx) * (1-fy) + g(x0+1, y0) * fx * (1-fy)
                   + g(x0, y0+1) * (1-fx) * fy   + g(x0+1, y0+1) * fx * fy;
      }
    }
  }
  return out;
}

/* ═════════════════════ ЧАСТЬ 3. ЗЕБРА И СТРУКТУРА ═════════════════════ */

/**
 * Определение Tz по кольцу зебры. Голосование по четырём сторонам:
 * если одну сторону убил блик, остальные три вытягивают.
 */
function verifyZebra(gray, S) {
  if (!gray || gray.length < S * S) return null;
  function scanLine(arr) {
    let mn = 255, mx = 0;
    for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < CFG.MIN_CONTRAST) return null;
    const thr = (mn + mx) >> 1, runs = [];
    let cur = arr[0] > thr ? 1 : 0, len = 1;
    for (let i = 1; i < arr.length; i++) {
      const b = arr[i] > thr ? 1 : 0;
      if (b === cur) len++; else { runs.push({ v: cur, len }); cur = b; len = 1; }
    }
    runs.push({ v: cur, len });
    if (runs.length < 3) return null;
    const lens = runs.map(r => r.len).sort((a, b) => a - b);
    const med = lens[lens.length >> 1];
    if (med < 2) return null;
    const valid = runs.filter(r => r.len >= med * 0.4 && r.len <= med * 2.4);
    if (valid.length < 5) return null;
    let T = valid.length;
    if (T % 2 === 0) {
      if (valid[0].v === 1 || valid[T-1].v === 1) T += 1; else return null;
    }
    if (T < CFG.T_MIN - 2 || T > CFG.T_MAX) return null;
    return T;
  }

  const offs = [0.006, 0.011, 0.02, 0.033, 0.05, 0.075].map(f => Math.max(1, Math.round(S * f)));
  const votes = new Map();
  let total = 0;
  const row = new Uint8Array(S), col = new Uint8Array(S);
  for (const off of offs) {
    if (off >= S / 2) continue;
    for (const pos of [off, S - 1 - off]) {
      for (let x = 0; x < S; x++) row[x] = gray[pos * S + x];
      let t = scanLine(row); if (t) votes.set(t, (votes.get(t) || 0) + 1);
      total++;
      for (let y = 0; y < S; y++) col[y] = gray[y * S + pos];
      t = scanLine(col); if (t) votes.set(t, (votes.get(t) || 0) + 1);
      total++;
    }
  }
  if (!votes.size) return null;
  const sortedV = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  return { Tz: sortedV[0][0], conf: sortedV[0][1] / Math.max(1, total),
           votes: sortedV.slice(0, 5) };
}

/** Качество кольца зебры: тёмные углы + чередование по периметру */
function zebraRing(gray, S, Tz) {
  const mod = S / Tz;
  const cell = (r, c) => {
    const y0 = Math.floor(r * mod + mod * 0.3), y1 = Math.floor(r * mod + mod * 0.7);
    const x0 = Math.floor(c * mod + mod * 0.3), x1 = Math.floor(c * mod + mod * 0.7);
    let s = 0, cnt = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= S || y >= S) continue;
      s += gray[y * S + x]; cnt++;
    }
    return cnt ? s / cnt : 0;
  };
  const vals = [];
  for (let c = 0; c < Tz; c++) vals.push(cell(0, c));
  for (let c = 0; c < Tz; c++) vals.push(cell(Tz - 1, c));
  for (let r = 0; r < Tz; r++) vals.push(cell(r, 0));
  for (let r = 0; r < Tz; r++) vals.push(cell(r, Tz - 1));
  let mn = Infinity, mx = -Infinity;
  for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const thr = (mn + mx) / 2;
  const bits = vals.map(v => v > thr ? 1 : 0);
  let alt = 0, tot = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < Tz - 1; j++) {
      if (bits[i * Tz + j] !== bits[i * Tz + j + 1]) alt++;
      tot++;
    }
  }
  const corners = [cell(0,0), cell(0,Tz-1), cell(Tz-1,Tz-1), cell(Tz-1,0)];
  const cornersDark = corners.filter(c => c < thr).length / 4;
  return { alt: alt / Math.max(1, tot), cornersDark };
}

/**
 * ГЛАВНЫЙ ЗАЩИТНЫЙ ФИЛЬТР.
 * Проверяет канонический инвариант TAINA снаружи внутрь:
 *   белое поле → чёрная полоска → белая полоска → зебра
 * Мусор — это всегда кусок, вырезанный из середины другого кода: внутри он
 * похож на валидный TAINA, но снаружи у него вместо рамки чужие данные.
 * Подделать это вырезкой невозможно.
 * Снимаем ПРЯМО ИЗ ОРИГИНАЛЬНОГО кадра.
 */
function outerFrameScore(px, W, H0, pts, Tz, ch) {
  /* Кількість точок на сторону — не менше двох на модуль.
     Було жорстко 20: при Tz=43 крок між точками виходив рівно 2 модулі,
     усі точки падали на клітинки ОДНОГО кольору зебри, і перевірка
     «не бачила» чергування — правильну рамку відкидало (стробоскоп).
     Так не читалися коди з полем 41×41. Два відліки на модуль гарантують,
     що обидва кольори зебри потрапляють у вибірку на будь-якому розмірі. */
  const NS = Math.max(20, Math.ceil(Tz * 2.2));
  const ringAt = (radMod) => {
    const p = insetCorners(pts, -radMod, Tz);
    if (!p) return null;
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      for (let s = 0; s < NS; s++) {
        const t = 0.05 + (0.9 * s) / (NS - 1);
        const x = Math.round(a[0] + (b[0] - a[0]) * t);
        const y = Math.round(a[1] + (b[1] - a[1]) * t);
        if (x < 0 || y < 0 || x >= W || y >= H0) continue;
        const q = (y * W + x) * 4;
        out.push((ch == null || ch < 0)
          ? (px[q] * 77 + px[q+1] * 150 + px[q+2] * 29) >> 8
          : px[q + ch]);
      }
    }
    return out.length >= 40 ? out : null;
  };

  const zeb = ringAt(-0.5);     // само кольцо зебры — эталон контраста
  if (!zeb) return { score: 0, wOk: 0, bOk: 0, reason: 'кольца вне кадра' };

  const sz = [...zeb].sort((a, b) => a - b);
  const lo = sz[Math.floor(sz.length * 0.1)], hi = sz[Math.floor(sz.length * 0.9)];
  if (hi - lo < 30) return { score: 0, wOk: 0, bOk: 0, reason: 'нет контраста зебры' };
  const thr = (lo + hi) / 2;

  /* Радіус беремо з допуском (з 1.9). Кут квадрата визначено з точністю
     до кількох пікселів, і для великого коду (модуль 10 px) це половина
     модуля: кільце з'їжджає на межу смужки й валить цілий код. */
  const best = (radii, pred) => {
    let v = -1;
    for (const r of radii) { const w = ringAt(r); if (!w) continue;
      const f = w.filter(pred).length / w.length; if (f > v) v = f; }
    return v;
  };
  const wOk = Math.max(0, best([0.40, 0.50, 0.62], x => x > thr));
  const bOk = Math.max(0, best([1.30, 1.50, 1.70], x => x < thr));
  const quietF = best([2.40, 2.60, 2.85], x => x > thr);
  /* ТИХА ЗОНА. Генератор завжди лишає навколо коду світле поле у 2 модулі.
     Шматок із середини орнаменту (центр будь-якого орнаменту симетричний
     і буває схожий на маленьку рамку) такого поля не має — навколо нього
     чужий візерунок. Саме так у негативах знаходився хибний «код» «5».
     Якщо поле вийшло за кадр (код знято впритул), не караємо. */
  const qOk = quietF < 0 ? 1 : quietF;
  return { score: wOk * bOk * qOk, wOk, bOk, qOk, thr };
}

/** Выборка клеток данных: круг радиусом 0.28 модуля в центре каждой клетки */
function sampleCells(rgb, S, Tz) {
  const n = Tz - 2, mod = S / Tz, r = mod * 0.28, r2 = r * r;
  const out = new Float64Array(n * n * 3);
  let idx = 0;
  for (let row = 1; row < Tz - 1; row++) {
    for (let col = 1; col < Tz - 1; col++) {
      const cx = col * mod + mod / 2, cy = row * mod + mod / 2;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(S - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(S - 1, Math.ceil(cy + r));
      let sR = 0, sG = 0, sB = 0, cnt = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > r2) continue;
          const o = (y * S + x) * 3;
          sR += rgb[o]; sG += rgb[o+1]; sB += rgb[o+2]; cnt++;
        }
      }
      if (cnt) { out[idx] = sR/cnt; out[idx+1] = sG/cnt; out[idx+2] = sB/cnt; }
      idx += 3;
    }
  }
  return out;
}

/* ═════════════════════ ЧАСТЬ 4. ПОИСК КАНДИДАТОВ ═════════════════════
   Методы взяты из Data Matrix: контуры → четырёхугольник → проверка
   квадратности → гомография. Это универсальная часть локализации.
   Формат TAINA при этом не меняется — зебра остаётся зеброй.
   ═════════════════════════════════════════════════════════════════════ */

function findQuadsCV(canvas, W, H) {
  if (!window.cv || !window.cv.Mat || !window.cv.imread) return null;
  const cv = window.cv;
  const mats = [];
  try {
    const src = cv.imread(canvas); mats.push(src);
    const gray = new cv.Mat(); mats.push(gray);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blur = new cv.Mat(); mats.push(blur);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const bin = new cv.Mat(); mats.push(bin);
    let bs = Math.floor(Math.min(W, H) / 20) * 2 + 1;
    bs = Math.max(11, Math.min(151, bs));
    cv.adaptiveThreshold(blur, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, bs, 7);
    const contours = new cv.MatVector(); mats.push(contours);
    const hier = new cv.Mat(); mats.push(hier);
    cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const minA = W * H * 0.002, maxA = W * H * 0.98;
    const quads = [];
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < minA || area > maxA) { cnt.delete(); continue; }
      const peri = cv.arcLength(cnt, true);
      const ap = new cv.Mat();
      cv.approxPolyDP(cnt, ap, 0.04 * peri, true);
      if (ap.rows === 4 && cv.isContourConvex(ap)) {
        const pts = [];
        for (let p = 0; p < 4; p++) pts.push([ap.data32S[p*2], ap.data32S[p*2+1]]);
        const ord = orderCorners(pts);
        const sq = squareness(ord);
        if (sq > CFG.SQUARENESS_MIN) quads.push({ pts: ord, area, sq });
      }
      ap.delete(); cnt.delete();
    }
    quads.sort((a, b) => b.area - a.area);
    return quads;
  } catch (e) {
    return null;
  } finally {
    mats.forEach(m => { try { m.delete(); } catch (e) {} });
  }
}

/* ═════════════════════ ЧАСТЬ 5. КОНВЕЙЕР ═════════════════════ */

function sourceToCanvas(src) {
  if (src instanceof HTMLCanvasElement) return src;
  const w = src.naturalWidth || src.videoWidth || src.width;
  const h = src.naturalHeight || src.videoHeight || src.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, w, h);
  return c;
}

function downscaleCanvas(canvas, maxSide) {
  const w = canvas.width, h = canvas.height;
  if (Math.max(w, h) <= maxSide) return { canvas, scale: 1 };
  const s = maxSide / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return { canvas: c, scale: s };
}

/**
 * Главная функция декодирования.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement} source
 * @param {Object} [opts]
 *        opts.mode        'image' (по умолчанию) | 'camera'
 *        opts.diagnostic  true → подробный отчёт по этапам
 *        opts.roiHint     четыре угла предыдущего успеха (трекинг кандидата)
 *        opts.maxQuads, opts.timeBudgetMs — переопределение лимитов
 * @returns {Object} результат — см. описание в конце файла
 */
function decode(source, opts) {
  opts = opts || {};
  const t0 = performance.now();
  const diag = { stages: [], candidates: [], rejected: [] };
  const mark = (name, extra) => {
    diag.stages.push(Object.assign({ stage: name, ms: +(performance.now() - t0).toFixed(1) }, extra || {}));
  };

  /* ── FRAME: оригинальный кадр. Из него и только из него берутся пиксели ── */
  let full;
  try { full = sourceToCanvas(source); }
  catch (e) { return fail('не удалось прочитать изображение', diag, t0); }
  const W = full.width, H = full.height;
  if (!W || !H) return fail('пустой кадр', diag, t0);
  const fctx = full.getContext('2d', { willReadFrequently: true });
  const px = fctx.getImageData(0, 0, W, H).data;
  mark('FRAME', { w: W, h: H });

  /* ── CANDIDATES: контуры ищем на уменьшенной копии,
        координаты сразу возвращаем в систему оригинала ── */
  const { canvas: small, scale } = downscaleCanvas(full, CFG.DETECT_MAX);
  /* opts.quads — тестовий вхід: готові контури в координатах оригіналу
     (для автотестів без OpenCV). На сайті не використовується. */
  let quads = opts.quads ? null : findQuadsCV(small, small.width, small.height);
  const cvUsed = quads !== null;
  if (opts.quads) {
    quads = opts.quads;
    mark('CANDIDATES', { found: quads.length, injected: true });
  } else if (!quads || !quads.length) {
    const m = Math.min(W, H), ox = (W - m) / 2, oy = (H - m) / 2;
    quads = [{ pts: [[ox,oy],[ox+m,oy],[ox+m,oy+m],[ox,oy+m]], area: m*m, sq: 1 }];
    mark('CANDIDATES', { found: 0, fallback: 'весь кадр', opencv: cvUsed,
                         note: cvUsed ? '' : 'OpenCV ще не готовий — чекай TainaDecoder.ready' });
  } else {
    quads = quads.map(q => ({
      pts: q.pts.map(([x, y]) => [x / scale, y / scale]),
      area: q.area / (scale * scale), sq: q.sq
    }));
    mark('CANDIDATES', { found: quads.length, detectScale: +scale.toFixed(3), opencv: true });
  }

  /* НЕГАТИВ (як інвертовані QR-коди): світлі одиниці стали темними,
     тиха зона — темною. Якщо звичайний прохід нічого не знайшов,
     перевертаємо яскравість кадру й пробуємо ще раз тими самими
     контурами: межі кілець рамки від інверсії не зсуваються.
     opts.invert: 'auto' (за замовчуванням) — звичайний, потім негатив;
                  true — тільки негатив; false — тільки звичайний.
     Камера чергує true/false по кадрах, щоб не подвоювати час кадру. */
  const inv = opts.invert === undefined ? 'auto' : opts.invert;
  const runPass = (neg) => {
    let buf = px;
    if (neg) {
      buf = new Uint8ClampedArray(px.length);
      for (let i = 0; i < px.length; i += 4) {
        buf[i] = 255 - px[i]; buf[i+1] = 255 - px[i+1]; buf[i+2] = 255 - px[i+2]; buf[i+3] = px[i+3];
      }
    }
    const d = neg ? { stages: [], candidates: [], rejected: [] } : diag;
    const res = decodePixels(buf, W, H, quads, opts, d, mark, neg ? performance.now() : t0);
    if (res.ok && neg) res.negative = true;
    return res;
  };
  /* СЛАБКИЙ РЕЗУЛЬТАТ. Код із полем 11×11 і менше несе 1–2 байти — це
     слабкий доказ. Симетричний орнамент, розглянутий «грубою сіткою»
     (одна клітинка = кілька справжніх), теж виходить симетричним і може
     зійти за такий маленький код: так у негативах читалося хибне «5».
     Тому для слабкого результату ОБОВ'ЯЗКОВО перевіряємо і другий варіант
     (перевернутий або звичайний) і віримо більшому коду. Справжній
     маленький код не страждає: якщо другий прохід нічого не знайшов,
     лишається перший. */
  const weak = (x) => x && x.ok && x.n <= 11;
  const order = inv === true ? [true, false] : [false, true];
  let best = runPass(order[0]);
  /* НЕПІДТВЕРДЖЕНИЙ РЕЗУЛЬТАТ (з 2.4). Якщо перший прохід дав лише
     одне читання без повної згоди, на файлі перевіряємо й другу
     полярність: у негативі звичайний прохід інколи приймає дрібний
     шматок усередині коду, а цілий код читається перевернутим. */
  const shaky = (x) => x && x.ok && opts.mode !== 'camera' &&
                 !(x.confidence.votes >= 2 && x.confidence.agree >= 0.999);
  const needSecond = (inv === 'auto' && (!best.ok || shaky(best))) || weak(best);
  if (needSecond) {
    const sec = runPass(order[1]);
    const bl = x => _enc.encode(x.text || '').length;
    if (sec.ok && (!best.ok || bl(sec) > bl(best) || (bl(sec) === bl(best) && sec.T > best.T))) best = sec;
  }
  return best;
}

/**
 * Ядро конвейера: работает с уже готовым буфером оригинала и списком кандидатов.
 * Вынесено отдельно, чтобы его можно было прогонять автотестами без DOM.
 */
function decodePixels(px, W, H, quads, opts, diag, mark, t0) {
  opts = opts || {};
  t0 = t0 != null ? t0 : performance.now();
  diag = diag || { stages: [], candidates: [], rejected: [] };
  mark = mark || function () {};
  const preset = opts.mode === 'camera' ? CFG.CAMERA : CFG.IMAGE;
  const maxQuads     = opts.maxQuads     != null ? opts.maxQuads     : preset.maxQuads;
  const timeBudgetMs = opts.timeBudgetMs != null ? opts.timeBudgetMs : preset.timeBudgetMs;

  if (opts.roiHint && opts.roiHint.length === 4) {
    quads = [{ pts: opts.roiHint, area: 0, sq: 1, tracked: true }].concat(quads);
  }
  quads = quads.slice(0, maxQuads + (opts.roiHint ? 1 : 0));

  const accepted = [];
  let evaluated = 0;
  const SCs = pickStructureChannels(px, W, H);
  if (SCs.length > 1) diag.structureChannels = SCs;

  /* ДВА ЕТАПИ. Швидкий — як у 1.8: проба 360 px, без додаткових проб.
     Його вистачає для всіх кодів до ~80×80 і він укладається в бюджет кадру
     камери. Глибокий (з 1.9: проба росте за кандидатом, точні модульні
     гіпотези під кожен знайдений розмір) запускається ЛИШЕ коли швидкий
     нічого не знайшов — він потрібен великим кодам і коштує вдвічі дорожче. */
  for (const deep of [false, true]) {
  /* Глибокий етап — лише для файлу. На камері великі коди однаково не
     читаються (замало пікселів на модуль), а кадр мусить бути швидким. */
  if (deep && (accepted.length || opts.mode === 'camera' || performance.now() - t0 > timeBudgetMs)) break;
  for (const SC of SCs) {
  outer:
  for (let qi = 0; qi < quads.length; qi++) {
    if (performance.now() - t0 > timeBudgetMs) { diag.timeout = true; break; }
    const q = quads[qi];

    /* FINDER: грубая оценка Tz на дешёвом warp-е из ОРИГИНАЛА.
       Неудача здесь — НЕ повод бросать кандидата: контур мог зацепиться за
       чёрную обводку или за белое поле, где на срезе зебры просто нет. */
    const probeS = !deep ? CFG.PROBE_SIZE : Math.max(CFG.PROBE_SIZE,
                   Math.min(CFG.PROBE_MAX, Math.round(meanSide(q.pts) * 0.9)));
    const probe0 = warpGrayNN(px, W, H, q.pts, probeS, SC);
    if (!probe0) { diag.rejected.push({ q: qi, why: 'гомография не решилась' }); continue; }
    const z0 = verifyZebra(probe0, probeS);

    /* Гипотезы стиска: модульные (если Tz уже известен) плюс долевые.
       Долевые нужны для мелких кодов, где один модуль — десятая часть стороны
       и промахнуться на модуль означает промахнуться мимо всего кода. */
    const hyp = [];
    /* Крок підбору стиску мусить бути МЕНШИЙ за модуль (з 1.9). У великого
       коду долева сітка перестрибує через потрібне положення, тож спершу
       з'ясовуємо Tz дешевими пробами, а тоді додаємо точні модульні гіпотези. */
    const seenTz = new Set();
    if (z0) seenTz.add(z0.Tz);
    for (const f of CFG.INSETS_FRAC) {
      hyp.push({ frac: f, label: f.toFixed(3) });
      if (f === 0 || !deep) continue;
      const pp = insetCornersFrac(q.pts, f);
      if (!pp) continue;
      const zz = verifyZebra(warpGrayNN(px, W, H, pp, probeS, SC) || [], probeS);
      if (zz) seenTz.add(zz.Tz);
    }
    for (const tz of seenTz)
      for (const k of CFG.INSETS)
        hyp.push({ frac: k / tz, label: k + 'мод/' + tz });
    const seen = [];
    const uniq = hyp.filter(h => {
      if (seen.some(v => Math.abs(v - h.frac) < 0.004)) return false;
      seen.push(h.frac); return true;
    });

    for (const h of uniq) {
      if (performance.now() - t0 > timeBudgetMs) { diag.timeout = true; break outer; }

      /* CORNERS: стиск в координатах оригинала, через ту же гомографию.
         Готовый warp никогда не обрезаем — это сдвигает сетку. */
      const pts = h.frac === 0 ? q.pts : insetCornersFrac(q.pts, h.frac);
      if (!pts) continue;

      const probe = warpGrayNN(px, W, H, pts, probeS, SC);
      if (!probe) continue;
      const z = verifyZebra(probe, probeS);
      if (!z) continue;
      /* КІЛЬКА КАНДИДАТІВ РОЗМІРУ.
         Підрахунок смужок зебри іноді дає нічию між справжнім Tz і вдвічі
         меншим (на 65×65: 8 голосів за 67 і 8 за 33). Раніше бралося перше
         за порядком — і часто хибне. Тепер перевіряємо всіх, хто набрав
         не менше 3/4 голосів лідера: хибний розмір відсіє перевірка рамки. */
      const topV = z.votes[0][1];
      const tzCands = z.votes.filter(v => v[1] >= Math.max(2, topV * 0.75)).slice(0, 3).map(v => v[0]);
      for (const Tz of tzCands) {
      const T = Tz + 2, n = Tz - 2;
      if (T < CFG.T_MIN || T > CFG.T_MAX || n < 5 || n % 2 === 0) continue;

      const ring = zebraRing(probe, probeS, Tz);

      /* ПРОВЕРКА 1: структура внешней рамки — снимается прямо из оригинала */
      const frame = outerFrameScore(px, W, H, pts, Tz, SC);
      evaluated++;
      if (frame.score < CFG.FRAME_MIN) {
        diag.rejected.push({ q: qi, k: h.label, T, why: 'структура рамки',
                             frame: +frame.score.toFixed(2),
                             wOk: +frame.wOk.toFixed(2), bOk: +frame.bOk.toFixed(2) });
        continue;
      }

      /* WARP + GRID + RGB: точная выборка ИЗ ОРИГИНАЛА */
      const side = meanSide(pts);
      const S = Math.max(CFG.FINAL_MIN, Math.min(CFG.FINAL_MAX,
                Math.round(Math.max(side, Tz * 8))));
      const rgb = warpRGB(px, W, H, pts, S);
      if (!rgb) continue;
      const cells = sampleCells(rgb, S, Tz);

      /* DECODE */
      const dec = decodeCells(cells, Tz);
      if (!dec || dec.text === null) {
        diag.rejected.push({ q: qi, k: h.label, T, why: 'декод пустой',
                             frame: +frame.score.toFixed(2) });
        continue;
      }

      /* ПРОВЕРКА 2: обратная сверка — текст обратно в орнамент и сравнение */
      /* Розбіжності допустимі, якщо це ОДНА компактна пляма: перекритий
         кутик, блік, палець. Симетрія ×8 дублює кожен біт 4–8 разів, тож
         голосування відновлює текст навіть коли октант закритий цілком.
         Розсипані розбіжності — навпаки, ознака випадкового збігу. */
      const sh = dec.shape || { frac: 1, bbox: 1 };
      const blobOk = dec.agree >= CFG.AGREE_BLOB &&
                     sh.frac <= CFG.BLOB_MAX_AREA &&
                     sh.bbox <= CFG.BLOB_MAX_BBOX;
      if (dec.agree < CFG.AGREE_MIN && !blobOk) {
        diag.rejected.push({ q: qi, k: h.label, T, why: 'обратная сверка',
                             agree: +dec.agree.toFixed(3),
                             plama: +sh.frac.toFixed(2), gabarit: +sh.bbox.toFixed(2),
                             text: dec.text.slice(0, 20) });
        continue;
      }

      /* ПЕРЕВІРКА 2б: цілісність каналів. Обрізаний текст гірший за
         відмову: його не видно на око, і людина розносить його далі. */
      if (dec.lostChannels) {
        diag.rejected.push({ q: qi, k: h.label, T, why: 'втрачено канал',
                             lost: dec.lostChannels, agree: +dec.agree.toFixed(3),
                             text: dec.text.slice(0, 20) });
        continue;
      }

      /* ПЕРЕВІРКА 3: мінімальність поля.
         Генератор обирає найменше поле під обсяг даних. Якщо знятий текст
         влазить у менше поле — сітку зсунуто або це випадковий збіг. */
      {
        const ps = dec.parts || [dec.text];
        let bits = 0;
        for (const t of ps) if (t) bits = Math.max(bits, _enc.encode(t).length * 8);
        if (dec.rmark) bits += 1;
        const want = minimalOctN(bits);
        /* Запас у два кроки. Точну рівність вимагати НЕ можна: старі коди
           з галереї зроблені попередніми версіями генератора, де розкладка
           тексту по каналах була іншою, і в них n на крок більше за нинішню
           формулу. А от текст, що влазить у поле на два кроки менше, —
           це вже не варіація генератора, це зсунута сітка. */
        if (want <= n - 4) {
          diag.rejected.push({ q: qi, k: h.label, T, why: 'поле завелике для даних',
                               n, expected: want, text: dec.text.slice(0, 20) });
          continue;
        }
      }

      accepted.push({
        text: dec.text, parts: dec.parts || [dec.text], T, n, Tz,
        mode: dec.mode, kind: dec.kind, colored: dec.colored, palette: dec.palette,
        agree: dec.agree, frame: frame.score, zebraConf: z.conf,
        shape: dec.shape, tinted: !!dec.tinted, rmark: !!dec.rmark,
        alt: ring.alt, cornersDark: ring.cornersDark,
        corners: pts, quad: qi, inset: h.label, warpSize: S,
        channels: dec.channels || null, chanInv: dec.chanInv || null
      });
      diag.candidates.push({ q: qi, k: h.label, T, agree: +dec.agree.toFixed(3),
                             frame: +frame.score.toFixed(2), text: dec.text.slice(0, 40) });

      /* Ранний выход — только по подтверждённому консенсусу. Одиночное идеальное
         совпадение может оказаться сдвинутой сеткой, прочитавшей самосогласованный
         кусок настоящего кода. */
      const sameText = accepted.filter(c => c.text === dec.text).length;
      if (dec.agree >= 0.999 && frame.score >= 0.999 && sameText >= 2) {
        diag.earlyExit = true; break outer;
      }
      } /* кінець перебору кандидатів розміру */
    }
  }
  /* Інші канали: на камері — лише якщо по яскравості нічого не знайшли.
     На файлі перебираємо всі: перший прохід інколи приймає дрібний
     самоузгоджений шматок усередині коду, а справжній код знаходиться
     в несучому каналі; переможе довший текст. Повна згода — досить. */
  if (accepted.length && (opts.mode === 'camera' ||
      accepted.some(c => c.agree >= 0.999 && c.frame >= 0.999))) break;
  }
  } /* кінець етапів */

  mark('DECODE', { evaluated, accepted: accepted.length });

  /* ── ВЫБОР ПОБЕДИТЕЛЯ ──
     Сюда доходят только кандидаты, прошедшие обе проверки. Ранжируем консенсусом:
     сколько независимых гипотез дали ровно этот текст. Сдвинутая сетка способна
     выдать самосогласованное чтение куска кода, но повторить его с другого
     квадрата и другого стиска она не может. */
  const byText = new Map();
  for (const c of accepted) {
    const e = byText.get(c.text);
    if (e) { e.votes++; if (c.agree > e.best.agree) e.best = c; }
    else byText.set(c.text, { votes: 1, best: c });
  }
  /* Спершу — ОБСЯГ прочитаного (з 2.3). Справжній код — найбільший
     самоузгоджений текст у кадрі; зсунута сітка читає лише його шматок
     (коротший), і такий шматок інколи набирає більше голосів, ніж ціле. */
  const bytesOf = t => _enc.encode(t).length;
  const ranked = [...byText.values()].sort((a, b) =>
    (bytesOf(b.best.text) - bytesOf(a.best.text)) ||
    (b.votes - a.votes) ||
    (b.best.agree - a.best.agree) ||
    (b.best.frame - a.best.frame)
  );
  diag.consensus = ranked.map(r => ({ text: r.best.text.slice(0, 40), votes: r.votes, T: r.best.T }));

  if (!ranked.length) {
    const r = fail('NO CODE', diag, t0);
    r.diagnostic = opts.diagnostic ? diag : undefined;
    return r;
  }
  const best = ranked[0].best;
  best.votes = ranked[0].votes;
  mark('RESULT', { T: best.T, text: best.text.slice(0, 40) });

  return {
    ok: true,
    text: best.text,
    parts: best.parts,
    channels: best.channels,
    chanInv: best.chanInv,
    T: best.T,                  // полный габарит: рамка+зебра+данные+зебра+рамка
    n: best.n,                  // зона данных, n = T - 4
    mode: best.mode,            // oct | quad | half
    kind: best.kind,            // mono | monolith | three
    colored: best.colored,
    palette: best.palette,
    confidence: {
      agree: +best.agree.toFixed(4),
      frame: +best.frame.toFixed(4),
      zebra: +best.zebraConf.toFixed(3),
      alternation: +best.alt.toFixed(3),
      cornersDark: best.cornersDark,
      votes: best.votes,          // сколько независимых гипотез дали этот текст
      blobArea: best.shape ? +best.shape.frac.toFixed(3) : 0,
      blobBox: best.shape ? +best.shape.bbox.toFixed(2) : 0
    },
    tinted: best.tinted,          // підфарбований монохром
    rmark: best.rmark,            // 1 = один текст, розкладений по каналах
    corners: best.corners,
    ms: +(performance.now() - t0).toFixed(1),
    diagnostic: opts.diagnostic ? diag : undefined
  };
}

function fail(reason, diag, t0) {
  return { ok: false, text: null, reason,
           ms: +(performance.now() - t0).toFixed(1), diagnostic: diag };
}

/* ═════════════════════ ЧАСТЬ 6. НЕПРЕРЫВНАЯ КАМЕРА ═════════════════════ */

/**
 * Непрерывный разбор видеопотока. Отчёт по КАЖДОМУ кадру, не по нажатию.
 * Возвращает объект с методом stop().
 */
function scanVideo(video, onFrame, opts) {
  opts = opts || {};
  const intervalMs = opts.intervalMs || 700;
  let stopped = false, roiHint = null, roiAge = 0, timer = null;
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  function tick() {
    if (stopped) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { timer = setTimeout(tick, 200); return; }
    work.width = vw; work.height = vh;
    wctx.drawImage(video, 0, 0, vw, vh);

    let res;
    try {
      res = decode(work, Object.assign({ mode: 'camera', diagnostic: true, roiHint }, opts));
    } catch (e) {
      res = { ok: false, text: null, reason: 'ошибка: ' + e.message };
    }

    /* трекинг найденного кандидата — следующий кадр начинаем с него */
    if (res.ok) { roiHint = res.corners; roiAge = 0; }
    else if (roiHint && ++roiAge > 3) { roiHint = null; }

    try { onFrame(res); } catch (e) {}

    if (res.ok && opts.stopOnSuccess) { stopped = true; return; }
    timer = setTimeout(tick, intervalMs);
  }

  tick();
  return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
}

/* ═════════════════════ ЧАСТЬ 7. ПУБЛИЧНОЕ API ═════════════════════ */

window.TainaDecoder = {
  decode,
  scanVideo,
  /* Промис: резолвится, когда OpenCV готов (true) или не дождались (false).
     Камеру и разбор файла имеет смысл запускать после него — без OpenCV
     декодер видит только весь кадр целиком и на фото с камеры не сработает. */
  ready: ensureOpenCV(),
  last: null,               // результат останнього розбору, разом із діагностикою
  cvReady: () => !!(window.cv && window.cv.Mat),
  config: CFG,
  version: '2.4',
  /* внутренности — для decoder-lab.html и автотестов */
  _internal: { decodePixels, warpGrayNN, warpRGB, insetCorners, insetCornersFrac, verifyZebra, zebraRing,
               outerFrameScore, sampleCells, decodeCells, findQuadsCV,
               orderCorners, squareness, meanSide, computeH, applyH }
};

/**
 * Совместимость со старым интерфейсом Life_10.
 * index.html вызывает runDecodeAttempts(img) и ждёт [{kind,mode,n,res}].
 * UI переделывать не требуется — старый вызов продолжает работать.
 */
window.runDecodeAttempts = function (img, opts) {
  /* opts необязателен. Для видеокадров передавай { mode: 'camera' } —
     иначе на каждый кадр уйдёт бюджет неподвижной картинки и цикл камеры
     будет заметно подвисать. */
  const r = decode(img, Object.assign({ mode: 'image', diagnostic: true }, opts || {}));
  /* Останній розбір лишаємо доступним ззовні — інтерфейс показує з нього
     причини відмови прямо на екрані телефону, без консолі. */
  window.TainaDecoder.last = r;
  if (!r.ok) return [];
  let kind = 'one', res = [r.text, null, null];
  if (r.kind === 'three') { kind = 'three'; res = r.channels || [r.text, null, null]; }
  else if (r.kind === 'monolith') { kind = 'mono'; }
  /* parts і rmark потрібні інтерфейсу, щоб залишити орнамент КОЛЬОРОВИМ,
     коли це один текст, розкладений по каналах (kind 'mono'). */
  return [{ kind, mode: r.mode, n: r.n, pad: 2, res, T: r.T,
            confidence: r.confidence, parts: r.parts, channels: r.channels,
            rmark: r.rmark, colored: r.colored, tinted: r.tinted, text: r.text,
            negative: !!r.negative, chanInv: r.chanInv || null }];
};

})();