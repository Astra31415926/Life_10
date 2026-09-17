/* ═══════════════════════════════════════════════════════════════
   decoder.js — TAINA Bytecode Ornament decoder (pure JS + OpenCV scanner)
   Exports: window.runDecodeAttempts(imgElement) → [{kind,mode,n,res}]

   Маркер (від краю PNG до даних):
     QZ(2) → чорна(1) → біла(1) → зебра(1) → дані → зебра(1) → біла(1) → чорна(1) → QZ(2)

   Детектор знаходить кут ЧОРНОЇ рамки (не QZ), тому у warp-і:
     чорна(1)+біла(1)+зебра(1) = pad=3 з кожного боку → n = T - 6.
   Якщо вся картинка включає QZ — пробуємо також pad=5 (n = T - 10).
   ═══════════════════════════════════════════════════════════════ */
'use strict';
(function(){

/* ── Константи ── */
const MINN=7, MAXN=145, RGBTHR=125;
const RGB_SOFT={r:[220,50,60], g:[65,195,65], b:[60,70,215]};
const enc=new TextEncoder();
const dec=new TextDecoder('utf-8',{fatal:true});

/* ── Динамічне підключення OpenCV (якщо ще не підключено) ── */
if (!window.cv && !window._cvLoadingScript) {
  window._cvLoadingScript = true;
  const s = document.createElement('script');
  s.src = 'https://docs.opencv.org/4.8.0/opencv.js';
  s.async = true;
  document.head.appendChild(s);
}

/* ═══ CORE: текст ↔ біти ═══ */
function isClean(t){
  for(const ch of t){const o=ch.codePointAt(0);if(o===0||o<32&&ch!=='\n'&&ch!=='\t')return false;}
  return true;
}
function bytesToText(by){
  by=Array.from(by);
  while(by.length&&by[by.length-1]===0)by.pop();
  if(!by.length)return null;
  try{const t=dec.decode(new Uint8Array(by));return isClean(t)?t:null;}catch{return null;}
}
function textBits(t){
  const d=enc.encode(t),b=new Uint8Array(d.length*8);
  for(let i=0;i<d.length;i++)for(let k=0;k<8;k++)b[i*8+k]=(d[i]>>(7-k))&1;
  return b;
}

/* ═══ CORE: симетрія ═══ */
function Rof(n){return(n-1)/2;}
function baseCells(m,n){
  const c=Rof(n),o=[];
  if(m==='oct'){for(let i=0;i<=c;i++)for(let j=0;j<=i;j++)o.push([c+i,c+j]);}
  else if(m==='quad'){for(let i=0;i<=c;i++)for(let j=0;j<=c;j++)o.push([c+i,c+j]);}
  else{for(let y=0;y<n;y++)for(let i=0;i<=c;i++)o.push([c+i,y]);}
  return o;
}
function mirrors(m,n,x,y){
  const c=Rof(n),i=x-c,j=y-c;let p;
  if(m==='oct')p=[[i,j],[j,i],[-i,j],[-j,i],[i,-j],[j,-i],[-i,-j],[-j,-i]];
  else if(m==='quad')p=[[i,j],[-i,j],[i,-j],[-i,-j]];
  else p=[[i,j],[-i,j]];
  const o=[];
  for(const[a,b]of p){const X=c+a,Y=c+b;if(X>=0&&Y>=0&&X<n&&Y<n)o.push([X,Y]);}
  return o;
}
function capacity(m,n){const R=Rof(n);if(m==='oct')return(R+1)*(R+2)/2;if(m==='quad')return(R+1)*(R+1);if(m==='half')return(R+1)*n;return 0;}
function pickN(m,need){for(let n=MINN;n<=MAXN;n+=2)if(capacity(m,n)>=need)return n;return MAXN;}

/* ═══ CORE: декодування сектору ═══ */
function decodeSector(g,n,m,offset){
  const bc=baseCells(m,n),by=[];const start=offset||0;
  for(let i=start;i+7<bc.length;i+=8){
    let v=0;
    for(let b=0;b<8;b++){const[x,y]=bc[i+b];v=(v<<1)|(g[y*n+x]?1:0);}
    by.push(v);
  }
  return bytesToText(by);
}
function markCell(g,n,m){const[x,y]=baseCells(m,n)[0];return g[y*n+x]?1:0;}
function fillChannel(t,n,m,markBit){
  const g=new Uint8Array(n*n),bc=baseCells(m,n);
  let seq=textBits(t);
  if(markBit!=null){const s2=new Uint8Array(seq.length+1);s2[0]=markBit;s2.set(seq,1);seq=s2;}
  const lim=Math.min(seq.length,bc.length);
  for(let i=0;i<lim;i++){const[x,y]=bc[i];for(const[X,Y]of mirrors(m,n,x,y))if(seq[i])g[Y*n+X]=1;}
  return g;
}

/* ═══ CORE: row-режим ═══ */
function rowBuild(text,maxB){
  const chars=[...text],w=maxB*8,h=Math.max(chars.length,1);
  const g=new Uint8Array(w*h);
  chars.forEach((c,r)=>{const bs=enc.encode(c);for(let i=0;i<maxB;i++){const v=i<bs.length?bs[i]:0;for(let b=0;b<8;b++)g[r*w+i*8+b]=(v>>(7-b))&1;}});
  return{g,w,h};
}
function rowDecode(g,w,h){
  if(w%8)return null;const maxB=w/8;if(maxB<1||maxB>4)return null;
  let out='';
  for(let r=0;r<h;r++){
    const bs=[];
    for(let i=0;i<maxB;i++){let v=0;for(let b=0;b<8;b++)v=(v<<1)|g[r*w+i*8+b];bs.push(v);}
    while(bs.length&&bs[bs.length-1]===0)bs.pop();
    if(!bs.length)continue;
    try{out+=dec.decode(new Uint8Array(bs));}catch{return null;}
  }
  return(out&&isClean(out))?out:null;
}

/* ═══ SCAN: пікселі ═══ */
function lum(px,p){return(px[p]+px[p+1]+px[p+2])/3;}

function readChan(px,IW,T,pad,n,ci){
  const g=new Uint8Array(n*n),s=IW/T;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=(Math.floor((y+pad+.5)*s)*IW+Math.floor((x+pad+.5)*s))*4;
    const v=ci<0?lum(px,p):px[p+ci];
    g[y*n+x]=v>(ci<0?110:RGBTHR)?1:0;
  }
  return g;
}
function readRow(px,IW,IH,TW,pad,w,h,ci){
  const g=new Uint8Array(w*h),s=IW/TW;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(Math.floor((y+pad+.5)*s)*IW+Math.floor((x+pad+.5)*s))*4;
    const v=ci<0?lum(px,p):px[p+ci];
    g[y*w+x]=v>110?1:0;
  }
  return g;
}

/* ═══ SCAN: визначення розміру клітини ═══ */
function runsLine(getFn,len){
  let prev=-1,l=0,R=[];
  for(let i=0;i<len;i++){const c=getFn(i)>127?1:0;if(c===prev)l++;else{if(prev>=0)R.push(l);prev=c;l=1;}}
  R.push(l);return R;
}
function medianOf(a){const b=[...a].sort((x,y)=>x-y);return b[b.length>>1];}

function rulerEdge(lumFn,W,depth){
  const rows=[];
  for(let y=1;y<depth;y++){
    const rs=runsLine(x=>lumFn(x,y),W);if(rs.length<5)continue;
    const m=medianOf(rs);if(m<3)continue;
    let reg=0;for(const r of rs)if(r>=m*0.55&&r<=m*1.45)reg++;
    const frac=reg/rs.length;const count=rs.length;
    if(frac>=0.85&&count>=7&&count<=200&&m>=4)rows.push({m,frac,count});
  }
  if(rows.length<2)return null;
  const freq=new Map();for(const r of rows)freq.set(r.count,(freq.get(r.count)||0)+1);
  let T=null,fb=0;for(const[k,v]of freq)if(v>fb){fb=v;T=k;}
  return{T,cell:medianOf(rows.filter(r=>r.count===T).map(r=>r.m)),votes:fb};
}

function findRuler(px,IW,IH){
  if(IW!==IH)return null;
  const lumFn=(x,y)=>{const p=(y*IW+x)*4;return(px[p]+px[p+1]+px[p+2])/3;};
  const depth=Math.max(20,Math.floor(IW*0.22));
  const edges=[
    rulerEdge((x,y)=>lumFn(x,y),IW,depth),
    rulerEdge((x,y)=>lumFn(x,IH-1-y),IW,depth),
    rulerEdge((x,y)=>lumFn(y,x),IH,depth),
    rulerEdge((x,y)=>lumFn(IW-1-y,x),IH,depth),
  ].filter(Boolean);
  if(!edges.length)return null;
  const freq=new Map();for(const e of edges)freq.set(e.T,(freq.get(e.T)||0)+e.votes);
  let T=null,fb=0;for(const[k,v]of freq)if(v>fb){fb=v;T=k;}
  return{T,cell:medianOf(edges.filter(e=>e.T===T).map(e=>e.cell)),edges:edges.length};
}

/* ═══ SCAN: декод через лінійку ═══ */
function decodeByRuler(px,IW,IH,ruler){
  if(IW!==IH)return[];
  const T=ruler.T,cell=IW/T;const results=[];

  const sampleChan=(n,pad,ci)=>{
    const g=new Uint8Array(n*n);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const X=Math.min(IW-1,Math.floor((x+pad+.5)*cell));
      const Y=Math.min(IH-1,Math.floor((y+pad+.5)*cell));
      const p=(Y*IW+X)*4;const v=ci<0?lum(px,p):px[p+ci];
      g[y*n+x]=v>(ci<0?110:RGBTHR)?1:0;
    }
    return g;
  };

  for(let pad=2;pad<=8;pad++){
    const n=T-2*pad;if(n<MINN||n%2===0)continue;
    const cl=sampleChan(n,pad,-1),cr=sampleChan(n,pad,0),cg=sampleChan(n,pad,1),cb=sampleChan(n,pad,2);
    let sameRGB=true;for(let z=0;z<cr.length;z++){if(cr[z]!==cg[z]||cr[z]!==cb[z]){sameRGB=false;break;}}

    for(const m of['oct','quad','half']){
      const t=decodeSector(cl,n,m,0);
      if(t!==null){
        const chk=fillChannel(t,n,m,null);let same=true;
        for(let z=0;z<n*n&&same;z++)if((chk[z]?1:0)!==cl[z])same=false;
        if(same)results.push({kind:'one',mode:m,n,pad,res:[t,null,null]});
      }
      if(!sameRGB){
        if(markCell(cr,n,m)===1){
          const rR=decodeSector(cr,n,m,1),rG=decodeSector(cg,n,m,0),rB=decodeSector(cb,n,m,0);
          if(rR!==null)results.push({kind:'mono',mode:m,n,pad,res:[(rR||'')+(rG||'')+(rB||''),null,null]});
        }
        const tr=decodeSector(cr,n,m,0),tg=decodeSector(cg,n,m,0),tb=decodeSector(cb,n,m,0);
        const cnt=[tr,tg,tb].filter(x=>x!==null).length;
        if(cnt>=2){
          const ne=[tr,tg,tb].filter(x=>x!==null);
          if(!ne.every(x=>x===ne[0]))results.push({kind:'three',mode:m,n,pad,res:[tr,tg,tb]});
        }
      }
    }
  }
  return dedup(results);
}

/* ═══ SCAN: базовий pixel-scan ═══ */
function scanImage(px,IW,IH){
  const runs=[];
  for(const f of[.15,.25,.35,.5,.65,.75,.85]){
    const y=Math.floor(IH*f);let prev=-1,len2=0;
    for(let x=0;x<IW;x++){const cc=lum(px,(y*IW+x)*4)>127?1:0;if(cc===prev)len2++;else{if(prev>=0&&x>1&&x<IW-1)runs.push(len2);prev=cc;len2=1;}}
    const x0=Math.floor(IW*f);prev=-1;len2=0;
    for(let y2=0;y2<IH;y2++){const cc=lum(px,(y2*IW+x0)*4)>127?1:0;if(cc===prev)len2++;else{if(prev>=0&&y2>1&&y2<IH-1)runs.push(len2);prev=cc;len2=1;}}
  }
  if(!runs.length)return[];
  const freq=new Map();for(const r of runs)if(r>0)freq.set(r,(freq.get(r)||0)+1);
  const sorted=[...freq.entries()].sort((a,b)=>b[1]-a[1]);
  const cands=new Set();
  for(let i=0;i<Math.min(4,sorted.length);i++)cands.add(sorted[i][0]);
  cands.add(Math.min(...runs));

  const Tset=new Set();
  for(const mm of cands){
    if(mm<2)continue;
    for(const k of[1,2,.5]){const ms=Math.round(mm*k);if(ms>0&&IW%ms===0){const T=IW/ms;if(T>=MINN&&T<=200)Tset.add(T);}}
    for(const k of[1,2,.5]){const cell=mm*k;if(cell>=2){const Tc=IW/cell;for(const Tr of[Math.round(Tc),Math.floor(Tc),Math.ceil(Tc)]){if(Tr>=MINN&&Tr<=200)Tset.add(Tr);}}}
  }

  const results=[];
  if(IW===IH)for(const T of Tset){
    for(let pad=0;pad<=8;pad++){
      const n=T-2*pad;if(n<MINN||n%2===0)continue;
      const cr=readChan(px,IW,T,pad,n,0),cg=readChan(px,IW,T,pad,n,1),cb=readChan(px,IW,T,pad,n,2);
      const cl=readChan(px,IW,T,pad,n,-1);
      let sameRGB=true;for(let z=0;z<cr.length;z++){if(cr[z]!==cg[z]||cr[z]!==cb[z]){sameRGB=false;break;}}

      for(const m of['oct','quad','half']){
        {const t=decodeSector(cl,n,m,0);
         if(t!==null){const chk=fillChannel(t,n,m,null);let same=true;for(let z=0;z<n*n&&same;z++)if((chk[z]?1:0)!==cl[z])same=false;if(same)results.push({kind:'one',mode:m,n,pad,res:[t,null,null]});}}
        if(!sameRGB){
          if(markCell(cr,n,m)===1){const rR=decodeSector(cr,n,m,1),rG=decodeSector(cg,n,m,0),rB=decodeSector(cb,n,m,0);if(rR!==null)results.push({kind:'mono',mode:m,n,pad,res:[(rR||'')+(rG||'')+(rB||''),null,null]});}
          const tr=decodeSector(cr,n,m,0),tg=decodeSector(cg,n,m,0),tb=decodeSector(cb,n,m,0);
          const cnt=[tr,tg,tb].filter(x=>x!==null).length;
          if(cnt>=2){const ne=[tr,tg,tb].filter(x=>x!==null);if(!ne.every(x=>x===ne[0]))results.push({kind:'three',mode:m,n,pad,res:[tr,tg,tb]});}
        }
      }
    }
  }

  for(let pad=0;pad<=8;pad++)for(const w of[8,16,24,32]){
    const TW=w+pad*2;if(IW%TW)continue;
    const cell=IW/TW;if(IH%cell)continue;
    const TH=IH/cell,h=TH-pad*2;if(h<1||h>250)continue;
    const g=readRow(px,IW,IH,TW,pad,w,h,-1);const t=rowDecode(g,w,h);if(t===null)continue;
    let mb=1;for(const c of t){const k=enc.encode(c).length;if(k>mb)mb=k;}
    if(mb*8!==w)continue;
    const r=rowBuild(t,mb);if(r.w!==w||r.h!==h)continue;
    let same=true;for(let i=0;i<w*h&&same;i++)if((r.g[i]?1:0)!==(g[i]?1:0))same=false;
    if(same)results.push({kind:'one',mode:'row',n:w,pad,res:[t,null,null]});
  }

  return sortResults(dedup(results));
}

/* ═══ ЛОКАЛІЗАЦІЯ: знайти код серед сцени ═══ */
function findCodeBox(px,IW,IH){
  const GX=120,GY=Math.max(20,Math.round(120*IH/IW));
  const cw=IW/GX,ch=IH/GY;
  const avg=new Float64Array(GX*GY*3);
  for(let gy=0;gy<GY;gy++)for(let gx=0;gx<GX;gx++){
    let r=0,g=0,b=0,cnt=0;
    const x0=Math.floor(gx*cw),x1=Math.floor((gx+1)*cw),y0=Math.floor(gy*ch),y1=Math.floor((gy+1)*ch);
    for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const p=(y*IW+x)*4;r+=px[p];g+=px[p+1];b+=px[p+2];cnt++;}
    const i=(gy*GX+gx)*3;avg[i]=r/(cnt||1);avg[i+1]=g/(cnt||1);avg[i+2]=b/(cnt||1);
  }
  const edge=[];
  for(let gx=0;gx<GX;gx++){edge.push([gx,0]);edge.push([gx,GY-1]);}
  for(let gy=0;gy<GY;gy++){edge.push([0,gy]);edge.push([GX-1,gy]);}
  const compMed=k=>{const a=edge.map(([gx,gy])=>avg[(gy*GX+gx)*3+k]).sort((x,y)=>x-y);return a[a.length>>1];};
  const bg=[compMed(0),compMed(1),compMed(2)];
  const fg=new Uint8Array(GX*GY);
  for(let i=0;i<GX*GY;i++){const dr=avg[i*3]-bg[0],dg=avg[i*3+1]-bg[1],db=avg[i*3+2]-bg[2];if(Math.sqrt(dr*dr+dg*dg+db*db)>55)fg[i]=1;}
  const lab=new Int32Array(GX*GY);let cur=0,best=0,bestBox=null;const stack=[];
  for(let s=0;s<GX*GY;s++){
    if(!fg[s]||lab[s])continue;cur++;let cnt=0,minx=GX,miny=GY,maxx=0,maxy=0;
    stack.push(s);lab[s]=cur;
    while(stack.length){const p=stack.pop();const gx=p%GX,gy=(p/GX)|0;cnt++;
      if(gx<minx)minx=gx;if(gx>maxx)maxx=gx;if(gy<miny)miny=gy;if(gy>maxy)maxy=gy;
      const gxs=[gx-1,gx+1,gx,gx],gys=[gy,gy,gy-1,gy+1];
      for(let k=0;k<4;k++){const nx=gxs[k],ny=gys[k];if(nx<0||ny<0||nx>=GX||ny>=GY)continue;const q=ny*GX+nx;if(fg[q]&&!lab[q]){lab[q]=cur;stack.push(q);}}}
    if(cnt>best){best=cnt;bestBox=[minx,miny,maxx,maxy];}
  }
  if(!bestBox)return null;
  let x0=Math.floor(bestBox[0]*cw),y0=Math.floor(bestBox[1]*ch),x1=Math.ceil((bestBox[2]+1)*cw),y1=Math.ceil((bestBox[3]+1)*ch);
  const padX=cw*0.5,padY=ch*0.5;
  x0=Math.max(0,Math.floor(x0-padX));y0=Math.max(0,Math.floor(y0-padY));
  x1=Math.min(IW,Math.ceil(x1+padX));y1=Math.min(IH,Math.ceil(y1+padY));
  return{x0,y0,w:x1-x0,h:y1-y0};
}

function cropPx(px,IW,IH,box){
  const{x0,y0,w,h}=box;const out=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const src=((y0+y)*IW+(x0+x))*4,dst=(y*w+x)*4;
    out[dst]=px[src];out[dst+1]=px[src+1];out[dst+2]=px[src+2];out[dst+3]=255;
  }
  return out;
}

/* ═══ ЛОКАЛІЗАЦІЯ: кути по градієнту ═══ */
function gradCorners(px,IW,IH,G){
  const lumFn=p=>(px[p*4]+px[p*4+1]+px[p*4+2])/3;
  const cw=IW/G,ch=IH/G;const gr=new Float64Array(G*G);
  for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){
    let s=0,c=0;
    const x0=Math.floor(gx*cw),x1=Math.floor((gx+1)*cw),y0=Math.floor(gy*ch),y1=Math.floor((gy+1)*ch);
    for(let y=y0+1;y<y1-1;y+=2)for(let x=x0+1;x<x1-1;x+=2){
      const gxv=Math.abs(lumFn(y*IW+x+1)-lumFn(y*IW+x-1)),gyv=Math.abs(lumFn((y+1)*IW+x)-lumFn((y-1)*IW+x));
      s+=gxv+gyv;c++;
    }
    gr[gy*G+gx]=c?s/c:0;
  }
  const mx=Math.max(...gr),thr=mx*0.18;
  const fg=gr.map(v=>v>=thr?1:0);
  const dil=new Uint8Array(G*G);
  for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){
    let any=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=gx+dx,ny=gy+dy;if(nx>=0&&ny>=0&&nx<G&&ny<G&&fg[ny*G+nx])any=1;}
    dil[gy*G+gx]=any;
  }
  const lab=new Int32Array(G*G);let cur=0,best=0,bestPts=null;const st=[];
  for(let s=0;s<G*G;s++){
    if(!dil[s]||lab[s])continue;cur++;const pts=[];st.push(s);lab[s]=cur;
    while(st.length){const p=st.pop();pts.push(p);const gx=p%G,gy=(p/G)|0;
      for(const[nx,ny]of[[gx-1,gy],[gx+1,gy],[gx,gy-1],[gx,gy+1]]){
        if(nx<0||ny<0||nx>=G||ny>=G)continue;const q=ny*G+nx;if(dil[q]&&!lab[q]){lab[q]=cur;st.push(q);}}}
    if(pts.length>best){best=pts.length;bestPts=pts;}
  }
  if(!bestPts||best<8)return null;
  let TL,TR,BR,BL;
  for(const p of bestPts){const gx=p%G,gy=(p/G)|0;const X=(gx+0.5)*cw,Y=(gy+0.5)*ch;const s=X+Y,d=X-Y;
    if(!TL||s<TL.s)TL={X,Y,s};if(!BR||s>BR.s)BR={X,Y,s};if(!TR||d>TR.d)TR={X,Y,d};if(!BL||d<BL.d)BL={X,Y,d};}
  const dd=(a,b)=>Math.hypot(a.X-b.X,a.Y-b.Y);
  const side=(dd(TL,TR)+dd(TR,BR)+dd(BR,BL)+dd(BL,TL))/4;
  return{TL:[TL.X,TL.Y],TR:[TR.X,TR.Y],BR:[BR.X,BR.Y],BL:[BL.X,BL.Y],side};
}

/* ═══ ЛОКАЛІЗАЦІЯ: deskew ═══ */
function gaussElim(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){let mr=c,mv=Math.abs(M[c][c]);for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>mv){mv=Math.abs(M[r][c]);mr=r;}[M[c],M[mr]]=[M[mr],M[c]];const pv=M[c][c];if(Math.abs(pv)<1e-12)return null;for(let r=c+1;r<n;r++){const f=M[r][c]/pv;for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}}
  const x=new Array(n).fill(0);for(let i=n-1;i>=0;i--){x[i]=M[i][n];for(let j=i+1;j<n;j++)x[i]-=M[i][j]*x[j];x[i]/=M[i][i];}return x;
}
function computeH(s4,d4){
  const rows=[],rhs=[];
  for(let i=0;i<4;i++){const sx=s4[i].x,sy=s4[i].y,dx=d4[i].x,dy=d4[i].y;rows.push([sx,sy,1,0,0,0,-sx*dx,-sy*dx]);rhs.push(dx);rows.push([0,0,0,sx,sy,1,-sx*dy,-sy*dy]);rhs.push(dy);}
  const h=gaussElim(rows,rhs);if(!h)return null;return[[h[0],h[1],h[2]],[h[3],h[4],h[5]],[h[6],h[7],1]];
}
function inv3(M){
  const[[a,b,c],[d,e,f],[g,h,k]]=M;const dt=a*(e*k-f*h)-b*(d*k-f*g)+c*(d*h-e*g);
  if(Math.abs(dt)<1e-12)return null;
  return[[(e*k-f*h)/dt,(c*h-b*k)/dt,(b*f-c*e)/dt],[(f*g-d*k)/dt,(a*k-c*g)/dt,(c*d-a*f)/dt],[(d*h-e*g)/dt,(b*g-a*h)/dt,(a*e-b*d)/dt]];
}
function deskew(px,IW,IH,corners,N){
  const{TL,TR,BR,BL}=corners;
  const x0=TL[0],y0=TL[1],x1=TR[0],y1=TR[1],x2=BR[0],y2=BR[1],x3=BL[0],y3=BL[1];
  const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  let a,b,cc,d,e,f,gg,hh;
  if(Math.abs(dx3)<1e-9&&Math.abs(dy3)<1e-9){a=x1-x0;b=x3-x0;cc=x0;d=y1-y0;e=y3-y0;f=y0;gg=0;hh=0;}
  else{const den=dx1*dy2-dx2*dy1;gg=(dx3*dy2-dx2*dy3)/den;hh=(dx1*dy3-dx3*dy1)/den;a=x1-x0+gg*x1;b=x3-x0+hh*x3;cc=x0;d=y1-y0+gg*y1;e=y3-y0+hh*y3;f=y0;}
  const samp=(x,y,ch)=>{
    const xi=Math.max(0,Math.min(IW-1,Math.floor(x))),yi=Math.max(0,Math.min(IH-1,Math.floor(y)));
    const xfr=Math.max(0,Math.min(1,x-xi)),yfr=Math.max(0,Math.min(1,y-yi));
    const x1_=Math.min(IW-1,xi+1),y1_=Math.min(IH-1,yi+1);
    const A=px[(yi*IW+xi)*4+ch],B=px[(yi*IW+x1_)*4+ch],D=px[(y1_*IW+xi)*4+ch],E=px[(y1_*IW+x1_)*4+ch];
    return A*(1-xfr)*(1-yfr)+B*xfr*(1-yfr)+D*(1-xfr)*yfr+E*xfr*yfr;
  };
  const out=new Uint8ClampedArray(N*N*4);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const u=i/(N-1),v=j/(N-1);const den=gg*u+hh*v+1;
    const x=(a*u+b*v+cc)/den,y=(d*u+e*v+f)/den;const dst=(j*N+i)*4;
    out[dst]=samp(x,y,0);out[dst+1]=samp(x,y,1);out[dst+2]=samp(x,y,2);out[dst+3]=255;
  }
  return out;
}

/* ═══ ЛОКАЛІЗАЦІЯ: findOrnament (activity scan) ═══ */
function findOrnament(px,IW,IH){
  const lumFn=p=>(px[p]+px[p+1]+px[p+2])/3;
  const rowAct=new Array(IH).fill(0),colAct=new Array(IW).fill(0);
  for(let y=0;y<IH;y++){let prev=-1,tr=0;for(let x=0;x<IW;x+=2){const cc=lumFn((y*IW+x)*4)>127?1:0;if(cc!==prev){tr++;prev=cc;}}rowAct[y]=tr;}
  for(let x=0;x<IW;x++){let prev=-1,tr=0;for(let y=0;y<IH;y+=2){const cc=lumFn((y*IW+x)*4)>127?1:0;if(cc!==prev){tr++;prev=cc;}}colAct[x]=tr;}
  const maxRow=Math.max(...rowAct),maxCol=Math.max(...colAct);
  const rowThr=Math.max(4,maxRow*0.25),colThr=Math.max(4,maxCol*0.25);
  function longestBlock(act,thr){
    let bestS=0,bestE=-1,curS=-1,gap=0;const maxGap=Math.max(8,act.length*0.03);
    for(let i=0;i<act.length;i++){if(act[i]>=thr){if(curS<0)curS=i;gap=0;if(i-curS>bestE-bestS){bestS=curS;bestE=i;}}else{if(curS>=0){gap++;if(gap>maxGap){curS=-1;gap=0;}}}}
    return[bestS,bestE];
  }
  let[y0,y1]=longestBlock(rowAct,rowThr),[x0,x1]=longestBlock(colAct,colThr);
  if(y1<=y0||x1<=x0)return null;
  const side=Math.max(x1-x0,y1-y0),cx=(x0+x1)/2,cy=(y0+y1)/2;
  let nx0=Math.max(0,Math.round(cx-side/2)),ny0=Math.max(0,Math.round(cy-side/2));
  let nx1=Math.min(IW,nx0+side),ny1=Math.min(IH,ny0+side);
  const cropW=nx1-nx0,cropH=ny1-ny0;
  if(cropW<20||cropH<20)return null;
  return{x0:nx0,y0:ny0,w:cropW,h:cropH};
}

/* ═══ БУФЕР ═══ */
function buildBuffer(img){
  const AS=Math.max(512,Math.min(1500,Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height)));
  const cc=document.createElement('canvas');cc.width=AS;cc.height=AS;
  const g=cc.getContext('2d',{willReadFrequently:true});
  const tmp=document.createElement('canvas');tmp.width=img.naturalWidth||img.width;tmp.height=img.naturalHeight||img.height;
  const tg=tmp.getContext('2d',{willReadFrequently:true});tg.drawImage(img,0,0);
  const cp=tg.getImageData(0,0,1,1).data;
  g.fillStyle='rgb('+cp[0]+','+cp[1]+','+cp[2]+')';g.fillRect(0,0,AS,AS);
  const scale=Math.min(AS/(img.naturalWidth||img.width),AS/(img.naturalHeight||img.height));
  const w=(img.naturalWidth||img.width)*scale,h=(img.naturalHeight||img.height)*scale;
  g.imageSmoothingEnabled=true;g.drawImage(img,(AS-w)/2,(AS-h)/2,w,h);
  return{px:g.getImageData(0,0,AS,AS).data,IW:AS,IH:AS};
}
function buildBufferFromCanvas(canvas){
  const AS=Math.max(512,Math.min(1500,Math.max(canvas.width,canvas.height)));
  const cc=document.createElement('canvas');cc.width=AS;cc.height=AS;
  const g=cc.getContext('2d',{willReadFrequently:true});
  g.imageSmoothingEnabled=true;g.drawImage(canvas,0,0,AS,AS);
  return{px:g.getImageData(0,0,AS,AS).data,IW:AS,IH:AS};
}

/* ═══ УТИЛІТИ ═══ */
function dedup(results){
  const seen=new Set(),uniq=[];
  for(const r of results){const key=(r.kind||'')+'|'+r.res.join('\u0001');if(!seen.has(key)){seen.add(key);uniq.push(r);}}
  return uniq;
}
function sortResults(results){
  return results.sort((a,b)=>{
    const al=a.res.filter(x=>x).join('').length,bl=b.res.filter(x=>x).join('').length;
    if(al!==bl)return bl-al;
    if(a.kind==='three'&&b.kind==='three'){const ax=a.res.filter(x=>x).length,bx=b.res.filter(x=>x).length;if(ax!==bx)return bx-ax;}
    return(a.n||0)-(b.n||0);
  });
}

function collect(all,px,IW,IH){
  try{const ru=findRuler(px,IW,IH);if(ru){const rr=decodeByRuler(px,IW,IH,ru);if(rr.length)all.push(...rr);}}catch(e){}
  try{const f=scanImage(px,IW,IH);if(f.length)all.push(...f);}catch(e){}
}
function hasSolid(all){return all.some(r=>r.kind==='one'||r.kind==='three'||r.kind==='mono');}


/* ═══════════════════════════════════════════════════════════════
   ZEBRA V9 SCANNER CORE (OpenCV)
   ═══════════════════════════════════════════════════════════════ */
const CROP_SIZE = 500;
const CROP_MARGIN = 35;

function orderCorners(pts){
  const cx=pts.reduce((s,p)=>s+p.x,0)/4;
  const cy=pts.reduce((s,p)=>s+p.y,0)/4;
  const withAngle=pts.map(p=>({...p,a:Math.atan2(p.y-cy,p.x-cx)}));
  withAngle.sort((a,b)=>a.a-b.a);
  let startIdx=0,bestD=Infinity;
  withAngle.forEach((p,i)=>{let d=Math.abs(p.a-(-3*Math.PI/4));if(d>Math.PI)d=2*Math.PI-d;if(d<bestD){bestD=d;startIdx=i;}});
  const out=[];
  for(let i=0;i<4;i++)out.push(withAngle[(startIdx+i)%4]);
  return out.map(p=>({x:p.x,y:p.y}));
}
function squareness(p){
  const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const sides=[d(p[0],p[1]),d(p[1],p[2]),d(p[2],p[3]),d(p[3],p[0])];
  const mn=Math.min(...sides),mx=Math.max(...sides);
  if(mx===0)return 0;
  const d1=d(p[0],p[2]),d2=d(p[1],p[3]);
  return (mn/mx)*(Math.min(d1,d2)/Math.max(d1,d2));
}
function readRing(px,inset,SZ){
  const a=inset,b=SZ-1-inset;
  if(b-a<40)return null;
  const top=[],bottom=[],left=[],right=[];
  for(let x=a;x<=b;x++){top.push(px(x,a));bottom.push(px(x,b));}
  for(let y=a;y<=b;y++){left.push(px(a,y));right.push(px(b,y));}
  const sides=[top,bottom,left,right];
  let alt=0,tot=0;
  for(const s of sides)for(let i=0;i<s.length-1;i++){if(s[i]!==s[i+1])alt++;tot++;}
  const altRatio=tot?alt/tot:0;
  let dark=0,cnt=0;
  for(const s of sides)for(const v of s){dark+=v;cnt++;}
  const darkRatio=cnt?dark/cnt:0;
  const balance=1-Math.abs(darkRatio-0.5)*2;
  function countCells(arr){const runs=[];let cur=arr[0],c2=1;for(let i=1;i<arr.length;i++){if(arr[i]===cur)c2++;else{runs.push(c2);cur=arr[i];c2=1;}}runs.push(c2);if(runs.length<5)return null;const inner=runs.slice(1,-1).filter(r=>r>=1);if(inner.length<3)return null;const sorted=[...inner].sort((a,b)=>a-b);const unit=sorted[Math.floor(sorted.length/2)];if(unit<2)return null;return Math.round(arr.length/unit);}
  const counts=sides.map(s=>countCells(s)).filter(c=>c);
  if(counts.length<4)return null;
  const mn=Math.min(...counts),mx=Math.max(...counts);
  const agr=mx>0?mn/mx:0;
  const totalCells=Math.round(counts.reduce((x,y)=>x+y,0)/counts.length);
  const cornersDark=[px(a+2,a+2),px(b-2,a+2),px(b-2,b-2),px(a+2,b-2)].reduce((s,v)=>s+v,0)/4;
  if(totalCells<6||totalCells>120)return null;
  return{score:altRatio*0.35+balance*0.2+agr*0.25+cornersDark*0.2,totalCells};
}
function analyseQuad(gray,pts){
  const SZ=CROP_SIZE;
  let srcTri,dstTri,M,warped,wbin;
  try{
    srcTri=cv.matFromArray(4,1,cv.CV_32FC2,[pts[0].x,pts[0].y,pts[1].x,pts[1].y,pts[2].x,pts[2].y,pts[3].x,pts[3].y]);
    dstTri=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,SZ,0,SZ,SZ,0,SZ]);
    M=cv.getPerspectiveTransform(srcTri,dstTri);
    warped=new cv.Mat();
    cv.warpPerspective(gray,warped,M,new cv.Size(SZ,SZ),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(127));
    wbin=new cv.Mat();
    cv.threshold(warped,wbin,0,255,cv.THRESH_BINARY_INV|cv.THRESH_OTSU);
    const d=wbin.data;
    const px=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||x>=SZ||y<0||y>=SZ)return 0;return d[y*SZ+x]>0?1:0;};
    let bestRing=null;
    for(const inset of[2,4,6,9,12,16,22,30]){const ring=readRing(px,inset,SZ);if(!ring)continue;if(!bestRing||ring.score>bestRing.score)bestRing={...ring,inset};}
    if(!bestRing)return null;
    return{score:bestRing.score,totalCells:bestRing.totalCells,gridN:Math.max(1,bestRing.totalCells-2)};
  }catch(e){return null;}
  finally{[srcTri,dstTri,M,warped,wbin].forEach(m=>{try{if(m)m.delete();}catch(e){}});}
}

function scannerLocate(srcCanvas,quiet){
  if(!window.cv || !window.cv.Mat) return null;
  let src,gray,blur,bin,contours,hier;
  const mats=[];
  try{
    src=cv.imread(srcCanvas);mats.push(src);
    const W=src.cols,H=src.rows;
    gray=new cv.Mat();mats.push(gray);
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    blur=new cv.Mat();mats.push(blur);
    cv.GaussianBlur(gray,blur,new cv.Size(5,5),0);
    bin=new cv.Mat();mats.push(bin);
    const blockSize=(Math.floor(Math.min(W,H)/20)*2+1);
    cv.adaptiveThreshold(blur,bin,255,cv.ADAPTIVE_THRESH_MEAN_C,cv.THRESH_BINARY_INV,Math.max(11,Math.min(151,blockSize)),7);
    contours=new cv.MatVector();mats.push(contours);
    hier=new cv.Mat();mats.push(hier);
    cv.findContours(bin,contours,hier,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);

    const minArea=W*H*0.004,maxArea=W*H*0.98;
    const quads=[];
    for(let i=0;i<contours.size();i++){
      const cnt=contours.get(i);
      const area=cv.contourArea(cnt);
      if(area<minArea||area>maxArea){cnt.delete();continue;}
      const peri=cv.arcLength(cnt,true);
      const approx=new cv.Mat();
      cv.approxPolyDP(cnt,approx,0.04*peri,true);
      if(approx.rows===4&&cv.isContourConvex(approx)){
        const pts=[];
        for(let p=0;p<4;p++)pts.push({x:approx.data32S[p*2],y:approx.data32S[p*2+1]});
        const ord=orderCorners(pts);
        if(squareness(ord)>0.55)quads.push({pts:ord,area});
      }
      approx.delete();cnt.delete();
    }
    if(!quads.length)return null;

    quads.sort((a,b)=>b.area-a.area);
    let best=null;
    for(const q of quads.slice(0,25)){
      const res=analyseQuad(gray,q.pts);
      if(!res)continue;
      if(!best||res.score>best.score)best={...res,pts:q.pts};
    }
    if(!best||best.score<0.35)return null;

    // ── Вирізка з БІЛИМ ПОЛЕМ ──
    const P=best.pts,M0=CROP_MARGIN,E=CROP_SIZE-CROP_MARGIN;
    let src2,dst,st,dt,M2;
    try{
      src2=cv.imread(srcCanvas);
      dst=new cv.Mat();
      st=cv.matFromArray(4,1,cv.CV_32FC2,[P[0].x,P[0].y,P[1].x,P[1].y,P[2].x,P[2].y,P[3].x,P[3].y]);
      dt=cv.matFromArray(4,1,cv.CV_32FC2,[M0,M0,E,M0,E,E,M0,E]);
      M2=cv.getPerspectiveTransform(st,dt);
      cv.warpPerspective(src2,dst,M2,new cv.Size(CROP_SIZE,CROP_SIZE),
        cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
      const out=document.createElement('canvas');out.width=CROP_SIZE;out.height=CROP_SIZE;
      cv.imshow(out,dst);
      return{canvas:out,totalCells:best.totalCells};
    }finally{[src2,dst,st,dt,M2].forEach(m=>{try{if(m)m.delete();}catch(e){}});}
  }catch(e){
    return null;
  }finally{
    mats.forEach(m=>{try{m.delete();}catch(e){}});
  }
}

/* ═══════════════════════════════════════════════════════════════
   RAW DECODE PIPELINE (Існуюча логіка Life_10)
   ═══════════════════════════════════════════════════════════════ */
function decodeRawPx(px,IW,IH){
  const all=[];
  const done=()=>{if(!all.length)return[];const u=dedup(all);return sortResults(u);};

  /* Шлях 1: пряме читання */
  collect(all,px,IW,IH);
  if(hasSolid(all))return done();

  /* Шлях 2: локалізація по кольору фону → кроп → читання */
  try{
    const box=findCodeBox(px,IW,IH);
    if(box){
      for(const sf of[1.0,1.06,1.12,1.20]){
        const side=Math.round(Math.max(box.w,box.h)*sf);
        const cx=box.x0+box.w/2,cy=box.y0+box.h/2;
        let nx=Math.max(0,Math.round(cx-side/2)),ny=Math.max(0,Math.round(cy-side/2));
        const ss=Math.min(side,IW-nx,IH-ny);if(ss<40)continue;
        const c=cropPx(px,IW,IH,{x0:nx,y0:ny,w:ss,h:ss});
        collect(all,c,ss,ss);
        if(hasSolid(all))return done();
      }
    }
  }catch(e){}

  /* Шлях 3: activity scan → кроп */
  try{
    const box=findOrnament(px,IW,IH);
    if(box){const c=cropPx(px,IW,IH,box);collect(all,c,box.w,box.h);}
  }catch(e){}
  if(hasSolid(all))return done();

  /* Шлях 4: кути по градієнту → deskew */
  try{
    const cor=gradCorners(px,IW,IH,120);
    if(cor){
      for(const ef of[1.0,1.04,0.97]){
        const cx=(cor.TL[0]+cor.TR[0]+cor.BR[0]+cor.BL[0])/4,cy=(cor.TL[1]+cor.TR[1]+cor.BR[1]+cor.BL[1])/4;
        const exp=c=>[cx+(c[0]-cx)*ef,cy+(c[1]-cy)*ef];
        const cc={TL:exp(cor.TL),TR:exp(cor.TR),BR:exp(cor.BR),BL:exp(cor.BL)};
        const N=Math.max(256,Math.min(1200,Math.round(cor.side*ef)));
        const d=deskew(px,IW,IH,cc,N);
        collect(all,d,N,N);
        if(hasSolid(all))return done();
      }
    }
  }catch(e){}

  return done();
}

/* ═══ ГОЛОВНА ФУНКЦІЯ ═══ */
function runDecodeAttempts(img){
  const isCanvas=img instanceof HTMLCanvasElement;

  // Спроба 1: Використання нового OpenCV сканера для локалізації, вирізки та корекції перспективи
  if (window.cv && window.cv.Mat && window.cv.imread) {
    try {
      let srcCanvas = img;
      if (!isCanvas) {
        srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.naturalWidth || img.width;
        srcCanvas.height = img.naturalHeight || img.height;
        srcCanvas.getContext('2d').drawImage(img, 0, 0);
      }
      
      const located = scannerLocate(srcCanvas, true); 
      if (located && located.canvas) {
        const buf = buildBufferFromCanvas(located.canvas);
        const results = decodeRawPx(buf.px, buf.IW, buf.IH);
        if (results.length > 0) return results;
      }
    } catch(e) {
      console.warn("OpenCV scanner failed, falling back to standard decode:", e);
    }
  }

  // Спроба 2: Стандартний декодер (якщо OpenCV недоступний або сканер нічого не знайшов)
  const buf = isCanvas ? buildBufferFromCanvas(img) : buildBuffer(img);
  return decodeRawPx(buf.px, buf.IW, buf.IH);
}

/* ── публічний API ── */
window.runDecodeAttempts=runDecodeAttempts;

})();
