/* 通用性验证：对新算法（逐轮避让 + 候选方案）在其他路线上跑一遍 */
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
const t2n = idxs => idxs.filter(i => CAMERAS[i][2] === '2').length;

async function run(name, S, E, R) {
  const edgeEx = Math.max(80, R * 1.5), ex = new Set();
  for (let i = 0; i < CAMERAS.length; i++) if (distM(CAMERAS[i], S) <= edgeEx || distM(CAMERAS[i], E) <= edgeEx) ex.add(i);
  const base = await driving(S, E, '');
  if (base.err) { console.log(`\n【${name}】基准失败 ${base.err}`); return; }
  const baseDist = +base.path.distance, basePoly = routePolyline(base.path);
  const bn = findNear(basePoly, R, ex);
  const plans = [{ tag: '不避让', dist: baseDist, t2: t2n(bn), near: bn.length, poly: basePoly, areas: [] }];
  let areas = [], committed = new Set(), cur = plans[0], bestKey = null, worsen = 0, calls = 1;
  for (let rd = 1; rd <= 16; rd++) {
    const near = findNear(cur.poly, R, ex).filter(i => !committed.has(i));
    if (!near.length) break;
    const room = 32 - areas.length; if (room <= 0) break;
    const wd = near.map(i => ({ i, d: minDistToPoly(CAMERAS[i], cur.poly) })).sort((a, b) => a.d - b.d);
    wd.slice(0, 1).forEach(o => { committed.add(o.i); areas.push(squareAround(o.i, R)); });
    const res = await driving(S, E, avoidStr(areas)); calls++;
    if (res.err) break;
    const poly = routePolyline(res.path), nn = findNear(poly, R, ex);
    cur = { tag: '避让' + areas.length, dist: +res.path.distance, t2: t2n(nn), near: nn.length, poly, areas: areas.slice() };
    plans.push(cur);
    if (!nn.length) break;
    const key = cur.t2 * 1e7 + cur.dist;
    if (bestKey === null || key < bestKey) { bestKey = key; worsen = 0; } else { worsen++; if (worsen >= 5) break; }
    await sleep(60);
  }
  const front = plans.filter(c => !plans.some(o => o !== c && o.t2 <= c.t2 && o.dist <= c.dist && (o.t2 < c.t2 || o.dist < c.dist)));
  front.sort((a, b) => a.dist - b.dist);
  console.log(`\n【${name}】R=${R}m 基准 ${(baseDist / 1000).toFixed(2)}km 红点${t2n(bn)} 全部${bn.length} | 调用${calls}次`);
  front.forEach(c => console.log(`   ${c.tag.padEnd(6)} ${(c.dist / 1000).toFixed(2)}km ${(c.dist / baseDist).toFixed(2)}x | 红点 ${c.t2} 全部 ${c.near}`));
}

(async () => {
  await run('北京南站→首都机场', [116.378331, 39.865107], [116.603157, 40.079645], 50);
  await sleep(200);
  await run('北京站→中关村', [116.427231, 39.902865], [116.316571, 39.983424], 50);
  await sleep(200);
  await run('五道口→国贸', [116.337947, 39.992458], [116.461375, 39.908630], 50);
})();
