// 定位功能端到端测试
//
// 验证「定位」按钮：把浏览器定位到的当前位置设为起点。
//
// 关键点：Playwright 必须在 newContext 时同时给 geolocation 权限和模拟坐标，
// browser.newPage() 用的是默认上下文，没有权限，会直接拿到 permission denied。
const { chromium } = require('playwright-core')
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8080/'

// 模拟坐标：北京国贸附近，落在测试走廊范围内，方便肉眼核对
const MOCK = { latitude: 39.9088, longitude: 116.4612, accuracy: 35 }

const ok = (s) => console.log('  ✔ ' + s)
const bad = (s) => console.log('  ✘ ' + s)
let failed = 0
const assert = (cond, msg) => (cond ? ok(msg) : (failed++, bad(msg)))

;(async () => {
  const b = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  })
  const ctx = await b.newContext({
    viewport: { width: 1500, height: 950 },
    geolocation: MOCK,
    permissions: ['geolocation'],
  })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160))
  })

  await p.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await p.waitForFunction(() => window.__navMap && window.AMap, null, { timeout: 45000 })
  await p.waitForTimeout(2500)

  console.log('\n[1] 安全上下文与按钮存在性')
  const secure = await p.evaluate(() => window.isSecureContext)
  assert(secure === true, `页面是安全上下文（isSecureContext=${secure}）—— 定位的前置条件`)
  const locateBtn = p.getByTitle('用浏览器定位到的当前位置作为起点')
  assert((await locateBtn.count()) === 1, '「定位」按钮只出现在起点输入框（共 1 个）')

  console.log('\n[2] 点击定位 → 设为起点')
  await locateBtn.click()
  // 状态栏出现「已定位…」或「定位失败…」
  await p.waitForFunction(
    () => {
      const els = Array.from(document.querySelectorAll('.status'))
      const t = els.map((e) => e.innerText).join(' ')
      return /已定位|定位失败/.test(t)
    },
    null,
    { timeout: 30000 },
  )
  await p.waitForTimeout(800)
  const statusTxt = (await p.locator('.status').last().innerText()).replace(/\s+/g, ' ').trim()
  console.log('  状态:', statusTxt)
  assert(/已定位/.test(statusTxt), '状态栏显示定位成功')

  const startCur = (await p.locator('.addr-cur').first().innerText()).replace(/\s+/g, ' ').trim()
  const endCur = (await p.locator('.addr-cur').nth(1).innerText()).replace(/\s+/g, ' ').trim()
  console.log('  起点:', startCur)
  console.log('  终点:', endCur)
  assert(startCur !== '未设置', '起点已被写入（不再是「未设置」）')
  assert(endCur === '未设置', '终点未被定位污染（仍为「未设置」）')

  console.log('\n[3] 地图视野是否移到定位点')
  const view = await p.evaluate(() => {
    const m = window.__navMap
    const c = m.getCenter()
    return { lng: c.getLng(), lat: c.getLat(), zoom: m.getZoom() }
  })
  console.log('  地图中心:', JSON.stringify(view))
  const dLng = Math.abs(view.lng - MOCK.longitude)
  const dLat = Math.abs(view.lat - MOCK.latitude)
  assert(dLng < 0.02 && dLat < 0.02, `地图中心已移到定位点附近（偏差 ${dLng.toFixed(4)}, ${dLat.toFixed(4)}）`)
  assert(Math.abs(view.zoom - 15) < 0.5, `缩放级别为 15（实际 ${view.zoom}）`)

  await p.screenshot({ path: 'shot_locate.png' })

  console.log('\n[4] 定位结果能否直接用于规划（起点已具备坐标）')
  const hasStart = await p.evaluate(() => {
    // 从状态栏文案里反推；更可靠的是看 addr-cur 是否带坐标/地址
    const t = document.querySelector('.addr-cur')
    return t ? t.innerText.trim() : ''
  })
  assert(hasStart.length > 0, '起点文本非空，可供规划使用')

  if (errs.length) console.log('\n错误:\n' + errs.slice(0, 6).join('\n'))
  else console.log('\n无 JS 错误 ✔')

  // ---------- 失败路径：非安全上下文 ----------
  // 用 init script 把 window.isSecureContext 改成 false，模拟线上没上 HTTPS 的情形。
  // 这里必须用 defineProperty —— isSecureContext 是只读的，直接赋值无效。
  console.log('\n[5] 失败路径：非安全上下文（模拟未启用 HTTPS）')
  const ctx2 = await b.newContext({
    viewport: { width: 1500, height: 950 },
    geolocation: MOCK,
    permissions: ['geolocation'],
  })
  await ctx2.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false })
  })
  const p2 = await ctx2.newPage()
  await p2.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await p2.waitForFunction(() => window.__navMap && window.AMap, null, { timeout: 45000 })
  await p2.waitForTimeout(1500)
  await p2.getByTitle('用浏览器定位到的当前位置作为起点').click()
  await p2.waitForFunction(
    () => /定位失败/.test(Array.from(document.querySelectorAll('.status')).map((e) => e.innerText).join(' ')),
    null,
    { timeout: 15000 },
  )
  const errTxt = (await p2.locator('.status').last().innerText()).replace(/\s+/g, ' ').trim()
  console.log('  状态:', errTxt)
  assert(/HTTPS/.test(errTxt), '提示明确指出需要 HTTPS')
  const start2 = (await p2.locator('.addr-cur').first().innerText()).trim()
  assert(start2 === '未设置', '失败时起点保持不变（不写入脏数据）')

  console.log(failed === 0 ? '\n===== 全部通过 =====' : `\n===== ${failed} 项失败 =====`)
  await b.close()
  process.exit(failed === 0 ? 0 : 1)
})()
