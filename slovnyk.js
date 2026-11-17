/* slovnyk.js — компактний спосіб запису орнаментального коду (OC8):
   таблиця літер (Windows-1251), контрольний байт і СЛОВНИК скорочень
   (1 поверх — 8 клітин, 2 поверх — 16 клітин).
   Його використовують генератор (index.html), сканер (decoder.js) і галерея.
   ПРАВИЛО: словник лише ДОПОВНЮВАТИ. Змінити чи видалити рядок — означає,
   що вже опубліковані коди прочитаються неправильно. */
/* ═══ OC8 — КОМПАКТНА ТАБЛИЦЯ: 1 символ = 1 байт = 8 клітин ═══
   Стандарт Windows-1251. Дозволені лише: латиниця, цифри, знаки ASCII,
   українські й російські літери та кілька типографських знаків.
   Решта (емодзі, інші мови) у код не потрапляє. Байти поза таблицею
   сканер вважає помилкою — це його перевірка «прочитано правильно». */
window.OC8 = (function () {
  const ALLOWED =
    ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
    '\n\t' +
    'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя' +
    'ЁёҐґЄєІіЇї' +
    '«»—–№…‘’“”„€°·•';
  /* схожі символи, яких немає в таблиці, замінюємо на наявні */
  const ALIAS = { 'ʼ': '’', ' ': ' ', '−': '-', '\r': '' };
  const td = new TextDecoder('windows-1251');
  const toByte = new Map(), toChar = new Array(256).fill(null);
  for (let b = 1; b < 256; b++) {
    const ch = td.decode(new Uint8Array([b]));
    if (ALLOWED.indexOf(ch) >= 0 && !toByte.has(ch)) { toByte.set(ch, b); toChar[b] = ch; }
  }
  function clean(str) {
    let o = '';
    for (let ch of String(str || '')) {
      if (ALIAS.hasOwnProperty(ch)) ch = ALIAS[ch];
      if (ch && toByte.has(ch)) o += ch;
    }
    return o;
  }
  /* СЛОВНИК. Частий шматок тексту = 1 байт (1 поверх) або 2 байти (2 поверх:
     «двері» + номер). Значення НЕ МІНЯТИ після публікації: інакше вже
     надруковані коди прочитаються неправильно. Додавати — лише у вільні місця.
     Затверджено 16.11.2026. */
  const DICT = [                     /* 1 поверх: 8 клітин */
    ['https://www.youtube.com/', 173],
    ['https://www.instagram.com/', 138],
    ['https://www.tiktok.com/', 174],
    ['https://www.facebook.com/', 157],
    ['https://t.me/', 159],
    ['https://www.ornamentcode.com/', 182],
    ['https://', 172],
    ['https://www.', 169]
  ];
  /* 2 поверх: 16 клітин. Ключ — байт «дверей» (його медальйон — герб групи),
     далі номер шматка 1…255 (0 не використовуємо). */
  const FLOOR2 = {
    155: [ /* двері «Фрази» */
      null,
      'Слава Україні',                 // 1
      'Героям слава',                  // 2
      'Все буде Україна',              // 3
      'Незламні',                      // 4
      'Свобода',                       // 5
      'Батьківщина',                   // 6
      'Разом до перемоги',             // 7
      'Доброго вечора, ми з України',  // 8
      'Я тебе кохаю',                  // 9
      'Все буде гаразд',               // 10
      'Добро переможе зло',            // 11
      'Мамо, я тебе люблю'             // 12
    ],
    5: [ /* двері «Автор» */
      null,
      'Михаил Кашкаров',                  // 1
      'KASHKAROV MYKHAILO MYKOLAYOVYCH',  // 2
      'astra31415926.github.io/',         // 3
      'PROFESSIONAL DICKHEAD'             // 4
    ]
  };
  const PIECES = [];                  /* усі шматки: [текст, [байти]] */
  const tokChar = new Map(), doors = new Map();
  const busy = b => toChar[b] != null || tokChar.has(b) || doors.has(b);
  for (const [piece, b] of DICT) {
    if (busy(b)) throw new Error('OC8: dictionary byte ' + b + ' busy');
    tokChar.set(b, piece); PIECES.push([piece, [b]]);
  }
  for (const k of Object.keys(FLOOR2)) {
    const door = +k, list = FLOOR2[k];
    if (busy(door)) throw new Error('OC8: door byte ' + door + ' busy');
    if (list.length > 256) throw new Error('OC8: door ' + door + ' overfull');
    doors.set(door, list);
    for (let i = 1; i < list.length; i++) if (list[i]) PIECES.push([list[i], [door, i]]);
  }
  PIECES.sort((a, b) => b[0].length - a[0].length);
  function encode(str) {
    const c = clean(str), out = [];
    let i = 0;
    while (i < c.length) {
      let hit = null;
      for (const p of PIECES) if (c.startsWith(p[0], i)) { hit = p; break; }
      if (hit) { out.push(...hit[1]); i += hit[0].length; }
      else { out.push(toByte.get(c[i])); i++; }
    }
    return Uint8Array.from(out);
  }
  function decode(bytes) {
    let o = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (toChar[b] != null) { o += toChar[b]; continue; }
      if (tokChar.has(b)) { o += tokChar.get(b); continue; }
      if (doors.has(b)) {
        const piece = i + 1 < bytes.length ? doors.get(b)[bytes[i + 1]] : null;
        if (!piece) throw new Error('OC8: door ' + b + ' bad index');
        o += piece; i++; continue;
      }
      throw new Error('OC8: byte ' + b + ' not in table');
    }
    return o;
  }
  /* КОНТРОЛЬНИЙ БАЙТ. У кінці кожного тексту — 1 байт (8 клітин) контрольної
     суми (CRC-8). У щільній таблиці майже будь-який візерунок «схожий на
     текст», тож без неї сканер міг би прочитати мотив чи шум як слово.
     Сума ніколи не дорівнює 0, щоб не сплутати її з порожніми клітинами. */
  function crc(bytes) {
    let c = 0;
    for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; }
    return c || 0x5A;
  }
  function withCheck(bytes) {
    if (!bytes.length) return bytes;
    const o = new Uint8Array(bytes.length + 1); o.set(bytes); o[bytes.length] = crc(bytes); return o;
  }
  /* bytes — уже без нулів у кінці. Повертає байти тексту або null. */
  function stripCheck(bytes) {
    if (bytes.length < 2) return null;
    const body = bytes.slice(0, bytes.length - 1);
    return crc(body) === bytes[bytes.length - 1] ? body : null;
  }
  return { encode, decode, clean, withCheck, stripCheck, CHK_BITS: 8,
           has: ch => toByte.has(ALIAS[ch] != null ? ALIAS[ch] : ch) };
})();

