const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy%20AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 1080 } });
  await p.goto(FILE, { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(9000);

  // 找一个「多张截图」的点位，并把点位放到屏幕偏下位置，让弹窗完整落在视口内
  const t = await p.evaluate(() => {
    let best = -1, bestN = 0;
    for (let i = 0; i < CAMERAS.length; i++) {
      const d = DETAILS[CAMERAS[i][6]];
      if (d && d !== 1 && d[1] && d[1].length > bestN) { bestN = d[1].length; best = i; }
    }
    const c = CAMERAS[best];
    map.setZoomAndCenter(15, [c[0], c[1] + 0.0092]);   // 中心北移 → 点位落在屏幕下方
    showCameraInfo(best);
    return { name: c[3], id: c[6], n: bestN };
  });
  await p.waitForTimeout(4500);

  const box = await p.evaluate(() => {
    const el = document.querySelector('.pop');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
             w: Math.round(r.width), imgs: document.querySelectorAll('.pop-img').length,
             firstLoaded: (document.querySelector('.pop-img') || {}).naturalWidth || 0 };
  });
  console.log('点位:', t.name, '| id', t.id, '| 截图', t.n, '张');
  console.log('弹窗包围盒:', JSON.stringify(box));
  await p.screenshot({ path: 'shot_popup.png' });
  console.log('已保存 shot_popup.png');

  // 再截一张放大灯箱
  if (box && box.imgs) {
    await p.evaluate(() => document.querySelector('.pop-img').click());
    await p.waitForTimeout(3000);
    const lb = await p.evaluate(() => ({
      d: getComputedStyle(document.getElementById('lightbox')).display,
      nat: { w: document.getElementById('lbImg').naturalWidth, h: document.getElementById('lbImg').naturalHeight },
      cap: document.getElementById('lbCap').textContent,
      pos: document.getElementById('lbPos').textContent
    }));
    console.log('灯箱:', lb.d, '|', lb.nat.w + 'x' + lb.nat.h, '|', lb.cap, '|', lb.pos);
    await p.screenshot({ path: 'shot_lightbox.png' });
    console.log('已保存 shot_lightbox.png');
  }
  await b.close();
})();
