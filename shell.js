/* ═══════════════════════════════════════════════════════════════
   shell.js — спільна оболонка TAINA
   Малює шапку, тримає модалки «Проєкт», «Тариф», «Контакти» і тост.
   Підключати на КОЖНІЙ сторінці з defer:
       <link rel="stylesheet" href="shell.css">
       <script defer src="shell.js"></script>
   і покласти в розмітку порожній <div id="hdr"></div> першим у <body>.

   Шапка однакова на всіх сторінках, бо збирається з одного місця.
   Активна вкладка визначається з імені файлу — нічого прописувати
   вручну на сторінках не треба.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var PHONE_TEL  = '+380682752859';
var PHONE_TEXT = '068 275 28 59';
var CARD_NO    = '4874070062500416';
var CARD_SHOWN = '4874 0700 6250 0416';

var TABS = [
  { href: 'index.html',    key: 'lab' },
  { href: 'gallery.html',  key: 'gal' },
  { href: 'services.html', key: 'srv' },
  { modal: 'project',      key: 'proj' },
  { modal: 'tarif',        key: 'tarif' }
];
/* Підписи шапки двома мовами. Мову обирає кнопка UA/EN у Лабораторії,
   вибір лежить у localStorage і діє на шапку всіх сторінок. */
var HDR = {
  uk: { lab:'Лабораторія', gal:'Галерея', srv:'Візуалізація', proj:'Проєкт', tarif:'Тариф',
        contacts:'контакти', call:'Зателефонувати' },
  en: { lab:'Laboratory',  gal:'Gallery', srv:'Visualization', proj:'Project', tarif:'Pricing',
        contacts:'contacts', call:'Call' }
};
function curLang() {
  var l = 'uk';
  try { l = localStorage.getItem('taina_lang') || 'uk'; } catch (e) {}
  return (l === 'en') ? 'en' : 'uk';
}

/* ───────────────── вміст модалок: UA / EN ───────────────── */
function cardRow(copyLabel) {
  return '<div class="copyrow"><span class="cardno" id="cardNo">' + CARD_SHOWN + '</span>' +
         '<button type="button" id="copyCard">' + copyLabel + '</button></div>';
}
var M = {
  uk: {
    project:
      '<h2>Проєкт</h2>' +
      '<p>TAINA — це сканований 2D-код. Дані кодуються двійковою послідовністю, потоком байтів: ' +
      'темний модуль — одиниця, світлий — нуль. Симетрична структура піксельних модулів робить ' +
      'його схожим на український орнамент.</p>' +
      '<p>Детальний опис методу: <a href="https://zenodo.org/records/21709832" target="_blank" rel="noopener">стаття на Zenodo</a>.</p>',
    tarif:
      '<h2>Тариф</h2>' +
      '<p>Використання сайту <b>абсолютно безкоштовне</b>.</p>' +
      '<p>Якщо ви бажаєте підтримати автора та розвиток проєкту:</p>' +
      '<p style="margin-bottom:6px">💳 Монобанк (Біла картка)</p>' + cardRow('Копіювати') +
      '<p style="color:var(--muted);font-size:13.5px;margin-bottom:0">Дякую за підтримку.</p>',
    contacts:
      '<h2>Контакти</h2><ul class="clist">' +
      '<li><span class="k">Email</span><a href="mailto:bakminsterfuler@gmail.com">bakminsterfuler@gmail.com</a></li>' +
      '<li><span class="k">Телефон</span><a href="tel:' + PHONE_TEL + '">+380 68 275 28 59</a></li>' +
      '<li><span class="k">Instagram</span><a href="https://instagram.com/mixailkashkarov" target="_blank" rel="noopener">@mixailkashkarov</a></li>' +
      '<li><span class="k">OpenSea</span><a href="https://opensea.io/MihailKashkarov" target="_blank" rel="noopener">MihailKashkarov</a></li>' +
      '</ul>',
    copied: 'Номер картки скопійовано', copyFail: 'Не вдалося скопіювати'
  },
  en: {
    project:
      '<h2>Project</h2>' +
      '<p>TAINA is a scannable 2D code. Data is encoded as a binary sequence, a stream of bytes: ' +
      'a dark module is a one, a light module is a zero. The symmetric structure of the pixel modules ' +
      'makes it resemble a Ukrainian ornament.</p>' +
      '<p>Full description of the method: <a href="https://zenodo.org/records/21709832" target="_blank" rel="noopener">article on Zenodo</a>.</p>',
    tarif:
      '<h2>Pricing</h2>' +
      '<p>Using the site is <b>completely free</b>.</p>' +
      '<p>If you would like to support the author and the project:</p>' +
      '<p style="margin-bottom:6px">💳 Monobank (White card)</p>' + cardRow('Copy') +
      '<p style="color:var(--muted);font-size:13.5px;margin-bottom:0">Thank you for your support.</p>',
    contacts:
      '<h2>Contacts</h2><ul class="clist">' +
      '<li><span class="k">Email</span><a href="mailto:bakminsterfuler@gmail.com">bakminsterfuler@gmail.com</a></li>' +
      '<li><span class="k">Phone</span><a href="tel:' + PHONE_TEL + '">+380 68 275 28 59</a></li>' +
      '<li><span class="k">Instagram</span><a href="https://instagram.com/mixailkashkarov" target="_blank" rel="noopener">@mixailkashkarov</a></li>' +
      '<li><span class="k">OpenSea</span><a href="https://opensea.io/MihailKashkarov" target="_blank" rel="noopener">MihailKashkarov</a></li>' +
      '</ul>',
    copied: 'Card number copied', copyFail: 'Could not copy'
  }
};

/* Знак TAINA — піксельний, 30×4 модулі: з того ж «матеріалу», що й орнамент.
   Вектор (не картинка): різкий на будь-якому екрані й сам бере колір теми.
   crispEdges — щоб краї модулів не розмивались. */
var LOGO_SVG =
  '<svg viewBox="0 0 30 4" fill="currentColor" shape-rendering="crispEdges">' +
  '<path d="M0 0h5v1h-5zM8 0h1v1h-1zM13 0h1v1h-1zM16 0h2v1h-2zM21 0h1v1h-1zM26 0h1v1h-1zM2 1h1v1h-1zM7 1h1v1h-1zM9 1h1v1h-1zM16 1h1v1h-1zM18 1h1v1h-1zM21 1h1v1h-1zM25 1h1v1h-1zM27 1h1v1h-1zM2 2h1v1h-1zM6 2h1v1h-1zM8 2h1v1h-1zM10 2h1v1h-1zM13 2h1v1h-1zM16 2h1v1h-1zM19 2h1v1h-1zM21 2h1v1h-1zM24 2h1v1h-1zM26 2h1v1h-1zM28 2h1v1h-1zM2 3h1v1h-1zM5 3h1v1h-1zM11 3h1v1h-1zM13 3h1v1h-1zM16 3h1v1h-1zM20 3h2v1h-2zM23 3h1v1h-1zM29 3h1v1h-1z"/></svg>';

var PHONE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .3 1.9.6 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.1a2 2 0 012.1-.5c.9.3 1.8.5 2.8.6a2 2 0 011.7 2z"/></svg>';

/* Поточна сторінка: останній сегмент шляху. Корінь сайту = index.html. */
function currentPage() {
  var p = location.pathname.split('/').pop();
  return (!p || p === '') ? 'index.html' : p;
}

function buildHeader() {
  var here = currentPage(), L = HDR[curLang()];
  var tabs = TABS.map(function (t) {
    if (t.modal) return '<button class="roomtab" type="button" data-modal="' + t.modal + '">' + L[t.key] + '</button>';
    var on = (t.href === here) ? ' on' : '';
    return '<a href="' + t.href + '" class="roomtab' + on + '">' + L[t.key] + '</a>';
  }).join('');

  var html =
    '<header><div class="nav">' +
      '<div class="nav-l">' + tabs + '</div>' +
      '<div class="nav-c"><a href="index.html" class="mark logo" aria-label="TAINA">' + LOGO_SVG + '</a></div>' +
      '<div class="nav-r">' +
        '<button class="nb contacts" type="button" data-modal="contacts" title="' + L.contacts + '">' + L.contacts + '</button>' +
        '<a class="phone-num" href="tel:' + PHONE_TEL + '">' + PHONE_TEXT + '</a>' +
        '<a class="nb phone" href="tel:' + PHONE_TEL + '" title="' + L.call + '">' + PHONE_SVG + '</a>' +
      '</div>' +
    '</div></header>';

  var slot = document.getElementById('hdr');
  if (slot) slot.innerHTML = html;
  else document.body.insertAdjacentHTML('afterbegin', '<div id="hdr">' + html + '</div>');
}

/* ───────────────── модалка ───────────────── */
function ensureModal() {
  if (document.getElementById('modal')) return;
  var d = document.createElement('div');
  d.id = 'modal'; d.className = 'hide';
  d.innerHTML = '<div class="mveil"></div><div class="mcard">' +
                '<button class="mclose" type="button" aria-label="Закрити">✕</button>' +
                '<div id="mbody"></div></div>';
  document.body.appendChild(d);
  d.querySelector('.mveil').onclick = closeModal;
  d.querySelector('.mclose').onclick = closeModal;
}
function openModal(html) {
  ensureModal();
  document.getElementById('mbody').innerHTML = html;
  document.getElementById('modal').classList.remove('hide');
}
function closeModal() {
  var m = document.getElementById('modal');
  if (!m) return;
  m.classList.add('hide');
  document.getElementById('mbody').innerHTML = '';
}
function openNamed(name) {
  var T = M[curLang()];
  if (!T[name]) return;
  openModal(T[name]);
  if (name === 'tarif') {
    var doCopy = function () {
      var ok = function () { toast(T.copied); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(CARD_NO).then(ok, function () { toast(T.copyFail); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = CARD_NO; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) { toast(T.copyFail); }
        ta.remove();
      }
    };
    document.getElementById('copyCard').onclick = doCopy;
    document.getElementById('cardNo').onclick = doCopy;
  }
}

/* ───────────────── тема: темна / світла ─────────────────
   Живе в оболонці, щоб шапка і сторінки мінялися разом, а вибір
   пам'ятався між візитами. Кнопка стоїть на Лабораторії й смикає
   TainaShell.toggleTheme(). */
var TH = {
  dark:  { ink:'#0d0a08', panel:'#15100b', panel2:'#1d1610', parch:'#ede3d0', muted:'#a4927a',
           acc:'#c9a876', hot:'#e8c890', dim:'#8f7451', line:'rgba(201,168,118,.24)', on:'#15100b' },
  light: { ink:'#f4efe4', panel:'#fffdf8', panel2:'#eae0cc', parch:'#1a1208', muted:'#4a3d2a',
           acc:'#7a4e0c', hot:'#5c3a06', dim:'#6b5638', line:'rgba(60,45,25,.40)', on:'#fffdf8' }
};
var themeId = 'dark';
var ICON_SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<circle cx="12" cy="12" r="4.6" fill="currentColor"/>' +
  '<path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.85 1.85M17.35 17.35l1.85 1.85' +
  'M4.8 19.2l1.85-1.85M17.35 6.65l1.85-1.85"/></svg>';
var ICON_MOON =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11z"/></svg>';
function applyTheme(id) {
  themeId = (id === 'light') ? 'light' : 'dark';
  var t = TH[themeId], r = document.body.style;
  document.body.classList.toggle('light-mode', themeId === 'light');
  r.setProperty('--ink', t.ink); r.setProperty('--panel', t.panel); r.setProperty('--panel2', t.panel2);
  r.setProperty('--parchment', t.parch); r.setProperty('--muted', t.muted); r.setProperty('--on-acc', t.on);
  r.setProperty('--acc', t.acc); r.setProperty('--acc-hot', t.hot);
  r.setProperty('--acc-dim', t.dim); r.setProperty('--line', t.line);
  window.TAINA_ACC = { acc:t.acc, hot:t.hot, dim:t.dim, line:t.line, light:(themeId==='light') };
  try { localStorage.setItem('taina_theme', themeId); } catch (e) {}
  /* Лабораторія сама перефарбовує акцент у RGB-режимі — даємо їй знати. */
  if (typeof window.refreshThemeAccent === 'function') window.refreshThemeAccent();
  var b = document.getElementById('themeBtn');
  if (b) b.innerHTML = (themeId === 'light') ? ICON_MOON : ICON_SUN;
}
function toggleTheme() { applyTheme(themeId === 'light' ? 'dark' : 'light'); }

/* ───────────────── тост ───────────────── */
function toast(msg) {
  var t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(window._toastTO);
  window._toastTO = setTimeout(function () { t.classList.remove('on'); }, 2600);
}
window.toast = toast;
window.TainaShell = { openModal: openNamed, closeModal: closeModal, toast: toast,
                      applyTheme: applyTheme, toggleTheme: toggleTheme,
                      /* мову зберігає Лабораторія; тут лише перемальовуємо шапку */
                      setLang: function () { buildHeader(); },
                      theme: function () { return themeId; } };

/* ───────────────── старт ───────────────── */
function init() {
  var saved = 'light';
  /* Перший візит — світла тема; далі — те, що людина обрала сама. */
  try { saved = localStorage.getItem('taina_theme') || 'light'; } catch (e) {}
  applyTheme(saved);
  buildHeader();
  ensureModal();
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-modal]') : null;
    if (b) { e.preventDefault(); openNamed(b.getAttribute('data-modal')); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* Вікно «Проєкт» більше не відкривається саме: новий відвідувач
     одразу бачить показ можливостей. «Проєкт» — у шапці. */
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
