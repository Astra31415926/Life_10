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
  { href: 'index.html',    label: 'Лабораторія' },
  { href: 'gallery.html',  label: 'Галерея' },
  { href: 'services.html', label: 'Послуги' },
  { modal: 'project',      label: 'Проєкт' },
  { modal: 'tarif',        label: 'Тариф' }
];

/* ───────────────── вміст модалок ───────────────── */
var M = {
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
    '<p style="margin-bottom:6px">💳 Монобанк (Біла картка)</p>' +
    '<div class="copyrow"><span class="card" id="cardNo">' + CARD_SHOWN + '</span>' +
    '<button type="button" id="copyCard">Копіювати</button></div>' +
    '<p style="color:var(--muted);font-size:13.5px;margin-bottom:0">Дякую за підтримку.</p>',

  contacts:
    '<h2>Контакти</h2>' +
    '<ul class="clist">' +
    '<li><span class="k">Email</span><a href="mailto:bakminsterfuler@gmail.com">bakminsterfuler@gmail.com</a></li>' +
    '<li><span class="k">Телефон</span><a href="tel:' + PHONE_TEL + '">+380 68 275 28 59</a></li>' +
    '<li><span class="k">Instagram</span><a href="https://instagram.com/mixailkashkarov" target="_blank" rel="noopener">@mixailkashkarov</a></li>' +
    '<li><span class="k">OpenSea</span><a href="https://opensea.io/MihailKashkarov" target="_blank" rel="noopener">MihailKashkarov</a></li>' +
    '</ul>'
};

var PHONE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .3 1.9.6 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.1a2 2 0 012.1-.5c.9.3 1.8.5 2.8.6a2 2 0 011.7 2z"/></svg>';

/* Поточна сторінка: останній сегмент шляху. Корінь сайту = index.html. */
function currentPage() {
  var p = location.pathname.split('/').pop();
  return (!p || p === '') ? 'index.html' : p;
}

function buildHeader() {
  var here = currentPage();
  var tabs = TABS.map(function (t) {
    if (t.modal) return '<button class="roomtab" type="button" data-modal="' + t.modal + '">' + t.label + '</button>';
    var on = (t.href === here) ? ' on' : '';
    return '<a href="' + t.href + '" class="roomtab' + on + '">' + t.label + '</a>';
  }).join('');

  var html =
    '<header><div class="nav">' +
      '<div class="nav-l">' + tabs + '</div>' +
      '<div class="nav-c"><a href="index.html" class="mark">taina</a></div>' +
      '<div class="nav-r">' +
        '<button class="nb contacts" type="button" data-modal="contacts" title="Контакти">контакти</button>' +
        '<a class="phone-num" href="tel:' + PHONE_TEL + '">' + PHONE_TEXT + '</a>' +
        '<a class="nb phone" href="tel:' + PHONE_TEL + '" title="Зателефонувати">' + PHONE_SVG + '</a>' +
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
  if (!M[name]) return;
  openModal(M[name]);
  if (name === 'tarif') {
    var doCopy = function () {
      var ok = function () { toast('Номер картки скопійовано'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(CARD_NO).then(ok, function () { toast('Не вдалося скопіювати'); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = CARD_NO; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); ok(); } catch (e) { toast('Не вдалося скопіювати'); }
        ta.remove();
      }
    };
    document.getElementById('copyCard').onclick = doCopy;
    document.getElementById('cardNo').onclick = doCopy;
  }
}

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
window.TainaShell = { openModal: openNamed, closeModal: closeModal, toast: toast };

/* ───────────────── старт ───────────────── */
function init() {
  buildHeader();
  ensureModal();
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-modal]') : null;
    if (b) { e.preventDefault(); openNamed(b.getAttribute('data-modal')); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* Перший візит — показуємо «Проєкт» один раз. */
  var seen = '0';
  try { seen = localStorage.getItem('taina_intro_seen') || '0'; } catch (e) {}
  if (seen !== '1') {
    setTimeout(function () {
      openNamed('project');
      try { localStorage.setItem('taina_intro_seen', '1'); } catch (e) {}
    }, 400);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
