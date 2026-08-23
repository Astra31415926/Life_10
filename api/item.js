const SUPA_URL = 'https://iieahzklwngqugkovhrs.supabase.co';
const SUPA_KEY = 'sb_publishable_FHtRNaLBvDgDTSLa_8eQnQ_oPMWCIxF';
const SITE = 'https://taina.vercel.app';

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || '').replace(/[^0-9a-zA-Z_-]/g,'');
  let rec = null;
  if(id){
    try{
      const r = await fetch(SUPA_URL+'/rest/v1/bytecodes?id=eq.'+id+'&select=word,image_url,mode,layers,lang&limit=1',
        {headers:{apikey:SUPA_KEY, Authorization:'Bearer '+SUPA_KEY}});
      const arr = await r.json();
      rec = Array.isArray(arr) ? arr[0] : null;
    }catch(e){}
  }
  const word = rec && rec.word ? rec.word : 'Орнамент';
  const desc = 'Орнамент-байткод «'+word+'» — його можна відсканувати й прочитати текст.';
  const img = rec && rec.image_url ? rec.image_url : SITE+'/og-image.png';
  const url = SITE+'/item/'+encodeURIComponent(id);
  const gallery = SITE+'/gallery.html?id='+encodeURIComponent(id);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=300');
  res.status(rec?200:404).send(
'<!DOCTYPE html><html lang="uk"><head>'+
'<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">'+
'<title>'+esc(word)+' · taina</title>'+
'<meta name="description" content="'+esc(desc)+'">'+
'<link rel="canonical" href="'+esc(url)+'">'+
'<meta property="og:type" content="website">'+
'<meta property="og:title" content="'+esc(word)+'">'+
'<meta property="og:description" content="'+esc(desc)+'">'+
'<meta property="og:image" content="'+esc(img)+'">'+
'<meta property="og:url" content="'+esc(url)+'">'+
'<meta name="twitter:card" content="summary_large_image">'+
'<meta name="twitter:image" content="'+esc(img)+'">'+
'<style>body{margin:0;background:#0d0a08;color:#ede3d0;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}img{width:min(80vw,420px);aspect-ratio:1;image-rendering:pixelated;border-radius:14px;background:#8a8580}h1{font-family:monospace;font-size:26px;margin:18px 0 6px}p{color:#94836a;margin:0 0 20px;max-width:520px}a{display:inline-block;margin:6px;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700;border:1px solid rgba(201,168,118,.5);color:#e8c890}a.solid{background:#c9a876;color:#15100b;border-color:#c9a876}</style>'+
'</head><body>'+
(img?'<img src="'+esc(img)+'" alt="'+esc(word)+'">':'')+
'<h1>'+esc(word)+'</h1>'+
'<p>'+esc(desc)+'</p>'+
'<a class="solid" href="'+esc(gallery)+'">🔗 Відкрити в галереї</a>'+
'<a href="'+SITE+'/index.html">✎ Створити свій</a>'+
'</body></html>');
};
