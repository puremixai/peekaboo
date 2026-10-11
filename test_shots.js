const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';
const ZOOM = 12, CENTER = [116.392, 40.118];

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  await p.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(8000);

  await p.evaluate(() => {
    setPoint('start', [116.360827, 40.079540], '测试起点');
    setPoint('end', [116.399771, 40.158950], '测试终点');
  });

  // 预先算好基准路线
  await p.evaluate(async () => {
    const R = 50, S = startPt, E = endPt;
    const edgeEx = Math.max(80, R * 1.5), exclude = new Set();
    for (let i = 0; i < CAMERAS.length; i++) if (distM(CAMERAS[i], S) <= edgeEx || distM(CAMERAS[i], E) <= edgeEx) exclude.add(i);
    const base = await fetchDriving(S, E, '', '32');
    const poly = routePolyline(base.path);
    window.__BASE = { poly, near: findNear(poly, R, exclude), dist: +base.path.distance, t2: findNear(poly, R, exclude).filter(i => CAMERAS[i][2] === '2').length };
  });

  await p.click('#planBtn');
  for (let i = 0; i < 70; i++) {
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => document.querySelectorAll('.plan').length) > 0) break;
  }
  await p.waitForTimeout(1200);

  const summary = await p.evaluate(() => ({
    base: { km: (window.__BASE.dist / 1000).toFixed(2), t2: window.__BASE.t2 },
    plans: PLANS.map(pl => ({ label: pl.label, km: (pl.dist / 1000).toFixed(2), t2: pl.t2, near: pl.near.length, ratio: (pl.dist / BASE_DIST).toFixed(2) }))
  }));
  console.log('基准:', JSON.stringify(summary.base));
  summary.plans.forEach((s, i) => console.log(`方案${i}:`, JSON.stringify(s)));

  async function shot(name, drawFn) {
    await p.evaluate(drawFn);
    await p.evaluate(([z, c]) => { map.setZoomAndCenter(z, c); }, [ZOOM, CENTER]);
    await p.waitForTimeout(2600);
    await p.locator('#map').screenshot({ path: name });
    console.log('已截图', name);
  }

  // ① 基准（不避让）
  await shot('shot_base.png', () => {
    if (routeLine) { map.remove(routeLine); routeLine = null; }
    if (avoidShapes.length) { map.remove(avoidShapes); avoidShapes = []; }
    if (routeNearLayer) { map.remove(routeNearLayer); routeNearLayer = null; }
    routeLine = new AMap.Polyline({ path: window.__BASE.poly, strokeColor: '#7b8794', strokeWeight: 6, strokeOpacity: 0.95, lineJoin: 'round', zIndex: 20, showDir: true });
    map.add(routeLine);
    routeNearLayer = new AMap.LabelsLayer({ zooms: [9, 20], zIndex: 105, collision: false, animation: false });
    map.add(routeNearLayer);
    routeNearLayer.add(window.__BASE.near.map(i => new AMap.LabelMarker({ position: [CAMERAS[i][0], CAMERAS[i][1]], zIndex: 105, icon: { type: 'image', image: ICONS['near'], size: [19, 19], anchor: 'center' } })));
  });

  // ② 各候选方案
  for (let i = 0; i < summary.plans.length; i++) {
    await shot('shot_plan' + i + '.png', `selectPlan(${i})`);
  }
  await b.close();
})();
