const { chromium } = require('playwright-core');
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const FILE = process.argv[2];

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
  const errs = [];
  let pass = 0, fail = 0;

  for (const vp of [{ width: 1500, height: 900 }, { width: 1280, height: 720 }]) {
    const p = await b.newPage({ viewport: vp });
    p.on('pageerror', e => errs.push('[pageerror] ' + e.message));
    await p.goto(FILE, { waitUntil: 'load', timeout: 90000 });
    await p.waitForTimeout(8000);

    // 最坏内容：截图最多 且 评论最多
    const best = await p.evaluate(() => {
      let bi = -1, score = -1;
      for (let i = 0; i < CAMERAS.length; i++) {
        const id = String(CAMERAS[i][6]);
        const d = DETAILS[id], cm = COMMENTS[id];
        const s = (d && d !== 1 ? d[1].length * 3 : 0) + (cm ? Math.min(cm[1].length, 8) * 2 : 0);
        if (s > score) { score = s; bi = i; }
      }
      return { idx: bi, name: CAMERAS[bi][3].slice(0, 24),
               nImg: (DETAILS[String(CAMERAS[bi][6])] || [, []])[1].length,
               nCm: COMMENTS[String(CAMERAS[bi][6])] ? Math.min(COMMENTS[String(CAMERAS[bi][6])][1].length, 8) : 0 };
    });

    // dLat 让点位落在指定屏幕高度（zoom 15 下 1px ≈ 3.66m）
    for (const [label, frac] of [['居中', 0], ['靠顶部', -0.0109], ['靠底部', 0.0109]]) {
      await p.evaluate(([i, d]) => {
        const c = CAMERAS[i];
        map.setZoomAndCenter(15, [c[0], c[1] + d]);
      }, [best.idx, frac]);
      await p.waitForTimeout(4200);                    // 等动画彻底结束
      await p.evaluate((i) => showCameraInfo(i), best.idx);
      await p.waitForTimeout(4500);                    // 等图片加载

      const r = await p.evaluate(() => {
        const el = document.querySelector('.pop');
        const b = el.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height),
                 mh: el.style.maxHeight || '(css)', vh: window.innerHeight,
                 scroll: el.scrollHeight > el.clientHeight + 2 };
      });
      const ok = r.top >= 0 && r.bottom <= r.vh;
      ok ? pass++ : fail++;
      console.log(`  ${ok ? '✔' : '✘'} ${vp.width}x${vp.height} ${label}: top=${r.top} bottom=${r.bottom} h=${r.h} (视口 ${r.vh}) maxH=${r.mh} 内部滚动=${r.scroll}`);
    }
    console.log(`  —— 最坏点位「${best.name}」${best.nImg} 图 / ${best.nCm} 评论`);
    await p.screenshot({ path: `shot_fit_${vp.width}x${vp.height}.png` });
    await p.close();
  }

  console.log(`\n弹窗自适应：${pass} 通过 / ${fail} 失败`);
  if (errs.length) console.log('错误:\n' + errs.slice(0, 5).join('\n'));
  await b.close();
})();
