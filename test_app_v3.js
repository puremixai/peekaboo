const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = 'file:///C:/Users/ausu/WorkBuddy AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';
const S = [116.360827, 40.079540], E = [116.399771, 40.158950];

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await p.goto(FILE, { waitUntil: 'load', timeout: 60000 });
  await p.waitForTimeout(8000);
  console.log('AMap SDK:', await p.evaluate(() => typeof AMap !== 'undefined'));

  await p.evaluate(([s, e]) => { setPoint('start', s, '测试起点'); setPoint('end', e, '测试终点'); }, [S, E]);
  await p.click('#planBtn');

  for (let i = 0; i < 90; i++) {
    await p.waitForTimeout(1000);
    const n = await p.evaluate(() => document.querySelectorAll('.plan').length);
    if (n > 0) break;
    if (i % 5 === 0) console.log('  等待…', await p.evaluate(() => document.getElementById('status').textContent));
  }
  await p.waitForTimeout(1500);

  const info = await p.evaluate(() => ({
    radius: document.getElementById('radius').value,
    cards: Array.from(document.querySelectorAll('.plan')).map(el => ({
      on: el.classList.contains('on'),
      t: el.querySelector('.t b').textContent.trim(),
      km: el.querySelector('.t em').textContent.trim(),
      m: el.querySelector('.m').textContent.replace(/\s+/g, ' ').trim()
    })),
    result: document.getElementById('result').innerText.replace(/\n+/g, ' | ').trim(),
    nearest: PLANS[selPlan] && PLANS[selPlan].closeRed ? PLANS[selPlan].closeRed.slice(0, 5).map(o => Math.round(o.d)) : null,
    redCount: PLANS[selPlan] ? PLANS[selPlan].red : null
  }));
  console.log('\n半径:', info.radius, '| 选中方案红点数:', info.redCount, '| 最近红点距离:', JSON.stringify(info.nearest));
  info.cards.forEach((c, i) => console.log(`${c.on ? '▶' : ' '} ${i}. ${c.t}  ${c.km}  [${c.m}]`));
  console.log('\n--- 详情 ---\n' + info.result);

  // 截图1：整条路线（走廊全局）
  await p.evaluate(() => map.setZoomAndCenter(12, [116.392, 40.118]));
  await p.waitForTimeout(2600);
  await p.locator('#map').screenshot({ path: 'shot_corridor.png' });

  // 截图2：飞到最近的红点核查（zoom 17）
  const near = await p.evaluate(() => {
    const o = PLANS[selPlan].closeRed[0]; const c = CAMERAS[o.i];
    map.setZoomAndCenter(17, [c[0], c[1]]);
    return { d: o.d, name: c[3] };
  });
  await p.waitForTimeout(3000);
  await p.locator('#map').screenshot({ path: 'shot_verify.png' });
  console.log('\n核查截图: 最近红点「' + near.name + '」距离 ' + near.d.toFixed(0) + ' 米');

  if (errs.length) console.log('\n' + errs.join('\n'));
  await b.close();
})();
