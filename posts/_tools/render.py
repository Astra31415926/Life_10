"""Рендер орнаментов TAINA кодом самого сайта (Life_10/index.html) в безголовом Chromium.
Использование: python3 render.py <out_dir> <json-список заданий>
Задание: {"word":..., "g":palG, "i":palI, "motif":"none|rhomb|...", "shape":"square|cross|circle", "invert":false, "poster":true}
"""
import asyncio, base64, json, sys, os
from playwright.async_api import async_playwright
OUT = sys.argv[1]; JOBS = json.loads(sys.argv[2])
SIG = {"on": True, "v": "A", "orn": 80, "size": 66, "sp": 26, "gap1": 100, "gap2": 34}
async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1400, "height": 1000}, accept_downloads=True)
        await ctx.add_init_script("try{localStorage.setItem('taina_owner','1');localStorage.setItem('taina_admin','1');localStorage.setItem('taina_sig2',%s);}catch(e){}" % json.dumps(json.dumps(SIG)))
        async def route(r):
            if r.request.url.startswith("http://127.0.0.1:8765"): await r.continue_()
            else: await r.abort()
        await ctx.route("**/*", route)
        pg = await ctx.new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8765/index.html", wait_until="load")
        await pg.wait_for_timeout(2500)
        report = []
        for j in JOBS:
            res = await pg.evaluate("""(j) => {
                try { if (typeof tourStop==='function') tourStop(); } catch(e) {}
                isDemo=false; if (typeof setPurpose==='function') setPurpose('screen');
                if (typeof setLayers==='function') setLayers(1);
                palG=j.g; palI=j.i; motif=j.motif||'none'; motifK=4; shape=j.shape||'square'; invert=!!j.invert;
                try{ syncSeg('shape','s',shape); }catch(e){}
                try{ buildSwatches(); }catch(e){}
                D.single=j.word; refreshInputs(); build();
                const warn=document.getElementById('rt').innerText;
                return { warn, fld: document.getElementById('s-fld').textContent, png: OFF.toDataURL('image/png'), adm: !!window.TAINA_ADMIN };
            }""", j)
            tag = j.get("tag", "x")
            sq = f"{OUT}/{tag}_square.png"
            open(sq, "wb").write(base64.b64decode(res["png"].split(",")[1]))
            item = {"tag": tag, "word": j["word"], "field": res["fld"], "check": res["warn"] or "ok", "square": sq}
            if j.get("poster"):
                async with pg.expect_download() as dl:
                    await pg.evaluate("(w)=>window.saveImage(w,'web')", j["word"])
                d = await dl.value
                pp = f"{OUT}/{tag}_poster.png"; await d.save_as(pp); item["poster"] = pp
            report.append(item)
        print(json.dumps(report, ensure_ascii=False, indent=1))
        if errs: print("PAGE ERRORS:", errs[:3])
        await b.close()
asyncio.run(main())
