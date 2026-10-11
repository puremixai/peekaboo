/* 调参脚本：直接调高德 REST 接口，对比不同避让策略效果 */
const fs = require('fs');
const path = require('path');

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
function squareAround(i, R) {
  const c = CAMERAS[i], padLat = R / 111320, padLng = R / (111320 * Math.cos(c[1] * D2R));
  return { poly: [[c[0] - padLng, c[1] - padLat], [c[0] + padLng, c[1] - padLat], [c[0] + padLng, c[1] + padLat], [c[0] - padLng, c[1] + padLat]], members: [i] };
}
function minDistToPoly(p, poly) {
  let d = 1e9;
  for (let s = 0; s < poly.length - 1; s++) { const dd = distPointSeg(p, poly[s], poly[s + 1]); if (dd < d) d = dd; }
  return d;
}
function avoidStr(areas) {
  if (!areas.length) return '';
  return areas.map(a => a.poly.map(p => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(';')).join('|');
}
function qs(o) {
  return Object.keys(o).map(k => k + '=' + encodeURIComponent(o[k]).replace(/%3B/g, ';').replace(/%7C/g, '|').replace(/%2C/g, ',')).join('&');
}
async function driving(o, d, avStr, strategy) {
  const p = { origin: o[0].toFixed(6) + ',' + o[1].toFixed(6), destination: d[0].toFixed(6) + ',' + d[1].toFixed(6), strategy: String(strategy), show_fields: 'cost,polyline', key: KEY };
  if (avStr) p.avoidpolygons = avStr;
  try {
    const j = await fetch('https://restapi.amap.com/v5/direction/driving?' + qs(p)).then(r => r.json());
    if (j.status !== '1') return { err: (j.info || 'err') + '(' + (j.infocode || '') + ')' };
    const paths = j.route && j.route.paths;
    if (!paths || !paths.length) return { err: '无解' };
    return { path: paths[0] };
  } catch (e) { return { err: 'net:' + e.message }; }
}
function routePolyline(path) {
  const pts = [];
  (path.steps || []).forEach(st => {
    if (!st.polyline) return;
    st.polyline.split(';').forEach(seg => {
      const xy = seg.split(',');
      if (xy.length === 2) { const lng = +xy[0], lat = +xy[1]; if (!isNaN(lng) && !isNaN(lat)) pts.push([lng, lat]); }
    });
  });
  return pts;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 核心规划：可配置 batch / maxIter / maxAreas / 停止条件 */
async function plan(S, E, R, opt) {
  const { batch = 4, maxIter = 10, maxAreas = 32, maxDetour = 2.0, strategy = '32', edgeK = 1.5, worsenMax = 4 } = opt || {};
  const edgeEx = Math.max(80, R * edgeK);
  const exclude = new Set();
  for (let i = 0; i < CAMERAS.length; i++) if (distM(CAMERAS[i], S) <= edgeEx || distM(CAMERAS[i], E) <= edgeEx) exclude.add(i);

  const baseRes = await driving(S, E, '', strategy);
  if (baseRes.err) return { err: '基准失败 ' + baseRes.err };
  const basePoly = routePolyline(baseRes.path);
  const baseDist = +baseRes.path.distance;
  const baseNearIdx = findNear(basePoly, R, exclude);
  const baseNear = baseNearIdx.length;
  const baseT2 = baseNearIdx.filter(i => CAMERAS[i][2] === '2').length;

  let best = null, areas = [], committed = new Set(), iters = 0, worsen = 0, lastErr = null, calls = 1;
  for (let it = 1; it <= maxIter; it++) {
    iters = it;
    const res = await driving(S, E, avoidStr(areas), strategy); calls++;
    if (res.err) { lastErr = res.err; break; }
    const poly = routePolyline(res.path);
    const near = findNear(poly, R, exclude);
    const cand = { path: res.path, poly, near: near.length, dist: +res.path.distance, areas: areas.slice() };
    if (!best || cand.near < best.near || (cand.near === best.near && cand.dist < best.dist)) { best = cand; worsen = 0; }
    else { worsen++; if (worsen >= worsenMax) break; }
    if (!near.length) break;
    if (cand.dist > baseDist * maxDetour) break;
    const room = maxAreas - areas.length;
    if (room <= 0) break;
    const withD = near.filter(i => !committed.has(i)).map(i => ({ i, d: minDistToPoly(CAMERAS[i], poly) }));
    withD.sort((a, b) => a.d - b.d);
    const picked = withD.slice(0, Math.min(batch, room)).map(o => o.i);
    if (!picked.length) break;
    picked.forEach(i => { committed.add(i); areas.push(squareAround(i, R)); });
  }
  if (!best) return { err: lastErr || '失败' };
  const stillIdx = findNear(best.poly, R, exclude);
  const stillT2 = stillIdx.filter(i => CAMERAS[i][2] === '2').length;
  return {
    baseDist, baseNear, baseT2, dist: best.dist, ratio: best.dist / baseDist,
    areas: best.areas.length, iters, calls, stillNear: stillIdx.length, stillT2,
    stillIdx, best
  };
}

const S = [116.360827, 40.079540], E = [116.399771, 40.158950];

(async () => {
  console.log('点位总数:', CAMERAS.length);
  console.log('路线:', S.join(','), '→', E.join(','));
  console.log('');

  const configs = [];
  for (const R of [30, 50, 80]) {
    for (const batch of [1, 4, 8]) {
      configs.push({ R, batch, maxIter: 20, worsenMax: 3 });
    }
  }

  for (const cfg of configs) {
    const r = await plan(S, E, cfg.R, { batch: cfg.batch, maxIter: cfg.maxIter, worsenMax: cfg.worsenMax, maxDetour: 1.6 });
    if (r.err) { console.log(`R=${cfg.R} batch=${cfg.batch} → 失败: ${r.err}`); continue; }
    console.log(`R=${String(cfg.R).padStart(3)} batch=${cfg.batch} | 基准 ${(r.baseDist / 1000).toFixed(2)}km/${r.baseNear}点(红${r.baseT2}) → 结果 ${(r.dist / 1000).toFixed(2)}km ${r.ratio.toFixed(2)}x | 剩余 ${r.stillNear}点(红${r.stillT2}) | 区域${r.areas} 轮${r.iters} 调用${r.calls}`);
    await sleep(120);
  }
})();
