const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = process.argv[2] || 'file:///C:/Users/ausu/WorkBuddy%20AI/2026-10-11-18-57-20/_app_test.html';
const S = [116.360827, 40.079540], E = [116.399771, 40.158950];

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await p.goto(FILE, { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(9000);
  console.log('AMap SDK:', await p.evaluate(() => typeof AMap !== 'undefined'));

  /* ---------- 1. 数据完整性 ---------- */
  const st = await p.evaluate(() => {
    const keys = Object.keys(DETAILS);
    let img = 0, miss = 0;
    keys.forEach(k => { if (DETAILS[k] === 1) miss++; else if (DETAILS[k][1] && DETAILS[k][1].length) img++; });
    return { cams: CAMERAS.length, det: keys.length, img, miss };
  });
  console.log(`数据: 点位 ${st.cams} | 详情 ${st.det} | 含截图 ${st.img} | 原站失效 ${st.miss}`);

  /* ---------- 2. 路径规划回归（用户那条路：0 红点） ---------- */
  await p.evaluate(([s, e]) => { setPoint('start', s, '测试起点'); setPoint('end', e, '测试终点'); }, [S, E]);
  await p.click('#planBtn');
  for (let i = 0; i < 120; i++) {
    await p.waitForTimeout(1000);
    if (await p.evaluate(() => document.querySelectorAll('.plan').length) > 0) break;
    if (i % 6 === 0) console.log('  等待…', await p.evaluate(() => document.getElementById('status').textContent));
  }
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => ({
    radius: document.getElementById('radius').value,
    cards: Array.from(document.querySelectorAll('.plan')).map(el => ({
      on: el.classList.contains('on'),
      t: el.querySelector('.t b').textContent.trim(),
      km: el.querySelector('.t em').textContent.trim()
    })),
    red: PLANS[selPlan] ? PLANS[selPlan].red : null,
    nearest: PLANS[selPlan] && PLANS[selPlan].closeRed ? PLANS[selPlan].closeRed.slice(0, 3).map(o => Math.round(o.d)) : null
  }));
  console.log(`\n半径 ${info.radius} m | 选中方案红点 ${info.red} | 最近红点 ${JSON.stringify(info.nearest)} m`);
  info.cards.forEach((c, i) => console.log(`${c.on ? '▶' : ' '} ${i}. ${c.t}  ${c.km}`));
  console.log(info.red === 0 ? '✔ 0 红点达标' : '✘ 仍有红点');

  /* ---------- 3. 弹窗 + 灯箱（有截图的点位） ---------- */
  const t = await p.evaluate(() => {
    let idx = -1;
    for (let i = 0; i < CAMERAS.length; i++) {
      const d = DETAILS[CAMERAS[i][6]];
      if (d && d !== 1 && d[1] && d[1].length) { idx = i; break; }
    }
    if (idx < 0) return null;
    map.setZoomAndCenter(16, [CAMERAS[idx][0], CAMERAS[idx][1]]);
    showCameraInfo(idx);
    return { idx, name: CAMERAS[idx][3], id: CAMERAS[idx][6], det: DETAILS[CAMERAS[idx][6]] };
  });
  if (t) {
    await p.waitForTimeout(4000);
    const pop = await p.evaluate(() => {
      const el = document.querySelector('.pop'), img = document.querySelector('.pop-img');
      return { text: el ? el.innerText.replace(/\n+/g, ' | ').trim() : null,
               nImg: document.querySelectorAll('.pop-img').length,
               nat: img ? { w: img.naturalWidth, h: img.naturalHeight } : null };
    });
    console.log('\n弹窗(' + t.id + '):', pop.text);
    console.log('截图', pop.nImg, '张，首图', pop.nat ? pop.nat.w + 'x' + pop.nat.h : '未加载');
    await p.evaluate(() => document.querySelector('.pop-img').click());
    await p.waitForTimeout(2500);
    const lb = await p.evaluate(() => ({
      d: getComputedStyle(document.getElementById('lightbox')).display,
      nat: { w: document.getElementById('lbImg').naturalWidth, h: document.getElementById('lbImg').naturalHeight },
      pos: document.getElementById('lbPos').textContent
    }));
    console.log('灯箱:', lb.d, '| 图片', lb.nat.w + 'x' + lb.nat.h, '| 位置', lb.pos);
    await p.screenshot({ path: 'shot_lightbox.png' });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
    await p.evaluate((i) => showCameraInfo(i), t.idx);
    await p.waitForTimeout(3000);
    await p.screenshot({ path: 'shot_popup.png' });
  }

  if (errs.length) console.log('\n错误:\n' + errs.slice(0, 8).join('\n'));
  await b.close();
})();
