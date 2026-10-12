const { chromium } = require('playwright-core')
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8080/'

const S = [116.360827, 40.07954]
const E = [116.399771, 40.15895]

async function clickMapAt(page, lng, lat) {
  const p = await page.evaluate(
    ([lo, la]) => {
      const m = window.__navMap
      const pt = m.lngLatToContainer(new window.AMap.LngLat(lo, la))
      const box = m.getContainer().getBoundingClientRect()
      return { x: box.left + pt.getX(), y: box.top + pt.getY() }
    },
    [lng, lat],
  )
  await page.mouse.click(p.x, p.y)
}

/**
 * 把地图强制移到指定位置。
 *
 * 坑：方案渲染时会调 setFitView（动画），动画期间发出的 setZoomAndCenter 会被丢弃。
 * 所以这里循环「设一次 → 校验 → 没到位就再来一次」，直到真正到位。
 */
async function ensureView(page, lng, lat, zoom = 15) {
  for (let i = 0; i < 12; i++) {
    await page.evaluate(
      ([lo, la, z]) => window.__navMap.setZoomAndCenter(z, [lo, la], true),
      [lng, lat, zoom],
    )
    await page.waitForTimeout(600)
    const ok = await page.evaluate(
      ([lo, la, z]) => {
        const m = window.__navMap
        const c = m.getCenter()
        return (
          Math.abs(c.getLng() - lo) < 1e-5 &&
          Math.abs(c.getLat() - la) < 1e-5 &&
          Math.abs(m.getZoom() - z) < 0.01
        )
      },
      [lng, lat, zoom],
    )
    if (ok) return true
  }
  return false
}

;(async () => {
  const b = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  })
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
  const errs = []
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160))
  })

  await p.goto(URL, { waitUntil: 'load', timeout: 60000 })

  // 1. 启动与点位加载
  await p.waitForFunction(() => window.__navMap && window.AMap, null, { timeout: 45000 })
  await p.waitForTimeout(3000)
  const head = await p.locator('.side-head p').innerText()
  console.log('侧栏:', head.replace(/\s+/g, ' ').slice(0, 110))

  const mapInfo = await p.evaluate(() => {
    const m = window.__navMap
    const box = m.getContainer().getBoundingClientRect()
    return { zoom: m.getZoom(), w: Math.round(box.width), h: Math.round(box.height) }
  })
  console.log('地图:', JSON.stringify(mapInfo))

  // 2. 地图选点：起点 / 终点
  await p.getByTitle('在地图上选点').first().click()
  await clickMapAt(p, S[0], S[1])
  await p.waitForTimeout(400)
  await p.getByTitle('在地图上选点').nth(1).click()
  await clickMapAt(p, E[0], E[1])
  await p.waitForTimeout(600)
  const cur = await p.locator('.addr-cur').allInnerTexts()
  console.log('起终点:', cur.join('  |  '))

  // 3. 生成方案
  await p.getByRole('button', { name: /生成避让方案/ }).click()
  await p.waitForSelector('.plan', { timeout: 180000 })
  await p.waitForTimeout(3500)

  const plans = await p.evaluate(() =>
    Array.from(document.querySelectorAll('.plan')).map((el) => ({
      on: el.classList.contains('on'),
      label: el.querySelector('.plan-t b').textContent.trim(),
      km: el.querySelector('.plan-t em').textContent.trim(),
      meta: el.querySelector('.plan-m').innerText.replace(/\s+/g, ' ').trim(),
    })),
  )
  console.log('\n方案:')
  plans.forEach((x, i) => console.log(`  ${x.on ? '▶' : ' '} ${i}. ${x.label}  ${x.km}  [${x.meta}]`))

  const badge = await p.locator('.map-badge').innerText()
  console.log('\n地图角标:', badge.replace(/\s+/g, ' '))
  const statusTxt = await p.locator('.status').last().innerText().catch(() => '')
  console.log('状态:', statusTxt.replace(/\s+/g, ' '))

  // 4. 点位弹窗（点地图上任意点位）
  // 注意：setZoomAndCenter 默认是动画的，时长随距离变化（跨城区可能要 5~6 秒），
  // 必须传 immediately=true 才能立即到位，否则算出的屏幕坐标是动画中间态。
  const okView = await ensureView(p, 116.623378, 39.80323, 15)
  console.log('地图定位到位:', okView)
  const mapState = await p.evaluate(() => {
    const m = window.__navMap
    const box = m.getContainer().getBoundingClientRect()
    const pt = m.lngLatToContainer(new window.AMap.LngLat(116.623378, 39.80323))
    return {
      center: m.getCenter().toString(),
      zoom: m.getZoom(),
      container: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)],
      target: [Math.round(pt.getX()), Math.round(pt.getY())],
    }
  })
  console.log('点击前地图状态:', JSON.stringify(mapState))
  await clickMapAt(p, 116.623378, 39.80323)
  await p.waitForSelector('.popup', { timeout: 20000 })
  await p.waitForTimeout(3500)
  const pop = await p.evaluate(() => {
    const el = document.querySelector('.popup')
    const b = el.getBoundingClientRect()
    const img = el.querySelector('.popup-img')
    return {
      cls: el.className,
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      vh: window.innerHeight,
      name: el.querySelector('.popup-name')?.textContent,
      nImg: el.querySelectorAll('.popup-img').length,
      imgLoaded: img ? img.naturalWidth : 0,
      nCm: el.querySelectorAll('.cm').length,
      cmHead: el.querySelector('.popup-cm-h')?.innerText.replace(/\s+/g, ' '),
      firstCm: el.querySelector('.cm-b')?.textContent,
    }
  })
  console.log('\n弹窗:')
  console.log('  名称:', pop.name)
  console.log('  截图:', pop.nImg, '张，首图已加载', pop.imgLoaded)
  console.log('  评论:', pop.cmHead, '| 渲染', pop.nCm, '条')
  console.log('  首条评论:', pop.firstCm)
  console.log(`  位置: ${pop.cls} top=${pop.top} bottom=${pop.bottom} (视口 ${pop.vh})`)

  await p.screenshot({ path: 'shot_go_popup.png' })

  // 页面不应再出现数据来源相关文案（已按需求从 UI 移除）。
  // 注意：jinjing365.com 这个域名本身必须保留——详情页链接与违章截图都靠它拼绝对地址。
  // 同理，body 文本里可能出现「进京证」等字样（来自车主评论原文），那是用户内容，
  // 不能作为判定依据；这里只查我们自己的文案：整页的来源词 + 侧栏头部 + 图层开关。
  const pageText = await p.evaluate(() => document.body.innerText)
  const leaked = ['数据来源', '进京网', '原站', '关于本站'].filter((s) => pageText.includes(s))
  if (leaked.length) {
    errs.push('[页面残留来源文案] ' + leaked.join(', '))
    console.log('\n页面残留来源文案 ✘ :', leaked.join(', '))
  } else {
    console.log('\n页面无数据来源文案 ✔')
  }

  // 项目自我描述里不应再出现显式业务名（侧栏头部 + 显示选项 + 类型图例）
  const selfDesc = await p.evaluate(() => {
    const pick = (sel) =>
      Array.from(document.querySelectorAll(sel))
        .map((e) => e.innerText)
        .join(' ')
    return pick('.side-head') + ' ' + pick('label.check') + ' ' + pick('ul.legend')
  })
  const named = ['进京证', '摄像头'].filter((s) => selfDesc.includes(s))
  if (named.length) {
    errs.push('[侧栏文案残留业务名] ' + named.join(', '))
    console.log('侧栏文案残留业务名 ✘ :', named.join(', '))
  } else {
    console.log('侧栏文案无显式业务名 ✔')
  }

  if (errs.length) {
    console.log('\n错误:\n' + errs.slice(0, 6).join('\n'))
    process.exitCode = 1
  } else console.log('\n无 JS 错误 ✔')
  await b.close()
})()
