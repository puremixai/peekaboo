const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = process.argv[2] || 'file:///C:/Users/ausu/WorkBuddy%20AI/2026-10-11-18-57-20/%E5%8C%97%E4%BA%AC%E8%BF%9B%E4%BA%AC%E6%91%84%E5%83%8F%E5%A4%B4%E9%81%BF%E8%AE%A9%E5%AF%BC%E8%88%AA.html';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 1080 } });
  const errs = [];
  p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
  await p.goto(FILE, { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(9000);

  const cov = await p.evaluate(() => {
    let withCm = 0, totalCm = 0, embedded = 0, maxN = 0;
    Object.keys(COMMENTS).forEach(k => {
      const v = COMMENTS[k];
      withCm++; totalCm += v[0]; embedded += v[1].length;
      if (v[1].length > maxN) maxN = v[1].length;
    });
    return { points: CAMERAS.length, withCm, totalCm, embedded, maxN,
             commentsKeys: Object.keys(COMMENTS).length };
  });
  console.log(`评论覆盖：${cov.withCm} / ${cov.points} 个点位有评论 (${(100*cov.withCm/cov.points).toFixed(1)}%)`);
  console.log(`  原站评论总数 ${cov.totalCm} · 本地内嵌 ${cov.embedded} 条 · 单点位最多 ${cov.maxN} 条`);

  // 抽检 8 个有评论的点位
  const picks = await p.evaluate(() => {
    const keys = Object.keys(COMMENTS);
    const out = [];
    for (let i = 0; i < 8; i++) out.push(keys[Math.floor(Math.random() * keys.length)]);
    return out;
  });
  let ok = 0, bad = 0;
  for (const cid of picks) {
    const r = await p.evaluate((id) => {
      let idx = -1;
      for (let i = 0; i < CAMERAS.length; i++) if (String(CAMERAS[i][6]) === id) { idx = i; break; }
      if (idx < 0) return null;
      map.setZoomAndCenter(15, [CAMERAS[idx][0], CAMERAS[idx][1]]);
      showCameraInfo(idx);
      const v = COMMENTS[id];
      return { name: CAMERAS[idx][3].slice(0, 24), total: v[0], local: v[1].length, first: v[1][0] };
    }, cid);
    if (!r) continue;
    await p.waitForTimeout(800);
    const ui = await p.evaluate(() => {
      const cm = document.querySelector('.pop-cm');
      const items = document.querySelectorAll('.cm');
      const h = document.querySelector('.pop-cm-h');
      return { hasBlock: !!cm, n: items.length, header: h ? h.innerText.replace(/\s+/g, ' ').trim() : null,
               who0: items[0] ? items[0].querySelector('.cm-who').textContent : null,
               t0: items[0] ? items[0].querySelector('.cm-t').textContent : null,
               b0: items[0] ? items[0].querySelector('.cm-b').textContent : null };
    });
    const pass = ui.hasBlock && ui.n === r.local && ui.b0 === r.first[2] && ui.who0 === (r.first[1] || '匿名');
    if (pass) ok++; else bad++;
    console.log(`  ${pass ? '✔' : '✘'} ${r.name} | 原站 ${r.total} 条 / 内嵌 ${r.local} 条 | 弹窗渲染 ${ui.n} 条`);
    console.log(`      表头: ${ui.header}`);
    console.log(`      首条: [${ui.who0}] ${ui.t0} → ${ui.b0}`);
  }
  console.log(`\n抽检：${ok}/8 通过${bad ? '，' + bad + ' 个异常' : ''}`);

  // 选一个评论最多的点位截图
  const top = await p.evaluate(() => {
    let best = null, bestN = 0;
    Object.keys(COMMENTS).forEach(k => { if (COMMENTS[k][0] > bestN) { bestN = COMMENTS[k][0]; best = k; } });
    let idx = -1;
    for (let i = 0; i < CAMERAS.length; i++) if (String(CAMERAS[i][6]) === best) { idx = i; break; }
    const c = CAMERAS[idx];
    map.setZoomAndCenter(15, [c[0], c[1] + 0.0092]);
    showCameraInfo(idx);
    return { name: c[3], id: best, total: bestN, idx };
  });
  await p.waitForTimeout(4500);
  console.log(`\n截图点位：${top.name}（id ${top.id}，原站 ${top.total} 条评论）`);
  await p.screenshot({ path: 'shot_comments.png' });

  if (errs.length) console.log('\n错误:\n' + errs.slice(0, 5).join('\n'));
  await b.close();
})();
