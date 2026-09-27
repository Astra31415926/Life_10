<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>TAINA DECODER LAB</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#08080b;color:#9a9aaa;font:13px/1.6 ui-monospace,'Courier New',monospace;
     padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
#app{display:flex;flex-direction:column;height:100%}
#bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;
     border-bottom:1px solid #1a1a26;flex-shrink:0}
h1{font-size:13px;letter-spacing:3px;color:#4a8ac0;margin-right:6px}
.btn{background:#101018;border:1px solid #242436;color:#aab;padding:10px 16px;
     cursor:pointer;font:inherit;font-size:14px;letter-spacing:1px;border-radius:4px}
.btn:hover{border-color:#4a8ac0;color:#dde}
.btn.on{border-color:#4a8ac0;color:#8fd08f}
input[type=file]{display:none}
#main{flex:1;display:flex;gap:10px;padding:10px;overflow:hidden;min-height:0}
#left{flex:0 0 46%;display:flex;flex-direction:column;gap:8px;overflow:hidden}
#right{flex:1;overflow-y:auto;min-width:0}
.pane{background:#0c0c12;border:1px solid #1a1a26;border-radius:4px;padding:8px;overflow:hidden}
.pane h2{font-size:11px;letter-spacing:2px;color:#4a6a8a;margin-bottom:6px}
canvas{display:block;max-width:100%;max-height:34vh;margin:0 auto;image-rendering:pixelated;
       border:1px solid #1a1a26}
#vid{max-width:100%;max-height:34vh;display:none;margin:0 auto}
#rgbwrap{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
#rgbwrap canvas{max-height:16vh}
.lbl{font-size:10px;letter-spacing:2px;text-align:center;color:#3a5a7a;margin-top:3px}
#status{padding:8px 10px;font-size:16px;letter-spacing:1px;border-top:1px solid #1a1a26;
        flex-shrink:0;min-height:38px}
table{width:100%;border-collapse:collapse;font-size:11px}
th,td{text-align:left;padding:2px 5px;border-bottom:1px solid #15151f;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis;max-width:190px}
th{color:#4a6a8a;font-weight:400}
.ok{color:#6ec46e}.bad{color:#c46e6e}.warn{color:#c4a86e}.dim{color:#55556a}
h3{font-size:11px;letter-spacing:2px;color:#4a6a8a;margin:10px 0 4px}
@media(max-width:800px){#main{flex-direction:column}#left{flex:0 0 auto}}
</style>
</head>
<body>
<div id="app">
  <div id="bar">
    <h1>TAINA·LAB</h1>
    <label class="btn">Файл<input type="file" id="fin" accept="image/*"></label>
    <button class="btn" id="camBtn">Камера</button>
    <button class="btn" id="stopBtn" style="display:none">Стоп</button>
    <span class="dim" id="cvState">opencv…</span>
  </div>

  <div id="main">
    <div id="left">
      <div class="pane">
        <h2>КАДР / WARP</h2>
        <canvas id="cnv"></canvas>
        <video id="vid" autoplay playsinline muted></video>
      </div>
      <div class="pane">
        <h2>RGB-КАНАЛИ</h2>
        <div id="rgbwrap"></div>
      </div>
    </div>
    <div id="right">
      <div id="report"></div>
    </div>
  </div>

  <div id="status" class="dim">— очікування —</div>
</div>

<script async src="https://docs.opencv.org/4.8.0/opencv.js"></script>
<script src="decoder.js"></script>
<script>
'use strict';

const $ = id => document.getElementById(id);
const cnv = $('cnv'), vid = $('vid'), report = $('report');
const esc = s => String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

(function waitCv(){
  if (window.cv && window.cv.Mat) { $('cvState').textContent = 'opencv ok'; $('cvState').className='ok'; }
  else setTimeout(waitCv, 300);
})();

function setStatus(t, cls) { const e = $('status'); e.textContent = t; e.className = cls || 'dim'; }

/* ── ОТЧЁТ ПО ЭТАПАМ ── */
function renderReport(res) {
  const d = res.diagnostic || {};
  let h = '';

  h += '<h3>ЕТАПИ</h3><table><tr><th>етап</th><th>мс</th><th>деталі</th></tr>';
  for (const s of (d.stages || [])) {
    const extra = Object.keys(s).filter(k => k!=='stage' && k!=='ms')
                    .map(k => k+'='+esc(s[k])).join(' ');
    h += `<tr><td>${s.stage}</td><td>${s.ms}</td><td class="dim">${extra}</td></tr>`;
  }
  h += '</table>';

  if (res.ok) {
    const c = res.confidence;
    h += '<h3>РЕЗУЛЬТАТ</h3><table>';
    h += `<tr><td>текст</td><td class="ok">${esc(res.text)}</td></tr>`;
    h += `<tr><td>T (повний габарит)</td><td>${res.T}</td></tr>`;
    h += `<tr><td>n (зона даних)</td><td>${res.n}</td></tr>`;
    h += `<tr><td>режим</td><td>${res.mode} · ${res.kind}${res.palette?' · '+res.palette:''}</td></tr>`;
    h += `<tr><td>зворотна звірка</td><td class="${c.agree>=0.9?'ok':'bad'}">${c.agree}</td></tr>`;
    h += `<tr><td>структура рамки</td><td class="${c.frame>=0.95?'ok':'bad'}">${c.frame}</td></tr>`;
    h += `<tr><td>зебра conf / чергування</td><td>${c.zebra} / ${c.alternation}</td></tr>`;
    h += `<tr><td>кути зебри темні</td><td>${c.cornersDark}</td></tr>`;
    h += `<tr><td>голосів за цей текст</td><td>${c.votes}</td></tr>`;
    h += `<tr><td>час</td><td>${res.ms} мс</td></tr>`;
    h += '</table>';
  } else {
    h += `<h3>РЕЗУЛЬТАТ</h3><div class="bad">${esc(res.reason)} · ${res.ms} мс</div>`;
  }

  if (d.consensus && d.consensus.length) {
    h += '<h3>КОНСЕНСУС</h3><table><tr><th>текст</th><th>T</th><th>голосів</th></tr>';
    for (const c of d.consensus)
      h += `<tr><td>${esc(c.text)}</td><td>${c.T}</td><td>${c.votes}</td></tr>`;
    h += '</table>';
  }

  if (d.candidates && d.candidates.length) {
    h += '<h3>ПРИЙНЯТІ ГІПОТЕЗИ</h3><table><tr><th>quad</th><th>стиск</th><th>T</th><th>звірка</th><th>рамка</th><th>текст</th></tr>';
    for (const c of d.candidates)
      h += `<tr><td>${c.q}</td><td>${c.k}</td><td>${c.T}</td><td>${c.agree}</td><td>${c.frame}</td><td class="ok">${esc(c.text)}</td></tr>`;
    h += '</table>';
  }

  if (d.rejected && d.rejected.length) {
    h += `<h3>ВІДХИЛЕНО (${d.rejected.length})</h3><table><tr><th>quad</th><th>стиск</th><th>T</th><th>причина</th><th>деталі</th></tr>`;
    for (const r of d.rejected.slice(0, 60)) {
      const det = Object.keys(r).filter(k => !['q','k','T','why'].includes(k))
                    .map(k => k+'='+esc(r[k])).join(' ');
      h += `<tr><td>${r.q}</td><td>${r.k!=null?r.k:'-'}</td><td>${r.T||'-'}</td><td class="warn">${r.why}</td><td class="dim">${det}</td></tr>`;
    }
    h += '</table>';
    if (d.rejected.length > 60) h += `<div class="dim">…ще ${d.rejected.length-60}</div>`;
  }

  if (d.timeout) h += '<div class="warn">⚠ вичерпано ліміт часу — показано те, що встигли</div>';
  report.innerHTML = h;
}

/* ── ВИЗУАЛИЗАЦИЯ: warp + сетка + круги выборки + жёлтые углы ── */
function drawFound(sourceCanvas, res) {
  const I = window.TainaDecoder._internal;
  const W = sourceCanvas.width, H = sourceCanvas.height;
  const px = sourceCanvas.getContext('2d', { willReadFrequently: true })
                         .getImageData(0, 0, W, H).data;
  const Tz = res.T - 2;
  const S = Math.min(560, Math.max(280, Tz * 16));
  const rgb = I.warpRGB(px, W, H, res.corners, S);
  if (!rgb) return;

  cnv.width = S; cnv.height = S;
  const ctx = cnv.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    img.data[i*4]   = rgb[i*3];
    img.data[i*4+1] = rgb[i*3+1];
    img.data[i*4+2] = rgb[i*3+2];
    img.data[i*4+3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const mod = S / Tz;
  ctx.strokeStyle = 'rgba(70,140,220,0.30)'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= Tz; i++) {
    const p = i * mod;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,215,60,0.45)';
  [[0,0],[S-mod,0],[S-mod,S-mod],[0,S-mod]].forEach(([x,y]) => ctx.fillRect(x, y, mod, mod));
  ctx.strokeStyle = 'rgba(110,235,120,0.65)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(mod, mod, (Tz-2)*mod, (Tz-2)*mod);
  const r = mod * 0.28;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = Math.max(0.7, mod*0.05);
  for (let row = 1; row < Tz-1; row++) for (let col = 1; col < Tz-1; col++) {
    ctx.beginPath();
    ctx.arc(col*mod + mod/2, row*mod + mod/2, r, 0, Math.PI*2);
    ctx.stroke();
  }

  drawChannels(rgb, S, Tz);
}

function drawChannels(rgb, S, Tz) {
  const wrap = $('rgbwrap'); wrap.innerHTML = '';
  const cols = [[255,60,60],[60,220,60],[60,110,255]], names = ['R','G','B'];
  const mod = S / Tz, r = mod * 0.28;
  for (let ci = 0; ci < 3; ci++) {
    const box = document.createElement('div');
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#07070a'; g.fillRect(0, 0, S, S);
    for (let row = 1; row < Tz-1; row++) for (let col = 1; col < Tz-1; col++) {
      const cx = col*mod + mod/2, cy = row*mod + mod/2;
      let sum = 0, cnt = 0;
      for (let y = Math.floor(cy-r); y <= cy+r; y++)
        for (let x = Math.floor(cx-r); x <= cx+r; x++) {
          if (x<0||y<0||x>=S||y>=S) continue;
          const dx = x-cx, dy = y-cy;
          if (dx*dx + dy*dy > r*r) continue;
          sum += rgb[(y*S+x)*3 + ci]; cnt++;
        }
      const v = cnt ? sum/cnt : 0;
      g.fillStyle = `rgba(${cols[ci][0]},${cols[ci][1]},${cols[ci][2]},${(v/255).toFixed(2)})`;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI*2); g.fill();
    }
    const l = document.createElement('div'); l.className = 'lbl'; l.textContent = names[ci];
    box.appendChild(c); box.appendChild(l); wrap.appendChild(box);
  }
}

function showRaw(canvas) {
  const m = Math.min(1, 700 / Math.max(canvas.width, canvas.height));
  cnv.width = Math.round(canvas.width * m);
  cnv.height = Math.round(canvas.height * m);
  cnv.getContext('2d').drawImage(canvas, 0, 0, cnv.width, cnv.height);
  $('rgbwrap').innerHTML = '';
}

/* ── ФАЙЛ ── */
$('fin').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => {
    vid.style.display = 'none'; cnv.style.display = 'block';
    setStatus('обробка…');
    setTimeout(() => {
      const src = document.createElement('canvas');
      src.width = img.naturalWidth; src.height = img.naturalHeight;
      src.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0);
      const res = window.TainaDecoder.decode(src, { mode: 'image', diagnostic: true });
      renderReport(res);
      if (res.ok) { drawFound(src, res); setStatus('✓ ' + res.text, 'ok'); }
      else { showRaw(src); setStatus('✗ ' + res.reason, 'bad'); }
    }, 20);
  };
  img.src = URL.createObjectURL(f);
  e.target.value = '';
});

/* ── КАМЕРА: непрерывно, отчёт по каждому кадру, без кнопки «снимок» ── */
let stream = null, scan = null;

$('camBtn').addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' },
               width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    vid.srcObject = stream; await vid.play();
    vid.style.display = 'block'; cnv.style.display = 'none';
    $('camBtn').style.display = 'none'; $('stopBtn').style.display = 'inline';
    setStatus('◎ сканування…');

    let frame = 0;
    scan = window.TainaDecoder.scanVideo(vid, res => {
      frame++;
      renderReport(res);
      if (res.ok) {
        const snap = document.createElement('canvas');
        snap.width = vid.videoWidth; snap.height = vid.videoHeight;
        snap.getContext('2d', { willReadFrequently: true }).drawImage(vid, 0, 0);
        vid.style.display = 'none'; cnv.style.display = 'block';
        drawFound(snap, res);
        setStatus('✓ ' + res.text, 'ok');
      } else {
        vid.style.display = 'block'; cnv.style.display = 'none';
        setStatus(`кадр ${frame}: ${res.reason} · ${res.ms} мс`, 'warn');
      }
    }, { intervalMs: 600, stopOnSuccess: false });
  } catch (err) {
    setStatus('✗ камера: ' + err.message, 'bad');
  }
});

$('stopBtn').addEventListener('click', () => {
  if (scan) { scan.stop(); scan = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  vid.style.display = 'none'; cnv.style.display = 'block';
  $('camBtn').style.display = 'inline'; $('stopBtn').style.display = 'none';
  setStatus('— зупинено —');
});
</script>
</body>
</html>
