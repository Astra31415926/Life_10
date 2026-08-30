// decoder.js

function scanImage(px,IW,IH){
  const lum=p=>(px[p]+px[p+1]+px[p+2])/3;
  const measure=()=>{
    const runs=[];
    for(const f of [.15,.25,.35,.5,.65,.75,.85]){
      const y=Math.floor(IH*f);let prev=-1,len=0;
      for(let x=0;x<IW;x++){const cc=lum((y*IW+x)*4)>127?1:0;if(cc===prev)len++;else{if(prev>=0&&x>1&&x<IW-1)runs.push(len);prev=cc;len=1}}
      const x0=Math.floor(IW*f);prev=-1;len=0;
      for(let y2=0;y2<IH;y2++){const cc=lum((y2*IW+x0)*4)>127?1:0;if(cc===prev)len++;else{if(prev>=0&&y2>1&&y2<IH-1)runs.push(len);prev=cc;len=1}}}
    if(!runs.length)return [];
    const freq=new Map();for(const r of runs)if(r>0)freq.set(r,(freq.get(r)||0)+1);
    const sorted=[...freq.entries()].sort((a,b)=>b[1]-a[1]);
    const cands=new Set();for(let i=0;i<Math.min(4,sorted.length);i++)cands.add(sorted[i][0]);
    cands.add(Math.min(...runs));return [...cands].filter(m=>m>0)
  };
  const mmCands=measure();
  const readChan=(T,pad,n,ci)=>{const g=new Uint8Array(n*n),s=IW/T,sy=IH/T;for(let y=0;y<n;y++)for(let x=0;x<n;x++){const p=(Math.floor((y+pad+.5)*sy)*IW+Math.floor((x+pad+.5)*s))*4;const v=ci<0?lum(p):px[p+ci];g[y*n+x]=v>(ci<0?110:RGBTHR)?1:0;}return g;};
  const readRow=(TW,pad,w,h,ci)=>{const g=new Uint8Array(w*h),s=IW/TW;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(Math.floor((y+pad+.5)*s)*IW+Math.floor((x+pad+.5)*s))*4;const v=ci<0?lum(p):px[p+ci];g[y*w+x]=v>110?1:0;}return g;};
  const Tset=new Set();
  for(const mm of mmCands){if(mm<2)continue;for(const k of [1,2,.5]){const ms=Math.round(mm*k);if(ms>0&&IW%ms===0){const T=IW/ms;if(T>=MINN&&T<=200)Tset.add(T)}}for(const k of [1,2,.5]){const cell=mm*k;if(cell>=2){const Tc=IW/cell;for(const Tr of [Math.round(Tc),Math.floor(Tc),Math.ceil(Tc)]){if(Tr>=MINN&&Tr<=200)Tset.add(Tr);}}}}
  const results=[];
  if(IW===IH)for(const T of Tset){for(const pad of [0,1,2]){const n=T-2*pad;if(n<MINN||n%2===0)continue;const cr=readChan(T,pad,n,0),cg=readChan(T,pad,n,1),cb=readChan(T,pad,n,2);const cl=readChan(T,pad,n,-1);let sameRGB=true;for(let z=0;z<cr.length;z++){if(cr[z]!==cg[z]||cr[z]!==cb[z]){sameRGB=false;break}}for(const m of ['oct','quad','half']){{const t=decodeSector(cl,n,m,0);if(t!==null){const chk=fillChannel(t,n,m,null);let same=true;for(let z=0;z<n*n&&same;z++)if((chk.g[z]?1:0)!==cl[z])same=false;if(same)results.push({kind:'one',mode:m,n,pad,res:[t,null,null]});}}if(!sameRGB){if(markCell(cr,n,m)===1){const rR=decodeSector(cr,n,m,1),rG=decodeSector(cg,n,m,0),rB=decodeSector(cb,n,m,0);if(rR!==null)results.push({kind:'mono',mode:m,n,pad,res:[(rR||'')+(rG||'')+(rB||''),null,null]});}const tr=decodeSector(cr,n,m,0),tg=decodeSector(cg,n,m,0),tb=decodeSector(cb,n,m,0);const cnt=[tr,tg,tb].filter(x=>x!==null).length;if(cnt>=2){const nonEmpty=[tr,tg,tb].filter(x=>x!==null);const allSame=nonEmpty.every(x=>x===nonEmpty[0]);if(!allSame)results.push({kind:'three',mode:m,n,pad,res:[tr,tg,tb]});}}}}}
  for(const pad of [0,1,2])for(const w of [8,16,24,32]){const TW=w+pad*2;if(IW%TW)continue;const cell=IW/TW;if(IH%cell)continue;if(mmCands.length&&!mmCands.some(mm=>Math.abs(cell-mm)<=1.5||Math.abs(cell-mm*2)<=1.5))continue;const TH=IH/cell,h=TH-pad*2;if(h<1||h>250)continue;const g=readRow(TW,pad,w,h,-1);const t=rowDecode(g,w,h);if(t===null)continue;let mb=1;for(const c of t){const k=enc.encode(c).length;if(k>mb)mb=k}if(mb*8!==w)continue;const r=rowBuild(t,mb);if(r.w!==w||r.h!==h)continue;let same=true;for(let i=0;i<w*h&&same;i++)if((r.g[i]?1:0)!==(g[i]?1:0))same=false;if(same)results.push({kind:'one',mode:'row',n:w,pad,res:[t,null,null]});}
  const seen=new Set(),uniq=[];for(const r of results){const key=r.kind+'|'+r.res.join('\u0001');if(!seen.has(key)){seen.add(key);uniq.push(r)}}
  uniq.sort((a,b)=>{const al=a.res.filter(x=>x).join('').length,bl=b.res.filter(x=>x).join('').length;if(al!==bl)return bl-al;const ax=a.kind==='three'?a.res.filter(x=>x).length:9;const bx=b.kind==='three'?b.res.filter(x=>x).length:9;if(a.kind==='three'&&b.kind==='three'&&ax!==bx)return bx-ax;return a.n-b.n;});
  if(uniq.length>1){const topLen=uniq[0].res.filter(x=>x).join('').length;if(topLen>=3){const filtered=uniq.filter(r=>r.res.filter(x=>x).join('').length>=3);if(filtered.length)return filtered;}}
  return uniq;
}

function ruler_runs(get,len){let prev=-1,l=0,runs=[];for(let i=0;i<len;i++){const c=get(i)>127?1:0;if(c===prev)l++;else{if(prev>=0)runs.push(l);prev=c;l=1;}}runs.push(l);return runs;}
function ruler_median(a){const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)];}
function ruler_score(runs){if(runs.length<5)return null;const m=ruler_median(runs);if(m<3)return null;let reg=0;for(const r of runs)if(r>=m*0.55&&r<=m*1.45)reg++;return {m,frac:reg/runs.length,count:runs.length};}
function ruler_edge(lumFn,W,depth){const rows=[];for(let y=1;y<depth;y++){const s=ruler_score(ruler_runs(x=>lumFn(x,y),W));if(s&&s.frac>=0.85&&s.count>=7&&s.count<=200&&s.m>=4)rows.push(s);}if(rows.length<2)return null;const freq=new Map();for(const r of rows)freq.set(r.count,(freq.get(r.count)||0)+1);let T=null,fb=0;for(const [k,v] of freq)if(v>fb){fb=v;T=k;}return {T,cell:ruler_median(rows.filter(r=>r.count===T).map(r=>r.m)),votes:fb};}
function findRuler(px,IW,IH){if(IW!==IH)return null;const lum=(x,y)=>{const p=(y*IW+x)*4;return (px[p]+px[p+1]+px[p+2])/3;};const depth=Math.max(20,Math.floor(IW*0.09));const edges=[ruler_edge((x,y)=>lum(x,y),IW,depth),ruler_edge((x,y)=>lum(x,IH-1-y),IW,depth),ruler_edge((x,y)=>lum(y,x),IW,depth),ruler_edge((x,y)=>lum(IW-1-y,x),IW,depth)].filter(Boolean);if(!edges.length)return null;const freq=new Map();for(const e of edges)freq.set(e.T,(freq.get(e.T)||0)+e.votes);let T=null,fb=0;for(const [k,v] of freq)if(v>fb){fb=v;T=k;}return {T,cell:ruler_median(edges.filter(e=>e.T===T).map(e=>e.cell)),edges:edges.length};}

const VOTE_MARGIN=0.5, VOTE_AGREE=0.90;
function decodeVoted(g,n,m,offset){const bc=baseCells(m,n),by=[],margins=[];const start=offset||0;for(let i=start;i+7<bc.length;i+=8){let v=0;for(let b=0;b<8;b++){const [x,y]=bc[i+b];const cells=mirrors(m,n,x,y);let ones=0;for(const [X,Y] of cells)ones+=g[Y*n+X]?1:0;const cnt=cells.length;let bit;if(ones*2>cnt)bit=1;else if(ones*2<cnt)bit=0;else bit=g[y*n+x]?1:0;margins.push(Math.abs(2*ones-cnt)/cnt);v=(v<<1)|bit;}by.push(v);}return {text:bytesToText(by),minMargin:margins.length?Math.min(...margins):0};}
function recoverVoted(g,n,m,offset,markBit){const v=decodeVoted(g,n,m,offset);if(v.text===null||v.minMargin<VOTE_MARGIN)return null;const chk=fillChannel(v.text,n,m,markBit);let tot=0,match=0;for(let i=0;i<n*n;i++)if(chk.dm[i]){tot++;if((chk.g[i]?1:0)===g[i])match++;}if(!tot||match/tot<VOTE_AGREE)return null;const s=decodeSector(g,n,m,offset);if(s!==null&&s!==v.text)return null;return {text:v.text,agree:match/tot};}
function decodeByRuler(px,IW,IH,ruler){if(IW!==IH)return [];const lum=p=>(px[p]+px[p+1]+px[p+2])/3;const T=ruler.T, cell=IW/T;const results=[];const sampleChan=(n,pad,ci)=>{const g=new Uint8Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const X=Math.min(IW-1,Math.floor((x+pad+.5)*cell));const Y=Math.min(IH-1,Math.floor((y+pad+.5)*cell));const p=(Y*IW+X)*4;const v=ci<0?lum(p):px[p+ci];g[y*n+x]=v>(ci<0?110:RGBTHR)?1:0;}return g;};for(let pad=2;pad<=8;pad++){const n=T-2*pad; if(n<MINN||n%2===0)continue;const cl=sampleChan(n,pad,-1),cr=sampleChan(n,pad,0),cg=sampleChan(n,pad,1),cb=sampleChan(n,pad,2);let sameRGB=true;for(let z=0;z<cr.length;z++){if(cr[z]!==cg[z]||cr[z]!==cb[z]){sameRGB=false;break}}for(const m of ['oct','quad','half']){{const v=decodeVoted(cl,n,m,0);if(v.text!==null){const chk=fillChannel(v.text,n,m,null);let tot=0,match=0;for(let i=0;i<n*n;i++)if(chk.dm[i]){tot++;if((chk.g[i]?1:0)===cl[i])match++;}if(tot&&match/tot>=0.90)results.push({kind:'one',mode:m,n,pad,res:[v.text,null,null]});}}if(!sameRGB){if(markCell(cr,n,m)===1){const vR=decodeVoted(cr,n,m,1),vG=decodeVoted(cg,n,m,0),vB=decodeVoted(cb,n,m,0);if(vR.text!==null)results.push({kind:'mono',mode:m,n,pad,res:[(vR.text||'')+(vG.text||'')+(vB.text||''),null,null]});}const vr=decodeVoted(cr,n,m,0),vg=decodeVoted(cg,n,m,0),vb=decodeVoted(cb,n,m,0);const tr=vr.text,tg=vg.text,tb=vb.text;const cnt=[tr,tg,tb].filter(x=>x!==null).length;if(cnt>=2){const ne=[tr,tg,tb].filter(x=>x!==null);if(!ne.every(x=>x===ne[0]))results.push({kind:'three',mode:m,n,pad,res:[tr,tg,tb]});}}}}if(!results.length){for(let pad=2;pad<=8;pad++){const n=T-2*pad; if(n<MINN||n%2===0)continue;const cl=sampleChan(n,pad,-1);for(const m of ['oct','quad','half']){const rv=recoverVoted(cl,n,m,0,null);if(rv)results.push({kind:'recovered',mode:m,n,pad,res:[rv.text,null,null],agree:rv.agree});}}}const seen=new Set(),uniq=[];for(const r of results){const key=r.kind+'|'+r.res.join('\u0001');if(!seen.has(key)){seen.add(key);uniq.push(r)}}uniq.sort((a,b)=>{const al=a.res.filter(x=>x).join('').length,bl=b.res.filter(x=>x).join('').length;return bl-al||a.n-b.n;});return uniq;}

function findOrnament(px,IW,IH){const lum=p=>(px[p]+px[p+1]+px[p+2])/3;const rowAct=new Array(IH).fill(0),colAct=new Array(IW).fill(0);for(let y=0;y<IH;y++){let prev=-1,tr=0;for(let x=0;x<IW;x+=2){const cc=lum((y*IW+x)*4)>127?1:0;if(cc!==prev){tr++;prev=cc}}rowAct[y]=tr;}for(let x=0;x<IW;x++){let prev=-1,tr=0;for(let y=0;y<IH;y+=2){const cc=lum((y*IW+x)*4)>127?1:0;if(cc!==prev){tr++;prev=cc}}colAct[x]=tr;}const maxRow=Math.max(...rowAct),maxCol=Math.max(...colAct);const rowThr=Math.max(4,maxRow*0.25),colThr=Math.max(4,maxCol*0.25);function longestBlock(act,thr){let bestS=0,bestE=-1,curS=-1,gap=0;const maxGap=Math.max(8,act.length*0.03);for(let i=0;i<act.length;i++){if(act[i]>=thr){if(curS<0)curS=i;gap=0;if(i-curS>bestE-bestS){bestS=curS;bestE=i;}}else{if(curS>=0){gap++;if(gap>maxGap){curS=-1;gap=0;}}}}return [bestS,bestE];}let [y0,y1]=longestBlock(rowAct,rowThr),[x0,x1]=longestBlock(colAct,colThr);if(y1<=y0||x1<=x0)return null;const side=Math.max(x1-x0,y1-y0),cx=(x0+x1)/2,cy=(y0+y1)/2;let nx0=Math.max(0,Math.round(cx-side/2)),ny0=Math.max(0,Math.round(cy-side/2));let nx1=Math.min(IW,nx0+side),ny1=Math.min(IH,ny0+side);const cropW=nx1-nx0,cropH=ny1-ny0;if(cropW<20||cropH<20)return null;return {x0:nx0,y0:ny0,w:cropW,h:cropH};}
function cropPx(px,IW,IH,box){const {x0,y0,w,h}=box;const out=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const src=((y0+y)*IW+(x0+x))*4,dst=(y*w+x)*4;out[dst]=px[src];out[dst+1]=px[src+1];out[dst+2]=px[src+2];out[dst+3]=255;}return out;}

function findCorners(px,IW,IH){const corners4=[[0,0],[IW-1,0],[0,IH-1],[IW-1,IH-1]];const bgSamples=corners4.map(([x,y])=>{const p=(y*IW+x)*4;return [px[p],px[p+1],px[p+2]];});const bg=[0,1,2].map(c=>Math.round(bgSamples.reduce((s,v)=>s+v[c],0)/bgSamples.length));const isPat=(x,y)=>{const p=(y*IW+x)*4;const dr=px[p]-bg[0],dg=px[p+1]-bg[1],db=px[p+2]-bg[2];return Math.sqrt(dr*dr+dg*dg+db*db)>60;};let top=null,bot=null,left=null,right=null;const step=Math.max(1,Math.floor(IW/500));for(let y=0;y<IH;y+=step)for(let x=0;x<IW;x+=step){if(!isPat(x,y))continue;if(!top||y<top[1])top=[x,y];if(!bot||y>bot[1])bot=[x,y];if(!left||x<left[0])left=[x,y];if(!right||x>right[0])right=[x,y];}if(!top||!bot||!left||!right)return null;const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);const s=[d(top,right),d(right,bot),d(bot,left),d(left,top)];const avg=(s[0]+s[1]+s[2]+s[3])/4;if(avg<30)return null;if((Math.max(...s)-Math.min(...s))/avg>0.35)return null;return {TL:top,TR:right,BR:bot,BL:left,side:avg};}

function findCodeBox(px,IW,IH){const GX=120, GY=Math.max(20,Math.round(120*IH/IW));const cw=IW/GX, ch=IH/GY;const avg=new Float64Array(GX*GY*3);for(let gy=0;gy<GY;gy++)for(let gx=0;gx<GX;gx++){let r=0,g=0,b=0,cnt=0;const x0=Math.floor(gx*cw),x1=Math.floor((gx+1)*cw),y0=Math.floor(gy*ch),y1=Math.floor((gy+1)*ch);for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const p=(y*IW+x)*4;r+=px[p];g+=px[p+1];b+=px[p+2];cnt++;}const i=(gy*GX+gx)*3;avg[i]=r/cnt;avg[i+1]=g/cnt;avg[i+2]=b/cnt;}const edge=[];for(let gx=0;gx<GX;gx++){edge.push([gx,0]);edge.push([gx,GY-1]);}for(let gy=0;gy<GY;gy++){edge.push([0,gy]);edge.push([GX-1,gy]);}const compMed=k=>{const a=edge.map(([gx,gy])=>avg[(gy*GX+gx)*3+k]).sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};const bg=[compMed(0),compMed(1),compMed(2)];const fg=new Uint8Array(GX*GY);for(let i=0;i<GX*GY;i++){const dr=avg[i*3]-bg[0],dg=avg[i*3+1]-bg[1],db=avg[i*3+2]-bg[2];if(Math.sqrt(dr*dr+dg*dg+db*db)>55)fg[i]=1;}const lab=new Int32Array(GX*GY);let cur=0,best=0,bestBox=null;const stack=[];for(let s=0;s<GX*GY;s++){if(!fg[s]||lab[s])continue;cur++;let cnt=0,minx=GX,miny=GY,maxx=0,maxy=0;stack.push(s);lab[s]=cur;while(stack.length){const p=stack.pop();const gx=p%GX,gy=(p/GX)|0;cnt++;if(gx<minx)minx=gx;if(gx>maxx)maxx=gx;if(gy<miny)miny=gy;if(gy>maxy)maxy=gy;const gxs=[gx-1,gx+1,gx,gx],gys=[gy,gy,gy-1,gy+1];for(let k=0;k<4;k++){const nx=gxs[k],ny=gys[k];if(nx<0||ny<0||nx>=GX||ny>=GY)continue;const q=ny*GX+nx;if(fg[q]&&!lab[q]){lab[q]=cur;stack.push(q);}}}if(cnt>best){best=cnt;bestBox=[minx,miny,maxx,maxy];}}if(!bestBox)return null;let x0=Math.floor(bestBox[0]*cw),y0=Math.floor(bestBox[1]*ch),x1=Math.ceil((bestBox[2]+1)*cw),y1=Math.ceil((bestBox[3]+1)*ch);const padX=cw*0.5,padY=ch*0.5;x0=Math.max(0,Math.floor(x0-padX));y0=Math.max(0,Math.floor(y0-padY));x1=Math.min(IW,Math.ceil(x1+padX));y1=Math.min(IH,Math.ceil(y1+padY));return {x0,y0,w:x1-x0,h:y1-y0};}

function bradley(px,IW,IH,winFrac,tPct){const lum=i=>(px[i*4]+px[i*4+1]+px[i*4+2])/3;const integ=new Float64Array(IW*IH);for(let y=0;y<IH;y++){let s=0;for(let x=0;x<IW;x++){s+=lum(y*IW+x);integ[y*IW+x]=(y>0?integ[(y-1)*IW+x]:0)+s;}}const S=Math.max(2,Math.floor(IW*winFrac)),t=tPct;const out=new Uint8ClampedArray(IW*IH*4);for(let y=0;y<IH;y++)for(let x=0;x<IW;x++){const x1=Math.max(x-S,0),x2=Math.min(x+S,IW-1),y1=Math.max(y-S,0),y2=Math.min(y+S,IH-1);const count=(x2-x1)*(y2-y1);const sum=integ[y2*IW+x2]-integ[y1*IW+x2]-integ[y2*IW+x1]+integ[y1*IW+x1];const v=lum(y*IW+x);const res=(v*count<=sum*(100-t)/100)?0:255;const d=(y*IW+x)*4;out[d]=out[d+1]=out[d+2]=res;out[d+3]=255;}return out;}
function pbox_runs(get,len){let p=-1,r=[],s=0;for(let i=0;i<len;i++){const c=get(i)>127?1:0;if(c!==p){if(p>=0)r.push([s,i-1]);s=i;p=c;}}r.push([s,len-1]);return r;}
function pbox_med(a){const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)];}
function pbox_reg(rs){if(rs.length<7)return 0;const L=rs.map(s=>s[1]-s[0]+1);const m=pbox_med(L);if(m<3)return 0;let g=0;for(const l of L)if(l>=m*.55&&l<=m*1.45)g++;return g/rs.length;}
function pbox_rulerBox(px,W,H){const lum=(x,y)=>px[(y*W+x)*4];const T=()=>{for(let y=Math.floor(H*.004);y<Math.floor(H*.25);y++)if(pbox_reg(pbox_runs(k=>lum(k,y),W))>=.75)return y;return -1;};const B=()=>{for(let y=H-1-Math.floor(H*.004);y>Math.floor(H*.75);y--)if(pbox_reg(pbox_runs(k=>lum(k,y),W))>=.75)return y;return -1;};const L=()=>{for(let x=Math.floor(W*.004);x<Math.floor(W*.25);x++)if(pbox_reg(pbox_runs(k=>lum(x,k),H))>=.75)return x;return -1;};const R=()=>{for(let x=W-1-Math.floor(W*.004);x>Math.floor(W*.75);x--)if(pbox_reg(pbox_runs(k=>lum(x,k),H))>=.75)return x;return -1;};const t=T(),b=B(),l=L(),r=R();if([t,b,l,r].some(v=>v<0))return null;return {x0:l,y0:t,w:r-l+1,h:b-t+1};}
function pbox_toSquare(px,W,H){const N=Math.max(W,H);const o=new Uint8ClampedArray(N*N*4);for(let y=0;y<N;y++)for(let x=0;x<N;x++){const sx=Math.min(W-1,Math.floor(x*W/N)),sy=Math.min(H-1,Math.floor(y*H/N));const s=(sy*W+sx)*4,d=(y*N+x)*4;o[d]=px[s];o[d+1]=px[s+1];o[d+2]=px[s+2];o[d+3]=255;}return {px:o,N};}
function scanPhoto(px,IW,IH){const box=findOrnament(px,IW,IH);if(!box)return [];const cpx=cropPx(px,IW,IH,box);let out=[];for(const wt of [[1/12,12],[1/16,10],[1/8,15]]){const b=bradley(cpx,box.w,box.h,wt[0],wt[1]);const rb=pbox_rulerBox(b,box.w,box.h);if(!rb)continue;if(rb.w/rb.h<0.85||rb.w/rb.h>1.18)continue;const bc=cropPx(b,box.w,box.h,rb);const sq=pbox_toSquare(bc,rb.w,rb.h);const ru=findRuler(sq.px,sq.N,sq.N);if(!ru)continue;const rr=decodeByRuler(sq.px,sq.N,sq.N,ru);if(rr.length)out=out.concat(rr);}return out;}

function gradCorners(px,IW,IH,G){const lum=p=>(px[p*4]+px[p*4+1]+px[p*4+2])/3;const cw=IW/G,ch=IH/G;const gr=new Float64Array(G*G);for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){let s=0,c=0;const x0=Math.floor(gx*cw),x1=Math.floor((gx+1)*cw),y0=Math.floor(gy*ch),y1=Math.floor((gy+1)*ch);for(let y=y0+1;y<y1-1;y+=2)for(let x=x0+1;x<x1-1;x+=2){const gxv=Math.abs(lum(y*IW+x+1)-lum(y*IW+x-1)),gyv=Math.abs(lum((y+1)*IW+x)-lum((y-1)*IW+x));s+=gxv+gyv;c++;}gr[gy*G+gx]=c?s/c:0;}const mx=Math.max(...gr),thr=mx*0.18;const fg=gr.map(v=>v>=thr?1:0);const dil=new Uint8Array(G*G);for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){let any=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=gx+dx,ny=gy+dy;if(nx>=0&&ny>=0&&nx<G&&ny<G&&fg[ny*G+nx])any=1;}dil[gy*G+gx]=any;}const lab=new Int32Array(G*G);let cur=0,best=0,bestPts=null;const st=[];for(let s=0;s<G*G;s++){if(!dil[s]||lab[s])continue;cur++;const pts=[];st.push(s);lab[s]=cur;while(st.length){const p=st.pop();pts.push(p);const gx=p%G,gy=(p/G)|0;for(const [nx,ny] of [[gx-1,gy],[gx+1,gy],[gx,gy-1],[gx,gy+1]]){if(nx<0||ny<0||nx>=G||ny>=G)continue;const q=ny*G+nx;if(dil[q]&&!lab[q]){lab[q]=cur;st.push(q);}}}if(pts.length>best){best=pts.length;bestPts=pts;}}if(!bestPts||best<8)return null;let TL,TR,BR,BL;for(const p of bestPts){const gx=p%G,gy=(p/G)|0;const X=(gx+0.5)*cw,Y=(gy+0.5)*ch;const s=X+Y,d=X-Y;if(!TL||s<TL.s)TL={X,Y,s};if(!BR||s>BR.s)BR={X,Y,s};if(!TR||d>TR.d)TR={X,Y,d};if(!BL||d<BL.d)BL={X,Y,d};}const dd=(a,b)=>Math.hypot(a.X-b.X,a.Y-b.Y);const side=(dd(TL,TR)+dd(TR,BR)+dd(BR,BL)+dd(BL,TL))/4;return {TL:[TL.X,TL.Y],TR:[TR.X,TR.Y],BR:[BR.X,BR.Y],BL:[BL.X,BL.Y],side};}
function med(a){const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)];}
function runsLine(get,len){let prev=-1,l=0,R=[];for(let i=0;i<len;i++){const c=get(i)>127?1:0;if(c===prev)l++;else{if(prev>=0)R.push(l);prev=c;l=1;}}R.push(l);return R;}
function decodeNewFrame(px,IW,IH,dbg){if(IW!==IH)return [];const lumf=(x,y)=>{const p=(y*IW+x)*4;return (px[p]+px[p+1]+px[p+2])/3;};const edgeModule=(get,span,depth)=>{const cand=[];for(let i=Math.floor(depth*0.02);i<depth;i++){const rs=runsLine(k=>get(k,i),span).filter(v=>v>=2);if(rs.length<8)continue;const m=med(rs);let reg=0;for(const r of rs)if(r>=m*0.55&&r<=m*1.45)reg++;if(reg/rs.length>=0.8)cand.push(m);}return cand.length?med(cand):null;};const dep=Math.floor(IW*0.18);const mods=[edgeModule((k,i)=>lumf(k,i),IW,dep),edgeModule((k,i)=>lumf(k,IH-1-i),IW,dep),edgeModule((k,i)=>lumf(i,k),IH,dep),edgeModule((k,i)=>lumf(IW-1-i,k),IH,dep)].filter(Boolean);let module;if(mods.length>=2)module=med(mods);else{const ru=findRuler(px,IW,IH);if(!ru)return [];module=ru.cell;}const Tf=Math.round(IW/module);const n=Tf-6;if(n<MINN||n%2===0)return [];const lum=p=>(px[p]+px[p+1]+px[p+2])/3;const RGBTHR=125;const agree=(g,chk)=>{let ok=0;for(let z=0;z<n*n;z++)if((chk[z]?1:0)===g[z])ok++;return ok/(n*n);};const out=[];const SOFT=0.93;const sampleAt=(ci,cell,ox,oy)=>{const g=new Uint8Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const X=Math.min(IW-1,Math.max(0,Math.round((x+3+0.5)*cell+ox))),Y=Math.min(IH-1,Math.max(0,Math.round((y+3+0.5)*cell+oy)));const p=(Y*IW+X)*4;const v=ci<0?lum(p):px[p+ci];g[y*n+x]=v>(ci<0?110:RGBTHR)?1:0;}return g;};let bestPh={sc:0,cell:IW/Tf,ox:0,oy:0};for(const sf of [1.0,0.994,0.997,1.003,1.006,0.991,1.009]){const cellS=(IW/Tf)*sf;for(let ox=-cellS*0.35;ox<=cellS*0.35;ox+=cellS*0.12)for(let oy=-cellS*0.35;oy<=cellS*0.35;oy+=cellS*0.12){const gl=sampleAt(-1,cellS,ox,oy);let bs=0;for(const m of ['oct','quad','half']){const t=decodeSector(gl,n,m,0);if(t!==null){const chk=fillChannel(t,n,m,null);const a=agree(gl,chk.g);if(a>bs)bs=a;}}if(bs>bestPh.sc)bestPh={sc:bs,cell:cellS,ox,oy};}}const cell=bestPh.cell, PX=bestPh.ox, PY=bestPh.oy;const sample=(ci)=>sampleAt(ci,cell,PX,PY);const cl=sample(-1);const _S=RGB_SOFT;const _mix=(r,g,b)=>[Math.min(255,(r?_S.r[0]:0)+(g?_S.g[0]:0)+(b?_S.b[0]:0)),Math.min(255,(r?_S.r[1]:0)+(g?_S.g[1]:0)+(b?_S.b[1]:0)),Math.min(255,(r?_S.r[2]:0)+(g?_S.g[2]:0)+(b?_S.b[2]:0))];const _refs=[[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]].map(c=>({b:c,col:_mix(c[0],c[1],c[2])}));const _raw=(cx,cy)=>{var ox=0.5,oy=0.5;if(cx===0)ox=0.7;if(cx===n-1)ox=0.3;if(cy===0)oy=0.7;if(cy===n-1)oy=0.3;const X=Math.min(IW-1,Math.max(0,Math.round((cx+3+ox)*cell+PX)));const Y=Math.min(IH-1,Math.max(0,Math.round((cy+3+oy)*cell+PY)));const p=(Y*IW+X)*4;return [px[p],px[p+1],px[p+2]];};const cr=new Uint8Array(n*n),cg=new Uint8Array(n*n),cb=new Uint8Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const c=_raw(x,y);let bi=0,bd=1e9;for(let i=0;i<_refs.length;i++){const r=_refs[i].col;const dr=c[0]-r[0],dg=c[1]-r[1],db=c[2]-r[2],dd=dr*dr+dg*dg+db*db;if(dd<bd){bd=dd;bi=i;}}const t=_refs[bi].b;cr[y*n+x]=t[0];cg[y*n+x]=t[1];cb[y*n+x]=t[2];}let sameRGB=true;for(let z=0;z<cl.length;z++)if(cr[z]!==cg[z]||cr[z]!==cb[z]){sameRGB=false;break;}for(const m of ['oct','quad','half']){{const t=decodeSector(cl,n,m,0);if(t!==null){const chk=fillChannel(t,n,m,null);if(agree(cl,chk.g)===1)out.push({kind:'one',mode:m,n,res:[t,null,null]});}}if(!out.some(r=>r.kind==='one'||r.kind==='mono'||r.kind==='three')){const rv=recoverVoted(cl,n,m,0,null);if(rv)out.push({kind:'recovered',mode:m,n,res:[rv.text,null,null],agree:rv.agree});}if(!sameRGB){if(markCell(cr,n,m)===1){const rR=decodeSector(cr,n,m,1),rG=decodeSector(cg,n,m,0),rB=decodeSector(cb,n,m,0);if(rR!==null){const kR=fillChannel(rR,n,m,1),kG=fillChannel(rG||'',n,m,null),kB=fillChannel(rB||'',n,m,null);if(agree(cr,kR.g)>=SOFT&&agree(cg,kG.g)>=SOFT&&agree(cb,kB.g)>=SOFT)out.push({kind:'mono',mode:m,n,res:[(rR||'')+(rG||'')+(rB||''),null,null]});}}const tr=decodeSector(cr,n,m,0),tg=decodeSector(cg,n,m,0),tb=decodeSector(cb,n,m,0);if([tr,tg,tb].filter(x=>x!==null).length>=2){const ne=[tr,tg,tb].filter(x=>x);const kR=fillChannel(tr||'',n,m,null),kG=fillChannel(tg||'',n,m,null),kB=fillChannel(tb||'',n,m,null);if(!ne.every(x=>x===ne[0])&&agree(cr,kR.g)>=SOFT&&agree(cg,kG.g)>=SOFT&&agree(cb,kB.g)>=SOFT)out.push({kind:'three',mode:m,n,res:[tr,tg,tb]});}}}out.sort((a,b)=>b.res.filter(x=>x).join('').length-a.res.filter(x=>x).join('').length);return out;}

function buildBuffer(img, runDecodeAttempts){
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  if (iw < 1 || ih < 1) throw new Error('Invalid image dimensions');
  const maxDim = isCamera ? 1000 : 1500; 
  const AS = Math.max(512, Math.min(maxDim, Math.max(iw, ih)));
  const cc=document.createElement('canvas');cc.width=AS;cc.height=AS;
  const g=cc.getContext('2d',{willReadFrequently:true});
  const tmp=document.createElement('canvas');tmp.width=iw;tmp.height=ih;
  const tg=tmp.getContext('2d',{willReadFrequently:true});tg.drawImage(img,0,0,iw,ih);
  const cp=tg.getImageData(0,0,1,1).data;
  g.fillStyle='rgb('+cp[0]+','+cp[1]+','+cp[2]+')';g.fillRect(0,0,AS,AS);
  const scale=Math.min(AS/iw,AS/ih),w=iw*scale,h=ih*scale;
  g.imageSmoothingEnabled=true;g.drawImage(img,(AS-w)/2,(AS-h)/2,w,h);
  return {px:g.getImageData(0,0,AS,AS).data,IW:AS,IH:AS};
}

function v13_solveLS8(A,b){const n=8,M=A.map((row,i)=>[...row,b[i]]);for(let col=0;col<n;col++){let maxRow=col;for(let r=col+1;r<n;r++)if(Math.abs(M[r][col])>Math.abs(M[maxRow][col]))maxRow=r;[M[col],M[maxRow]]=[M[maxRow],M[col]];for(let r=0;r<n;r++)if(r!==col){const f=M[r][col]/M[col][col];for(let c=col;c<=n;c++)M[r][c]-=f*M[col][c];}}return M.map((row,i)=>row[n]/row[i]);}
function v13_computeH(cor,N){const pts=[cor.TL,cor.TR,cor.BR,cor.BL],dst=[[0,0],[N,0],[N,N],[0,N]],A=[],b=[];for(let i=0;i<4;i++){const[x,y]=pts[i],[u,v]=dst[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}const h=v13_solveLS8(A,b);return [[h[0],h[1],h[2]],[h[3],h[4],h[5]],[h[6],h[7],1]];}
function v13_invertH(H){const[a,b,c]=[H[0][0],H[0][1],H[0][2]],[d,e,f]=[H[1][0],H[1][1],H[1][2]],[g,h,k]=[H[2][0],H[2][1],H[2][2]];const det=a*(e*k-f*h)-b*(d*k-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-12)return null;return[[(e*k-f*h)/det,(c*h-b*k)/det,(b*f-c*e)/det],[(f*g-d*k)/det,(a*k-c*g)/det,(c*d-a*f)/det],[(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]];}
function deskew(px,IW,IH,corners,N){const Hm=v13_computeH(corners,N),Hi=v13_invertH(Hm);if(!Hi)return new Uint8ClampedArray(N*N*4);const out=new Uint8ClampedArray(N*N*4);for(let dy=0;dy<N;dy++)for(let dx=0;dx<N;dx++){let[sx,sy,sw]=[Hi[0][0]*(dx+.5)+Hi[0][1]*(dy+.5)+Hi[0][2],Hi[1][0]*(dx+.5)+Hi[1][1]*(dy+.5)+Hi[1][2],Hi[2][0]*(dx+.5)+Hi[2][1]*(dy+.5)+Hi[2][2]];sx/=sw;sy/=sw;const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(IW-1,x0+1),y1=Math.min(IH-1,y0+1);const fx=sx-x0,fy=sy-y0,o=(dy*N+dx)*4;if(x0<0||y0<0||x0>=IW||y0>=IH){out[o+3]=255;continue;}const p00=(y0*IW+x0)*4,p10=(y0*IW+x1)*4,p01=(y1*IW+x0)*4,p11=(y1*IW+x1)*4;for(let c=0;c<3;c++)out[o+c]=px[p00+c]*(1-fx)*(1-fy)+px[p10+c]*fx*(1-fy)+px[p01+c]*(1-fx)*fy+px[p11+c]*fx*fy;out[o+3]=255;}return out;}
function subpixCorners(px,IW,IH){const lum=(x,y)=>{const p=(y*IW+x)*4;return(px[p]+px[p+1]+px[p+2])/3;};const thr=150;let minx=IW,maxx=0,miny=IH,maxy=0,any=false;for(let y=0;y<IH;y+=2)for(let x=0;x<IW;x+=2)if(lum(x,y)<thr){any=true;if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}if(!any)return null;let bg=0,bc=0;for(let y=0;y<15;y++)for(let x=0;x<15;x++){bg+=lum(x,y);bc++;}bg/=bc;if(bg<128)bg=245;const half=bg*0.5;const cross=(get,len)=>{for(let i=0;i<len;i++){const v=get(i);if(v<half){if(i===0)return 0;const v0=get(i-1);return i-1+(v0-half)/(v0-v+1e-9);}}return null;};const top=[],bot=[],lft=[],rgt=[];const x0=Math.floor(minx+0.25*(maxx-minx)),x1=Math.floor(maxx-0.25*(maxx-minx));const y0=Math.floor(miny+0.25*(maxy-miny)),y1=Math.floor(maxy-0.25*(maxy-miny));for(let x=x0;x<x1;x+=3){let c=cross(i=>lum(x,i),IH);if(c!==null)top.push([x,c]);c=cross(i=>lum(x,IH-1-i),IH);if(c!==null)bot.push([x,IH-1-c]);}for(let y=y0;y<y1;y+=3){let c=cross(i=>lum(i,y),IW);if(c!==null)lft.push([c,y]);c=cross(i=>lum(IW-1-i,y),IW);if(c!==null)rgt.push([IW-1-c,y]);}if(top.length<4||bot.length<4||lft.length<4||rgt.length<4)return null;const fitH=p=>{let sx=0,sy=0,sxx=0,sxy=0,n=p.length;for(const[x,y]of p){sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;}const m=(n*sxy-sx*sy)/(n*sxx-sx*sx);return[m,(sy-m*sx)/n];};const fitV=p=>{let sx=0,sy=0,syy=0,sxy=0,n=p.length;for(const[x,y]of p){sx+=x;sy+=y;syy+=y*y;sxy+=x*y;}const m=(n*sxy-sy*sx)/(n*syy-sy*sy);return[m,(sx-m*sy)/n];};const[mt,bt]=fitH(top),[mb,bb]=fitH(bot),[ml,bl]=fitV(lft),[mr,br]=fitV(rgt);const I=(mh,bh,mv,bv)=>{const x=(mv*bh+bv)/(1-mv*mh);return[x,mh*x+bh];};return{TL:I(mt,bt,ml,bl),TR:I(mt,bt,mr,br),BR:I(mb,bb,mr,br),BL:I(mb,bb,ml,bl)};}
function v13_analyzeFlat(px,N){const lumOf=c=>(c[0]+c[1]+c[2])/3;const lum=(x,y)=>{const p=(y*N+x)*4;return(px[p]+px[p+1]+px[p+2])/3;};let best=null;const TfLo=Math.max(9,Math.floor(N/60)),TfHi=Math.floor(N/12);for(let Tf=TfLo;Tf<=TfHi;Tf++){const module=N/Tf;for(const pad of [3,2,4]){const n=Tf-2*pad;if(n<(MINN||7)||n%2===0)continue;for(const[dpx,dpy] of [[0,0],[0.22*module,0],[-0.22*module,0],[0,0.22*module],[0,-0.22*module]]){const ox=pad*module+dpx,oy=pad*module+dpy;if(ox+n*module>N+2||oy+n*module>N+2||ox<-2||oy<-2)continue;const cells=[],gl=new Uint8Array(n*n),cm=new Float32Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const X=Math.min(N-1,Math.max(0,Math.round(ox+(x+0.5)*module)));const Y=Math.min(N-1,Math.max(0,Math.round(oy+(y+0.5)*module)));const p=(Y*N+X)*4,R=px[p],G=px[p+1],B=px[p+2],L=(R+G+B)/3;cells.push([R,G,B]);gl[y*n+x]=L>110?1:0;cm[y*n+x]=Math.min(1,Math.abs(L-128)/90);}const colored=cells.filter(c=>Math.max(...c)-Math.min(...c)>60).length>=Math.max(3,n*0.15);if(colored){const REFBITS=[[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,0,1],[0,1,1],[1,1,1]];const refsFor=S=>{const mix=(r,g,b)=>[Math.min(255,(r?S.r[0]:0)+(g?S.g[0]:0)+(b?S.b[0]:0)),Math.min(255,(r?S.r[1]:0)+(g?S.g[1]:0)+(b?S.b[1]:0)),Math.min(255,(r?S.r[2]:0)+(g?S.g[2]:0)+(b?S.b[2]:0))];return REFBITS.map(c=>({bits:c,col:mix(c[0],c[1],c[2])}));};const ND_PAL2={r:[220,50,60],g:[65,195,65],b:[60,70,215]};let cls=null;for(const S of [RGB_SOFT,ND_PAL2]){const refs=refsFor(S);let err=0;const cr=new Uint8Array(n*n),cg=new Uint8Array(n*n),cb=new Uint8Array(n*n);for(let i=0;i<n*n;i++){const[R,G,B]=cells[i];let bi=0,bd=1e9;for(let k=0;k<refs.length;k++){const q=refs[k].col,dr=R-q[0],dg=G-q[1],db=B-q[2],d=dr*dr+dg*dg+db*db;if(d<bd){bd=d;bi=k;}}err+=bd;const t=refs[bi].bits;cr[i]=t[0];cg[i]=t[1];cb[i]=t[2];}if(!cls||err<cls.err)cls={err,cr,cg,cb};}const cR=new Float32Array(n*n),cG=new Float32Array(n*n),cB=new Float32Array(n*n);cells.forEach((_,i)=>{cR[i]=Math.min(1,Math.abs(cells[i][0]-128)/90);cG[i]=Math.min(1,Math.abs(cells[i][1]-128)/90);cB[i]=Math.min(1,Math.abs(cells[i][2]-128)/90);});const rMark=markCell(cls.cr,n,'oct');let vr=decodeVoted(cls.cr,n,'oct',rMark?1:0,cR);if(rMark&&vr.text===null)vr=decodeVoted(cls.cr,n,'oct',0,cR);const vg=decodeVoted(cls.cg,n,'oct',0,cG),vb=decodeVoted(cls.cb,n,'oct',0,cB);const nn=[vr.text,vg.text,vb.text].filter(t=>t!==null);if(nn.length<2)continue;const allSame=nn.every(t=>t===nn[0]);const txt=rMark?(allSame?nn[0]:nn.join('')):[vr.text,vg.text,vb.text].filter(t=>t).join('');const sc=nn.length*1000+txt.length;if(!best||sc>best.sc)best={sc,kind:allSame&&rMark?'mono':'three',mode:'oct',n,res:rMark&&allSame?[txt,null,null]:[vr.text,vg.text,vb.text]};}else{for(const m of ['oct','quad','half']){const v=decodeVoted(gl,n,m,0,cm);if(v.text){const sc=500+v.text.length;if(!best||sc>best.sc)best={sc,kind:'one',mode:m,n,res:[v.text,null,null]};}}}}}}return best;}

function dedup(all) {
  if (!all.length) return [];
  const seen = new Set(), u = [];
  for (const r of all) {
    const k = (r.kind || '') + '|' + r.res.join('\u0001');
    if (!seen.has(k)) { seen.add(k); u.push(r); }
  }
  u.sort((a, b) => b.res.filter(x => x).join('').length - a.res.filter(x => x).join('').length);
  return u;
}

function runDecodeAttempts(img, isCamera = false) {
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  if (iw < 1 || ih < 1) return [];

  const maxDim = isCamera ? 1000 : 1500;
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const W = Math.round(iw * scale);
  const H = Math.round(ih * scale);

  const cc = document.createElement('canvas');
  cc.width = W; cc.height = H;
  const g = cc.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, iw, ih, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;

  let all = [];
  const collect = (p, dw, dh) => {
    try { const ru = findRuler(p, dw, dh); if (ru) { const rr = decodeByRuler(p, dw, dh, ru); if (rr.length) all = all.concat(rr); } } catch (e) {}
    try { const f = scanImage(p, dw, dh); if (f.length) all = all.concat(f); } catch (e) {}
  };
  const hasSolid = () => all.some(r => r.kind === 'one' || r.kind === 'three' || r.kind === 'mono');
  const done = () => dedup(all);

  collect(px, W, H);
  if (hasSolid()) return done();

  try {
    const box = findOrnament(px, W, H) || findCodeBox(px, W, H);
    if (box) {
      const c = cropPx(px, W, H, { x0: box.x0 || box[0], y0: box.y0 || box[1], w: box.w || (box[2]-box[0]), h: box.h || (box[3]-box[1]) });
      collect(c, c.w || box.w, c.h || box.h);
      if (hasSolid()) return done();
    }
  } catch (e) {}

  try {
    const pf = scanPhoto(px, W, H);
    if (pf.length) all = all.concat(pf);
    if (hasSolid()) return done();
  } catch (e) {}

  if (!isCamera) {
    try {
      const cor = subpixCorners(px, W, H) || findCorners(px, W, H);
      if (cor) {
        const N = Math.round(Math.min(1500, Math.max(400, cor.side || Math.hypot(cor.TL[0]-cor.TR[0], cor.TL[1]-cor.TR[1]))));
        const d = deskew(px, W, H, cor, N);
        const b = v13_analyzeFlat(d, N);
        if (b) return [b];
        collect(d, N, N);
      }
    } catch (e) {}
  }

  return done();
}

  // Десктопний шлях: Строга математика, ідеальні PNG
  const { px, IW, IH } = buildBuffer(img, false);
  let all = [];
  const collect = (p, W, H) => {
    try { const ru = findRuler(p, W, H); if (ru) { const rr = decodeByRuler(p, W, H, ru); if (rr.length) all = all.concat(rr); } } catch (e) {}
    try { const f = scanImage(p, W, H); if (f.length) all = all.concat(f); } catch (e) {}
  };
  const hasSolid = () => all.some(r => r.kind === 'one' || r.kind === 'three' || r.kind === 'mono');
  const done = () => dedup(all);

  collect(px, IW, IH);
  if (hasSolid()) return done();

  try {
    const cor = subpixCorners(px, IW, IH);
    if (cor) {
      const el = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const N = Math.round(Math.min(1500, Math.max(400, Math.max(el(cor.TL, cor.TR), el(cor.TR, cor.BR), el(cor.BR, cor.BL), el(cor.BL, cor.TL)))));
      const d = deskew(px, IW, IH, cor, N);
      const b = v13_analyzeFlat(d, N);
      if (b) return [b];
    }
  } catch(e) {}

  try {
    const box = findCodeBox(px, IW, IH);
    if (box) {
      const side = Math.max(box.w, box.h), cx = box.x0 + box.w / 2, cy = box.y0 + box.h / 2;
      for (const sf of [1.0, 1.05, 0.96]) {
        let s = Math.round(side * sf);
        let nx = Math.round(cx - s / 2), ny = Math.round(cy - s / 2);
        nx = Math.max(0, nx); ny = Math.max(0, ny);
        s = Math.min(s, IW - nx, IH - ny);
        if (s < 40) continue;
        const c = cropPx(px, IW, IH, {x0: nx, y0: ny, w: s, h: s});
        collect(c, s, s);
        if (hasSolid()) return done();
      }
    }
  } catch(e) {}

  try { const box = findOrnament(px, IW, IH); if (box) { collect(cropPx(px, IW, IH, box), box.w, box.h); } } catch(e) {}
  if (hasSolid()) return done();

  try { const cor = findCorners(px, IW, IH); if (cor) { const N = Math.max(512, Math.min(1400, Math.round(cor.side))); collect(deskew(px, IW, IH, cor, N), N, N); } } catch(e) {}
  if (hasSolid()) return done();

  try { const pf = scanPhoto(px, IW, IH); if (pf.length) all = all.concat(pf); } catch(e) {}
  return done();
}
