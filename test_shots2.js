const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';
const S = [116.360827, 40.079540], E = [116.399771, 40.158950];
const ZOOM = 12, CENTER = [116.392, 40.118];

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  await p.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(8000);
  await p.evaluate(([s, e]) => { setPoint('start', s, '起点'); setPoint('end', e, '终点'); }, [S, E]);

  // 先画基准（不避让）路线
  await p.evaluate(async () => {
    const R = parseInt(document.getElementById('radius').value, 10);
    const ex = new Set();
    for (let i = 0; i < CAMERAS.length; i++) if (distM(CAMERAS[i], startPt) <= 60 || distM(CAMERAS[i], endPt) <= 60) ex.add(i);
    const base = await fetchDriving(startPt, endPt, '', '32');
    const poly = routePolyline(base.path);
    const near = findNear(poly, R, ex);
    window.__BASE = { poly, near, dist: +base.path.distance };
  });
  await p.evaluate(() => {
    if (routeLine) { map.remove(routeLine); routeLine = null; }
    if (corridorLine) { map.remove(corridorLine); corridorLine = null; }
    if (routeNearLayer) { map.remove(routeNearLayer); routeNearLayer = null; }
    routeLine = new AMap.Polyline({ path: window.__BASE.poly, strokeColor: '#7b8794', strokeWeight: 6, strokeOpacity: 0.95, lineJoin: 'round', zIndex: 20, showDir: true });
    map.add(routeLine);
    routeNearLayer = new AMap.LabelsLayer({ zooms: [9, 20], zIndex: 105, collision: false, animation: false });
    map.add(routeNearLayer);
    routeNearLayer.add(window.__BASE.near.map(i => new AMap.LabelMarker({ position: [CAMERAS[i][0], CAMERAS[i][1]], zIndex: 105, icon: { type: 'image', image: ICONS['near'], size: [19, 19], anchor: 'center' } })));
  });
  await p.evaluate(([z, c]) => map.setZoomAndCenter(z, c), [ZOOM, CENTER]);
  await p.waitForTimeout(2600);
  await p.locator('#map').screenshot({ path: 'shot_base.png' });
  console.log('已截图 shot_base.png（基准）');

  // 再算避让方案，截最优方案
  await p.click('#planBtn');
  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => document.querySelectorAll('.plan').length) > 0) break;
  }
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({
    red: PLANS[selPlan].red, km: (PLANS[selPlan].dist / 1000).toFixed(2),
    nearest: PLANS[selPlan].closeRed[0].d,
    name: CAMERAS[PLANS[selPlan].closeRed[0].i][3],
    baseKm: (window.__BASE.dist / 1000).toFixed(2)
  }));
  console.log(JSON.stringify(r));

  await p.evaluate(([z, c]) => map.setZoomAndCenter(z, c), [ZOOM, CENTER]);
  await p.waitForTimeout(2600);
  await p.locator('#map').screenshot({ path: 'shot_best.png' });

  await p.evaluate(() => {
    const o = PLANS[selPlan].closeRed[0], c = CAMERAS[o.i];
    map.setZoomAndCenter(17, [c[0], c[1]]);
  });
  await p.waitForTimeout(3000);
  await p.locator('#map').screenshot({ path: 'shot_verify.png' });
  console.log('已截图 shot_best.png / shot_verify.png');
  await b.close();
})();
