const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy%20AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  await p.goto(FILE, { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(9000);

  // 选「评论多、截图少」的点位：这样评论区不用滚动就能看到
  const t = await p.evaluate(() => {
    let bi = -1, score = -1;
    for (let i = 0; i < CAMERAS.length; i++) {
      const id = String(CAMERAS[i][6]);
      const d = DETAILS[id], cm = COMMENTS[id];
      if (!cm || cm[1].length < 8) continue;
      const nImg = (d && d !== 1) ? d[1].length : 0;
      if (nImg > 1) continue;                       // 只要 0~1 张截图的
      const s = cm[0] - nImg * 5;
      if (s > score) { score = s; bi = i; }
    }
    if (bi < 0) return null;
    const c = CAMERAS[bi];
    map.setZoomAndCenter(15, [c[0], c[1]]);
    showCameraInfo(bi);
    return { name: c[3], id: String(c[6]), total: COMMENTS[String(c[6])][0],
             nImg: (DETAILS[String(c[6])] || [, []])[1].length };
  });
  await p.waitForTimeout(7500);   // 等地图动画结束 + 兜底重开完成 + 图片加载
  console.log('点位:', t.name, '| id', t.id, '| 原站评论', t.total, '条 | 截图', t.nImg, '张');

  const r = await p.evaluate(() => {
    const el = document.querySelector('.pop');
    el.scrollTop = el.scrollHeight;                 // 滚到底，露出评论区
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight,
             nCm: document.querySelectorAll('.cm').length };
  });
  console.log('弹窗 top=' + r.top + ' bottom=' + r.bottom + ' (视口 ' + r.vh + ') 评论 ' + r.nCm + ' 条');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'shot_comments.png' });
  console.log('已保存 shot_comments.png');
  await b.close();
})();
