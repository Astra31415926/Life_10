/* КАРТА САЙТУ ДЛЯ ПОШУКОВИКІВ.
   Збирається сама з таблиці bytecodes: головна, галерея і сторінка
   кожного опублікованого орнаменту /item/<номер>.
   Відповідає за адресою /sitemap.xml (правило у vercel.json). */
const SUPA_URL = 'https://iieahzklwngqugkovhrs.supabase.co';
const SUPA_KEY = 'sb_publishable_FHtRNaLBvDgDTSLa_8eQnQ_oPMWCIxF';
const SITE = 'https://taina-ten.vercel.app';

module.exports = async (req, res) => {
  const rows = [];
  /* Supabase віддає не більше 1000 рядків за раз — беремо порціями */
  for (let from = 0; from < 50000; from += 1000) {
    let part = [];
    try {
      const r = await fetch(SUPA_URL + '/rest/v1/bytecodes?select=id,created_at&order=id.desc',
        { headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY,
                     Range: from + '-' + (from + 999) } });
      part = await r.json();
    } catch (e) { part = []; }
    if (!Array.isArray(part) || !part.length) break;
    rows.push(...part);
    if (part.length < 1000) break;
  }
  const day = s => (s ? String(s).slice(0, 10) : '');
  const newest = rows.length ? day(rows[0].created_at) : '';
  const url = (loc, lastmod, freq, prio) =>
    '<url><loc>' + loc + '</loc>' + (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') +
    '<changefreq>' + freq + '</changefreq><priority>' + prio + '</priority></url>';
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    url(SITE + '/', newest, 'weekly', '1.0') + '\n' +
    url(SITE + '/gallery.html', newest, 'daily', '0.8') + '\n' +
    rows.map(r => url(SITE + '/item/' + encodeURIComponent(r.id), day(r.created_at), 'monthly', '0.6')).join('\n') +
    '\n</urlset>\n';
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(body);
};
