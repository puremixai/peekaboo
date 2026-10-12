const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy%20AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await p.goto(FILE, { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(9000);

  // 1) 覆盖率统计
  const cov = await p.evaluate(() => {
    let unknown = 0, missing = 0, noImg = 0, img = 0, imgs = 0;
    CAMERAS.forEach(c => {
      const d = DETAILS[c[6]];
      if (d === undefined) unknown++;
      else if (d === 1) missing++;
      else if (!d[1] || !d[1].length) noImg++;
      else { img++; imgs += d[1].length; }
    });
    return { total: CAMERAS.length, unknown, missing, noImg, img, imgs };
  });
  console.log(`覆盖率：点位 ${cov.total}`);
  console.log(`  有截图 ${cov.img} (${(100*cov.img/cov.total).toFixed(1)}%) · 截图总数 ${cov.imgs}`);
  console.log(`  无截图 ${cov.noImg} · 原站失效 ${cov.missing} · 未抓取 ${cov.unknown}`);

  // 2) 随机抽检 12 个点位
  const picks = await p.evaluate(() => {
    const out = [], n = CAMERAS.length;
    for (let k = 0; k < 12; k++) out.push(Math.floor(Math.random() * n));
    return out;
  });
  let ok = 0, bad = 0;
  for (const i of picks) {
    const r = await p.evaluate((idx) => {
      map.setZoomAndCenter(16, [CAMERAS[idx][0], CAMERAS[idx][1]]);
      showCameraInfo(idx);
      const d = DETAILS[CAMERAS[idx][6]];
      return { id: CAMERAS[idx][6], name: CAMERAS[idx][3].slice(0, 26),
               exact: d && d !== 1 ? d[0] : null, n: d && d !== 1 ? d[1].length : 0 };
    }, i);
    await p.waitForTimeout(900);
    const ui = await p.evaluate(() => {
      const el = document.querySelector('.pop');
      const t = el ? el.innerText : '';
      return { hasExact: /精确时间/.test(t), nImg: document.querySelectorAll('.pop-img').length,
               noImgMsg: /暂无该点位的违章截图记录/.test(t) };
    });
    const pass = r.exact && ui.hasExact && !ui.noImgMsg && ui.nImg === r.n;
    if (pass) ok++; else bad++;
    console.log(`  ${pass ? '✔' : '✘'} id=${r.id} ${r.name} | 精确时间 ${r.exact} | 截图 ${r.n} → 弹窗渲染 ${ui.nImg}`);
  }
  console.log(`\n抽检结果：${ok}/12 通过${bad ? '，' + bad + ' 个异常' : ''}`);

  // 3) 展示一张有多个截图的弹窗
  const multi = await p.evaluate(() => {
    let best = -1, bestN = 0;
    for (let i = 0; i < CAMERAS.length; i++) {
      const d = DETAILS[CAMERAS[i][6]];
      if (d && d !== 1 && d[1] && d[1].length > bestN) { bestN = d[1].length; best = i; }
    }
    map.setZoomAndCenter(15, [CAMERAS[best][0], CAMERAS[best][1]]);
    showCameraInfo(best);
    return { name: CAMERAS[best][3], n: bestN, id: CAMERAS[best][6] };
  });
  await p.waitForTimeout(4500);
  console.log(`\n展示点位：${multi.name}（id ${multi.id}，${multi.n} 张截图）`);
  await p.screenshot({ path: 'shot_popup.png' });

  if (errs.length) console.log('\n错误:\n' + errs.slice(0, 5).join('\n'));
  await b.close();
})();
