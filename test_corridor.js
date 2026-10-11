const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless:true, args:['--no-sandbox','--disable-gpu','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport:{width:900,height:700} });
  await p.goto(FILE, { waitUntil:'load', timeout:60000 });
  await p.waitForTimeout(7000);

  const out = await p.evaluate(async () => {
    const lines = [];

    function countNear(cx, cy, R){
      const dLat=R/111320, dLng=R/(111320*Math.cos(cy*D2R));
      const i0=Math.floor((cx-dLng)/CELL), i1=Math.floor((cx+dLng)/CELL);
      const j0=Math.floor((cy-dLat)/CELL), j1=Math.floor((cy+dLat)/CELL);
      let n=0;
      for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++){
        const arr=grid.get(i+'_'+j); if(!arr) continue;
        for(let k=0;k<arr.length;k++){ if(distM(CAMERAS[arr[k]],[cx,cy])<=R) n++; }
      }
      return n;
    }

    async function corridor(s, e, R, W, N){
      const x0=Math.min(s[0],e[0]), x1=Math.max(s[0],e[0]);
      const y0=Math.min(s[1],e[1]), y1=Math.max(s[1],e[1]);
      const px=(x1-x0)*0.25+0.012, py=(y1-y0)*0.25+0.012;
      const bx0=x0-px, bx1=x1+px, by0=y0-py, by1=y1+py;
      const cw=(bx1-bx0)/N, ch=(by1-by0)/N;
      const risk=new Float32Array(N*N);
      for(let j=0;j<N;j++) for(let i=0;i<N;i++){
        risk[j*N+i]=countNear(bx0+(i+0.5)*cw, by0+(j+0.5)*ch, R);
      }
      const toCell=(pnt)=>[Math.max(0,Math.min(N-1,Math.floor((pnt[0]-bx0)/cw))), Math.max(0,Math.min(N-1,Math.floor((pnt[1]-by0)/ch)))];
      const [sx,sy]=toCell(s), [gx,gy]=toCell(e);
      const idx=(i,j)=>j*N+i;
      const gScore=new Float32Array(N*N).fill(Infinity), prev=new Int32Array(N*N).fill(-1);
      const open=[[0,sx,sy]]; gScore[idx(sx,sy)]=0;
      const cost=(i,j,ni,nj)=>{
        const dx=(ni-i)*cw, dy=(nj-j)*ch;
        const dist=Math.sqrt(dx*dx*Math.cos(0)*0+ (dx*dx)*(85400*85400/ (111320*111320)) + dy*dy); // 近似
        const r=risk[idx(ni,nj)];
        return Math.sqrt(dx*dx+dy*dy)*(1+W*r);
      };
      let found=false, guard=0;
      while(open.length && guard++<400000){
        open.sort((a,b)=>a[0]-b[0]);
        const [f,i,j]=open.shift();
        if(i===gx&&j===gy){ found=true; break; }
        for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++){
          if(!di&&!dj) continue;
          const ni=i+di, nj=j+dj;
          if(ni<0||nj<0||ni>=N||nj>=N) continue;
          const t=gScore[idx(i,j)]+cost(i,j,ni,nj);
          if(t<gScore[idx(ni,nj)]){ gScore[idx(ni,nj)]=t; prev[idx(ni,nj)]=idx(i,j);
            const h=Math.hypot(ni-gx,nj-gy); open.push([t+h,ni,nj]); }
        }
      }
      if(!found) return {err:'A* 未找到路径'};
      // 回溯
      let cur=idx(gx,gy), path=[];
      while(cur!==-1){ path.push([cur%N, Math.floor(cur/N)]); cur=prev[cur]; }
      path.reverse();
      // 取中间点作为途经点（最多 12 个）
      const wp=[];
      const step=Math.max(1, Math.floor((path.length-2)/12));
      for(let k=step;k<path.length-1;k+=step) wp.push([bx0+(path[k][0]+0.5)*cw, by0+(path[k][1]+0.5)*ch]);
      return {wp: wp.slice(0,12), gridLen: path.length};
    }

    async function route(s,e,wp,strat){
      const o={origin:s[0].toFixed(6)+','+s[1].toFixed(6), destination:e[0].toFixed(6)+','+e[1].toFixed(6),
               strategy:strat, show_fields:'cost,polyline', key:AMAP_KEY};
      if(wp&&wp.length) o.waypoints=wp.map(w=>w[0].toFixed(6)+','+w[1].toFixed(6)).join(';');
      const r=await fetch('https://restapi.amap.com/v5/direction/driving?'+qs(o)).then(x=>x.json());
      if(r.status!=='1') return {err:r.info};
      const path=r.route.paths[0];
      const poly=routePolyline(path);
      return {dist:+path.distance, near:findNear(poly,R,new Set()).length, poly};
    }

    const s=[116.427300,39.903200], e=[116.316500,39.984000];
    const R=300;
    const base=await route(s,e,null,'32');
    lines.push('基准: '+(base.dist/1000).toFixed(2)+'km, 300m内 '+base.near+' 个');

    for(const W of [0.02,0.05,0.1,0.2,0.4,0.8]){
      const c=await corridor(s,e,R,W,70);
      if(c.err){ lines.push('W='+W+' 走廊失败: '+c.err); continue; }
      const rr=await route(s,e,c.wp,'32');
      if(rr.err){ lines.push('W='+W+' 算路失败: '+rr.err); continue; }
      lines.push('W='+W+' : '+(rr.dist/1000).toFixed(2)+'km ('+(rr.dist/base.dist).toFixed(2)+'x), 300m内 '+rr.near+' 个  (基准 '+base.near+')');
    }
    return lines;
  });

  console.log(out.join('\n'));
  await b.close();
})();
