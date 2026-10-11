const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await p.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(8000);

  const stat = await p.evaluate(() => {
    const keys = Object.keys(DETAILS);
    let withImg = 0; keys.forEach(k => { if (DETAILS[k][1] && DETAILS[k][1].length) withImg++; });
    return { total: CAMERAS.length, detailKeys: keys.length, withImg };
  });
  console.log('点位数:', stat.total, '| 已有详情:', stat.detailKeys, '| 含截图:', stat.withImg);

  // 找一个「有截图」的点位
  const t = await p.evaluate(() => {
    let idx = -1;
    for (let i = 0; i < CAMERAS.length; i++) {
      const d = DETAILS[CAMERAS[i][6]];
      if (d && d[1] && d[1].length) { idx = i; break; }
    }
    if (idx < 0) return null;
    map.setZoomAndCenter(16, [CAMERAS[idx][0], CAMERAS[idx][1]]);
    showCameraInfo(idx);
    return { idx, name: CAMERAS[idx][3], id: CAMERAS[idx][6], det: DETAILS[CAMERAS[idx][6]] };
  });
  if (!t) { console.log('没有带截图的点位'); await b.close(); return; }
  console.log('\n点位:', t.name, '| 原站ID:', t.id);
  console.log('精确时间:', t.det[0], '| 截图:', JSON.stringify(t.det[1]));

  await p.waitForTimeout(4000);   // 等图片加载

  const pop = await p.evaluate(() => {
    const el = document.querySelector('.pop');
    const img = document.querySelector('.pop-img');
    return {
      text: el ? el.innerText.replace(/\n+/g, ' | ').trim() : null,
      imgSrc: img ? img.getAttribute('src') : null,
      imgNatural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
      hasSrcLink: !!document.querySelector('.pop-src')
    };
  });
  console.log('\n弹窗:', pop.text);
  console.log('截图 URL:', pop.imgSrc);
  console.log('截图是否真的加载出来了:', pop.imgNatural && pop.imgNatural.w > 0 ? `✔ ${pop.imgNatural.w}x${pop.imgNatural.h}` : '✘ 未加载');
  console.log('保留原站链接（次要）:', pop.hasSrcLink ? '有' : '无');

  // 点击截图 → 放大层
  await p.evaluate(() => document.querySelector('.pop-img').click());
  await p.waitForTimeout(2500);
  const lb = await p.evaluate(() => {
    const l = document.getElementById('lightbox');
    const im = document.getElementById('lbImg');
    return { display: getComputedStyle(l).display, src: im.getAttribute('src'), nat: { w: im.naturalWidth, h: im.naturalHeight }, cap: document.getElementById('lbCap').textContent };
  });
  console.log('\n放大层:', lb.display, '| 图片:', lb.nat.w + 'x' + lb.nat.h, '| 说明:', lb.cap);
  await p.screenshot({ path: 'shot_lightbox.png' });

  // 关闭
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  console.log('Esc 关闭后:', await p.evaluate(() => getComputedStyle(document.getElementById('lightbox')).display));

  // 再截弹窗本身
  await p.evaluate((i) => showCameraInfo(i), t.idx);
  await p.waitForTimeout(3000);
  await p.screenshot({ path: 'shot_popup.png' });

  if (errs.length) console.log('\n错误:\n' + errs.slice(0, 6).join('\n'));
  await b.close();
})();
