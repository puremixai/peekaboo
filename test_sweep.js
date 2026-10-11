/* 参数扫描：放宽停止条件，寻找能把"临近点位"降到最低的配置 */
const fs = require('fs'), path = require('path');
const KEY = (() => { try { return fs.readFileSync(path.join(__dirname, 'amap_key.txt'), 'utf8').trim(); } catch (e) { return 'YOUR_AMAP_KEY'; } })();
const BASE = __dirname;
const raw = JSON.parse(fs.readFileSync(path.join(BASE, 'cameras.json'), 'utf8'));
const CAMERAS = raw.map(r => [r.lng, r.lat, r.aa, r.name, r.time]);
const R_EARTH = 6371000, D2R = Math.PI / 180;
function distPointSeg(p, a, b) {
  const lat0 = (a[1] + b[1]) / 2 * D2R, kx = R_EARTH * Math.cos(lat0) * D2R, ky = R_EARTH * D2R;
  const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky, px = p[0] * kx, py = p[1] * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}
const distM = (p, q) => distPointSeg(p, q, q);
const CELL = 0.01, grid = new Map();
for (let i = 0; i < CAMERAS.length; i++) { const k = Math.floor(CAMERAS[i][0] / CELL) + '_' + Math.floor(CAMERAS[i][1] / CELL); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i); }
function findNear(poly, R, ex) {
  const out = [], seen = new Uint8Array(CAMERAS.length), dLat = R / 111320;
  for (let s = 0; s < poly.length - 1; s++) {
    const a = poly[s], b = poly[s + 1], lat0 = (a[1] + b[1]) / 2, dLng = R / (111320 * Math.max(0.2, Math.cos(lat0 * D2R)));
    const i0 = Math.floor((Math.min(a[0], b[0]) - dLng) / CELL), i1 = Math.floor((Math.max(a[0], b[0]) + dLng) / CELL);
    const j0 = Math.floor((Math.min(a[1], b[1]) - dLat) / CELL), j1 = Math.floor((Math.max(a[1], b[1]) + dLat) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = grid.get(i + '_' + j); if (!arr) continue;
      for (let n = 0; n < arr.length; n++) { const idx = arr[n]; if (seen[idx]) continue; if (ex && ex.has(idx)) continue;
        if (distPointSeg(CAMERAS[idx], a, b) <= R) { seen[idx] = 1; out.push(idx); } }
    }
  }
  return out;
}
function minDistToPoly(p, poly) { let d = 1e9; for (let s = 0; s < poly.length - 1; s++) { const dd = distPointSeg(p, poly[s], poly[s + 1]); if (dd < d) d = dd; } return d; }
function squareAround(i, R) { const c = CAMERAS[i], pLat = R / 111320, pLng = R / (111320 * Math.cos(c[1] * D2R));
  return [[c[0] - pLng, c[1] - pLat], [c[0] + pLng, c[1] - pLat], [c[0] + pLng, c[1] + pLat], [c[0] - pLng, c[1] + pLat]]; }
function avoidStr(areas) { return areas.length ? areas.map(p => p.map(q => q[0].toFixed(6) + ',' + q[1].toFixed(6)).join(';')).join('|') : ''; }
function qs(o) { return Object.keys(o).map(k => k + '=' + encodeURIComponent(o[k]).replace(/%3B/g, ';').replace(/%7C/g, '|').replace(/%2C/g, ',')).join('&'); }
async function driving(o, d, av, strat) {
  const p = { origin: o[0].toFixed(6) + ',' + o[1].toFixed(6), destination: d[0].toFixed(6) + ',' + d[1].toFixed(6), strategy: String(strat || 32), show_fields: 'cost,polyline', key: KEY };
  if (av) p.avoidpolygons = av;
  try { const j = await fetch('https://restapi.amap.com/v5/direction/driving?' + qs(p)).then(r => r.json());
    if (j.status !== '1') return { err: (j.info || 'err') + '(' + (j.infocode || '') + ')' };
    const ps = j.route && j.route.paths; if (!ps || !ps.length) return { err: '无解' }; return { path: ps[0] };
  } catch (e) { return { err: 'net' }; }
}
function routePolyline(path) { const pts = []; (path.steps || []).forEach(st => { if (!st.polyline) return; st.polyline.split(';').forEach(seg => { const xy = seg.split(','); if (xy.length === 2) pts.push([+xy[0], +xy[1]]); }); }); return pts; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = [116.360827, 40.079540], E = [116.399771, 40.158950];

async function plan(R, opt) {
  const { batch = 4, maxIter = 10, maxAreas = 32, maxDetour = 2.0, strategy = 32, edgeK = 1.5, worsenMax = 4, firstAll = false } = opt || {};
  const edgeEx = Math.max(80, R * edgeK);
  const ex = new Set();
  for (let i = 0; i < CAMERAS.length; i++) if (distM(CAMERAS[i], S) <= edgeEx || distM(CAMERAS[i], E) <= edgeEx) ex.add(i);
  const base = await driving(S, E, '', strategy);
  if (base.err) return { err: 'base:' + base.err };
  const baseDist = +base.path.distance, basePoly = routePolyline(base.path);
  const baseNearIdx = findNear(basePoly, R, ex);
  const baseT2 = baseNearIdx.filter(i => CAMERAS[i][2] === '2').length;
  let best = null, areas = [], committed = new Set(), iters = 0, worsen = 0, lastErr = null, calls = 1;
  for (let it = 1; it <= maxIter; it++) {
    iters = it;
    const res = await driving(S, E, avoidStr(areas), strategy); calls++;
    if (res.err) { lastErr = res.err; break; }
    const poly = routePolyline(res.path), near = findNear(poly, R, ex);
    const cand = { poly, near: near.length, dist: +res.path.distance, areas: areas.slice() };
    if (!best || cand.near < best.near || (cand.near === best.near && cand.dist < best.dist)) { best = cand; worsen = 0; }
    else { worsen++; if (worsen >= worsenMax) break; }
    if (!near.length) break;
    if (cand.dist > baseDist * maxDetour) break;
    const room = maxAreas - areas.length; if (room <= 0) break;
    const withD = near.filter(i => !committed.has(i)).map(i => ({ i, d: minDistToPoly(CAMERAS[i], poly) }));
    withD.sort((a, b) => a.d - b.d);
    const nb = (firstAll && it === 1) ? Math.min(room, withD.length) : batch;
    const picked = withD.slice(0, Math.min(nb, room)).map(o => o.i);
    if (!picked.length) break;
    picked.forEach(i => { committed.add(i); areas.push(squareAround(i, R)); });
  }
  if (!best) return { err: lastErr || 'fail' };
  const stillIdx = findNear(best.poly, R, ex);
  return { baseDist, baseNear: baseNearIdx.length, baseT2, dist: best.dist, ratio: best.dist / baseDist,
    areas: best.areas.length, iters, calls, stillNear: stillIdx.length, stillT2: stillIdx.filter(i => CAMERAS[i][2] === '2').length, stillIdx, poly: best.poly, ex };
}

(async () => {
  const cases = [
    { R: 30, batch: 1, maxIter: 34, worsenMax: 12, maxDetour: 1.5 },
    { R: 30, batch: 4, maxIter: 16, worsenMax: 8, maxDetour: 1.5 },
    { R: 30, batch: 4, maxIter: 16, worsenMax: 8, maxDetour: 1.5, firstAll: true },
    { R: 50, batch: 1, maxIter: 34, worsenMax: 12, maxDetour: 1.5 },
    { R: 50, batch: 4, maxIter: 16, worsenMax: 8, maxDetour: 1.5, firstAll: true },
    { R: 40, batch: 1, maxIter: 34, worsenMax: 12, maxDetour: 1.5 },
    { R: 60, batch: 1, maxIter: 34, worsenMax: 12, maxDetour: 1.5 },
  ];
  for (const c of cases) {
    const r = await plan(c.R, c);
    if (r.err) { console.log(`R=${c.R} batch=${c.batch} firstAll=${!!c.firstAll} → 失败 ${r.err}`); continue; }
    console.log(`R=${String(c.R).padStart(3)} batch=${c.batch} all=${c.firstAll ? 'Y' : 'N'} detour≤${c.maxDetour} | 基准 ${(r.baseDist / 1000).toFixed(2)}km/${r.baseNear}点(红${r.baseT2}) → ${(r.dist / 1000).toFixed(2)}km ${r.ratio.toFixed(2)}x | 剩余 ${r.stillNear}(红${r.stillT2}) | 区域${r.areas} 轮${r.iters} 调用${r.calls}`);
    await sleep(120);
  }

  // 详细看最优配置的剩余点
  console.log('\n=== R=30 batch=1 剩余点详情 ===');
  const best = await plan(30, { batch: 1, maxIter: 34, worsenMax: 12, maxDetour: 1.5 });
  best.stillIdx.forEach(i => {
    const c = CAMERAS[i];
    console.log(`  #${i} 类型${c[2]} ${c[3].slice(0, 24)} | 距路线 ${minDistToPoly(c, best.poly).toFixed(0)}m | 距起点 ${distM(c, S).toFixed(0)}m 距终点 ${distM(c, E).toFixed(0)}m`);
  });
})();
