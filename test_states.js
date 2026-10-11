const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy%20AI/2026-10-11-18-57-20/_test_states.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await p.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(8000);

  for (let i = 0; i < 3; i++) {
    await p.evaluate((k) => {
      map.setZoomAndCenter(15, [CAMERAS[k][0], CAMERAS[k][1]]);
      showCameraInfo(k);
    }, i);
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => {
      const el = document.querySelector('.pop');
      const imgs = document.querySelectorAll('.pop-img');
      const noimg = document.querySelector('.pop-noimg');
      return {
        text: el ? el.innerText.replace(/\n+/g, ' | ').trim() : '(无弹窗)',
        nImg: imgs.length,
        imgNat: imgs.length ? { w: imgs[0].naturalWidth, h: imgs[0].naturalHeight } : null,
        noimg: noimg ? noimg.textContent : null,
        hasSrcLink: !!document.querySelector('.pop-src')
      };
    });
    console.log('\n===== 点位 ' + i + ' =====');
    console.log('弹窗文本:', r.text);
    console.log('截图数:', r.nImg, r.imgNat ? ('首图 ' + r.imgNat.w + 'x' + r.imgNat.h) : '');
    console.log('提示:', r.noimg);
    console.log('原站外链:', r.hasSrcLink ? '有' : '无');
    await p.screenshot({ path: 'shot_state_' + i + '.png' });
  }

  if (errs.length) console.log('\n错误:\n' + errs.slice(0, 6).join('\n'));
  await b.close();
})();
