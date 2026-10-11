const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const logs = [];
  p.on('console', m => logs.push('[' + m.type() + '] ' + m.text()));
  p.on('pageerror', e => logs.push('[pageerror] ' + e.message));

  await p.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(8000);

  const sdkOk = await p.evaluate(() => typeof AMap !== 'undefined');
  console.log('AMap SDK 已加载:', sdkOk);

  await p.evaluate(() => {
    setPoint('start', [116.360827, 40.079540], '测试起点');
    setPoint('end', [116.399771, 40.158950], '测试终点');
  });
  await p.click('#planBtn');

  // 等待方案列表出现
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(1000);
    const n = await p.evaluate(() => document.querySelectorAll('.plan').length);
    const st = await p.evaluate(() => document.getElementById('status').textContent);
    if (n > 0) break;
    if (i % 4 === 0) console.log('  等待中… ' + st);
  }

  const info = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.plan')).map(el => ({
      on: el.classList.contains('on'),
      text: el.querySelector('.t b').textContent.trim(),
      km: el.querySelector('.t em').textContent.trim(),
      meta: el.querySelector('.m').textContent.replace(/\s+/g, ' ').trim()
    }));
    return {
      cards,
      result: document.getElementById('result').innerText.replace(/\n+/g, ' | ').trim(),
      plansCount: PLANS.length,
      sel: selPlan
    };
  });

  console.log('\n=== 候选方案 ===');
  info.cards.forEach((c, i) => console.log(`${c.on ? '▶' : ' '} ${i}. ${c.text}  ${c.km}  [${c.meta}]`));
  console.log('\n=== 详情面板 ===');
  console.log(info.result);

  // 截图：选中方案
  await p.screenshot({ path: '用户路线-方案对比.png' });

  // 切到"不避让"方案截图对比
  await p.evaluate(() => selectPlan(0));
  await p.waitForTimeout(2500);
  await p.screenshot({ path: '用户路线-不避让.png' });

  // 再切回红点最少方案
  const bestIdx = await p.evaluate(() => {
    let bi = 0;
    PLANS.forEach((pl, i) => { if (pl.t2 < PLANS[bi].t2 || (pl.t2 === PLANS[bi].t2 && pl.dist < PLANS[bi].dist)) bi = i; });
    selectPlan(bi); return bi;
  });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: '用户路线-红点最少.png' });
  console.log('\n已选中方案索引:', bestIdx);

  if (logs.length) { console.log('\n=== 控制台 ==='); logs.slice(0, 20).forEach(l => console.log(l)); }
  await b.close();
})();
