/* 诊断：逐个点位测试「单独避让」是否有效，找出真正避不开的点 */
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
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}
const distM = (p, q) => distPointSeg(p, q, q);
const CELL = 0.01, grid = new Map();
for (let i = 0; i < CAMERAS.length; i++) {
  const k = Math.floor(CAMERAS[i][0] / CELL) + '_' + Math.floor(CAMERAS[i][1] / CELL);
  let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
}
function findNear(poly, R, excludeSet) {
  const out = [], seen = new Uint8Array(CAMERAS.length), dLat = R / 111320;
  for (let s = 0; s < poly.length - 1; s++) {
    const a = poly[s], b = poly[s + 1];
    const lat0 = (a[1] + b[1]) / 2, dLng = R / (111320 * Math.max(0.2, Math.cos(lat0 * D2R)));
    const i0 = Math.floor((Math.min(a[0], b[0]) - dLng) / CELL), i1 = Math.floor((Math.max(a[0], b[0]) + dLng) / CELL);
    const j0 = Math.floor((Math.min(a[1], b[1]) - dLat) / CELL), j1 = Math.floor((Math.max(a[1], b[1]) + dLat) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = grid.get(i + '_' + j); if (!arr) continue;
      for (let n = 0; n < arr.length; n++) {
        const idx = arr[n]; if (seen[idx]) continue;
        if (excludeSet && excludeSet.has(idx)) continue;
        if (distPointSeg(CAMERAS[idx], a, b) <= R) { seen[idx] = 1; out.push(idx); }
      }
    }
  }
  return out;
}
function minDistToPoly(p, poly) { let d = 1e9; for (let s = 0; s < poly.length - 1; s++) { const dd = distPointSeg(p, poly[s], poly[s + 1]); if (dd < d) d = dd; } return d; }
function squareAround(i, R, k) {
  k = k || 1;
  const c = CAMERAS[i], padLat = R * k / 111320, padLng = R * k / (111320 * Math.cos(c[1] * D2R));
  return [[c[0] - padLng, c[1] - padLat], [c[0] + padLng, c[1] - padLat], [c[0] + padLng, c[1] + padLat], [c[0] - padLng, c[1] + padLat]];
}
function avoidStr(areas) { return areas.length ? areas.map(p => p.map(q => q[0].toFixed(6) + ',' + q[1].toFixed(6)).join(';')).join('|') : ''; }
function qs(o) { return Object.keys(o).map(k => k + '=' + encodeURIComponent(o[k]).replace(/%3B/g, ';').replace(/%7C/g, '|').replace(/%2C/g, ',')).join('&'); }
async function driving(o, d, av, strategy) {
  const p = { origin: o[0].toFixed(6) + ',' + o[1].toFixed(6), destination: d[0].toFixed(6) + ',' + d[1].toFixed(6), strategy: String(strategy || 32), show_fields: 'cost,polyline', key: KEY };
  if (av) p.avoidpolygons = av;
  try {
    const j = await fetch('https://restapi.amap.com/v5/direction/driving?' + qs(p)).then(r => r.json());
    if (j.status !== '1') return { err: (j.info || 'err') + '(' + (j.infocode || '') + ')' };
    const paths = j.route && j.route.paths; if (!paths || !paths.length) return { err: '无解' };
    return { path: paths[0] };
  } catch (e) { return { err: 'net' }; }
}
function routePolyline(path) {
  const pts = [];
  (path.steps || []).forEach(st => { if (!st.polyline) return; st.polyline.split(';').forEach(seg => { const xy = seg.split(','); if (xy.length === 2) pts.push([+xy[0], +xy[1]]); }); });
  return pts;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = [116.360827, 40.079540], E = [116.399771, 40.158950];

(async () => {
  const R = 30;
  const baseRes = await driving(S, E, '');
  const basePoly = routePolyline(baseRes.path);
  const baseDist = +baseRes.path.distance;
  const near = findNear(basePoly, R, new Set());
  console.log(`基准 ${(baseDist / 1000).toFixed(2)}km, R=${R}m 内 ${near.length} 点`);
  console.log('');

  // 1) 每个点单独避让
  console.log('=== 单独避让测试（每次只放一个方块）===');
  for (const i of near) {
    const c = CAMERAS[i];
    const d0 = minDistToPoly(c, basePoly);
    const res = await driving(S, E, avoidStr([squareAround(i, R)]));
    if (res.err) { console.log(`  #${i} ${c[3].slice(0, 18)} d=${d0.toFixed(0)}m → 算路失败 ${res.err}`); await sleep(100); continue; }
    const poly = routePolyline(res.path);
    const dd = minDistToPoly(c, poly);
    const cnt = findNear(poly, R, new Set()).length;
    console.log(`  #${i} ${String(c[2])} ${c[3].slice(0, 18).padEnd(20)} 原距${d0.toFixed(0)}m → 新距${dd.toFixed(0)}m ${dd > R ? '✔已避开' : '✘仍在内'} | 新路线 ${(+res.path.distance / 1000).toFixed(2)}km 临近${cnt}`);
    await sleep(100);
  }

  // 2) 全部一起避让（放大系数）
  console.log('');
  console.log('=== 全部一起避让（方块放大系数 k）===');
  for (const k of [1, 1.6, 2.5, 4]) {
    const areas = near.map(i => squareAround(i, R, k));
    const res = await driving(S, E, avoidStr(areas));
    if (res.err) { console.log(`  k=${k} → 失败 ${res.err}`); await sleep(100); continue; }
    const poly = routePolyline(res.path);
    const left = near.filter(i => minDistToPoly(CAMERAS[i], poly) <= R);
    const cnt = findNear(poly, R, new Set()).length;
    console.log(`  k=${k} → ${(+res.path.distance / 1000).toFixed(2)}km (${(+res.path.distance / baseDist).toFixed(2)}x) 原有${near.length}点中剩余${left.length}个 [${left.map(i => '#' + i + ':' + minDistToPoly(CAMERAS[i], poly).toFixed(0) + 'm').join(' ')}] | 全路线临近${cnt}`);
    await sleep(100);
  }
})();
