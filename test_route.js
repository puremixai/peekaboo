const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless:true, args:['--no-sandbox','--disable-gpu','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport:{width:900,height:700} });
  await p.goto(FILE, { waitUntil:'load', timeout:60000 });
  await p.waitForTimeout(7000);

  const out = await p.evaluate(async () => {
    const L = [];
    const S = [116.360827, 40.079540];
    const E = [116.399771, 40.158950];

    function countNear(cx, cy, R){
      const dLat=R/111320, dLng=R/(111320*Math.cos(cy*D2R));
      const i0=Math.floor((cx-dLng)/CELL), i1=Math.floor((cx+dLng)/CELL);
      const j0=Math.floor((cy-dLat)/CELL), j1=Math.floor((cy+dLat)/CELL);
      let n=0;
      for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++){
        const arr=grid.get(i+'_'+j); if(!arr) continue;
        for(let k=0;k<arr.length;k++) if(distM(CAMERAS[arr[k]],[cx,cy])<=R) n++;
      }
      return n;
    }
    function countNearType(cx, cy, R, type){
      const dLat=R/111320, dLng=R/(111320*Math.cos(cy*D2R));
      const i0=Math.floor((cx-dLng)/CELL), i1=Math.floor((cx+dLng)/CELL);
      const j0=Math.floor((cy-dLat)/CELL), j1=Math.floor((cy+dLat)/CELL);
      let n=0;
      for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++){
        const arr=grid.get(i+'_'+j); if(!arr) continue;
        for(let k=0;k<arr.length;k++){ const c=CAMERAS[arr[k]];
          if(c[2]===type && distM(c,[cx,cy])<=R) n++; }
      }
      return n;
    }
    async function route(s,e,wp,strat){
      const o={origin:s[0].toFixed(6)+','+s[1].toFixed(6), destination:e[0].toFixed(6)+','+e[1].toFixed(6),
               strategy:strat, show_fields:'cost,polyline', key:AMAP_KEY};
      if(wp&&wp.length) o.waypoints=wp.map(w=>w[0].toFixed(6)+','+w[1].toFixed(6)).join(';');
      const r=await fetch('https://restapi.amap.com/v5/direction/driving?'+qs(o)).then(x=>x.json());
      if(r.status!=='1') return {err:r.info};
      const path=r.route.paths[0];
      const poly=routePolyline(path);
      const near=findNear(poly,300,new Set());
      let t2=0; near.forEach(i=>{ if(CAMERAS[i][2]==='2') t2++; });
      return {dist:+path.distance, near:near.length, type2:t2, poly};
    }
    async function corridor(s,e,R,W,N,pad){
      const x0=Math.min(s[0],e[0]), x1=Math.max(s[0],e[0]);
      const y0=Math.min(s[1],e[1]), y1=Math.max(s[1],e[1]);
      const px=(x1-x0)*pad+0.004, py=(y1-y0)*pad+0.004;
      const bx0=x0-px,bx1=x1+px,by0=y0-py,by1=y1+py;
      const cw=(bx1-bx0)/N, ch=(by1-by0)/N;
      const risk=new Float32Array(N*N);
      for(let j=0;j<N;j++) for(let i=0;i<N;i++) risk[j*N+i]=countNear(bx0+(i+0.5)*cw, by0+(j+0.5)*ch, R);
      const tc=(pt)=>[Math.max(0,Math.min(N-1,Math.floor((pt[0]-bx0)/cw))), Math.max(0,Math.min(N-1,Math.floor((pt[1]-by0)/ch)))];
      const [sx,sy]=tc(s),[gx,gy]=tc(e), idx=(i,j)=>j*N+i;
      const g=new Float32Array(N*N).fill(Infinity), prev=new Int32Array(N*N).fill(-1);
      const open=[[0,sx,sy]]; g[idx(sx,sy)]=0;
      let found=false,guard=0;
      while(open.length && guard++<300000){
        open.sort((a,b)=>a[0]-b[0]);
        const [,i,j]=open.shift();
        if(i===gx&&j===gy){ found=true; break; }
        for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++){
          if(!di&&!dj) continue;
          const ni=i+di,nj=j+dj; if(ni<0||nj<0||ni>=N||nj>=N) continue;
          const step=Math.hypot(di,dj);
          const t=g[idx(i,j)]+step*(1+W*risk[idx(ni,nj)]);
          if(t<g[idx(ni,nj)]){ g[idx(ni,nj)]=t; prev[idx(ni,nj)]=idx(i,j);
            open.push([t+Math.hypot(ni-gx,nj-gy), ni,nj]); }
        }
      }
      if(!found) return {err:'A* 失败'};
      let cur=idx(gx,gy), path=[];
      while(cur!==-1){ path.push([cur%N, Math.floor(cur/N)]); cur=prev[cur]; }
      path.reverse();
      const wp=[], step=Math.max(1, Math.floor((path.length-2)/12));
      for(let k=step;k<path.length-1;k+=step) wp.push([bx0+(path[k][0]+0.5)*cw, by0+(path[k][1]+0.5)*ch]);
      return {wp:wp.slice(0,12)};
    }

    L.push('路线: 116.360827,40.079540 → 116.399771,40.158950');
    const base=await route(S,E,null,'32');
    if(base.err){ L.push('基准算路失败: '+base.err); return L; }
    L.push('基准(不避让): '+(base.dist/1000).toFixed(2)+'km, 300m内 '+base.near+' 个 (其中类型2红色 '+base.type2+' 个)');

    for(const pad of [0.05,0.08,0.12,0.18]){
      const c=await corridor(S,E,300,0.25,70,pad);
      if(c.err){ L.push('pad='+pad+' 走廊失败: '+c.err); continue; }
      const rr=await route(S,E,c.wp,'32');
      if(rr.err){ L.push('pad='+pad+' 算路失败: '+rr.err); continue; }
      L.push('走廊 pad='+pad+': '+(rr.dist/1000).toFixed(2)+'km ('+(rr.dist/base.dist).toFixed(2)+'x), 300m内 '+rr.near+' 个 (类型2 '+rr.type2+')');
    }
    return L;
  });

  console.log(out.join('\n'));
  await b.close();
})();
