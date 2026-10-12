// 定位功能端到端测试
//
// 覆盖两种触发方式：
//   A. 启动自动定位（默认定位当前位置）—— 打开页面即自动把当前位置设为起点
//   B. 手动点「定位」按钮
// 以及失败路径（非安全上下文）。
//
// 关键点：Playwright 必须在 newContext 时同时给 geolocation 权限和模拟坐标，
// browser.newPage() 用的是默认上下文，没有权限，会直接拿到 permission denied。
const { chromium } = require('playwright-core')
const EXE = 'C:/Users/ausu/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'
const URL = 'http://127.0.0.1:8080/'

// 模拟坐标：北京国贸附近，落在测试走廊范围内，方便肉眼核对
const MOCK = { latitude: 39.9088, longitude: 116.4612, accuracy: 35 }
const LOCATE_TITLE = '用浏览器定位到的当前位置作为起点'

const ok = (s) => console.log('  ✔ ' + s)
const bad = (s) => console.log('  ✘ ' + s)
let failed = 0
const assert = (cond, msg) => (cond ? ok(msg) : (failed++, bad(msg)))

const statusText = (p) => p.locator('.status').last().innerText().then((t) => t.replace(/\s+/g, ' ').trim())
const statusClass = (p) => p.locator('.status').last().getAttribute('class')

/** 统计 navigator.geolocation 被调用的次数，用于验证「自动定位只跑一次」 */
const GEO_COUNTER = () => {
  window.__geoCalls = 0
  const wrap = (name) => {
    const orig = navigator.geolocation && navigator.geolocation[name]
    if (!orig) return
    navigator.geolocation[name] = function (...a) {
      window.__geoCalls++
      return orig.apply(this, a)
    }
  }
  wrap('getCurrentPosition')
  wrap('watchPosition')
}

const waitStatus = (p, re, timeout = 30000) =>
  p.waitForFunction(
    (src) => new RegExp(src).test(Array.from(document.querySelectorAll('.status')).map((e) => e.innerText).join(' ')),
    re.source,
    { timeout },
  )

;(async () => {
  const b = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  })

  // ============ A. 自动定位 ============
  console.log('\n[A] 启动自动定位（默认定位当前位置）')
  const ctx = await b.newContext({
    viewport: { width: 1500, height: 950 },
    geolocation: MOCK,
    permissions: ['geolocation'],
  })
  await ctx.addInitScript(GEO_COUNTER)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160))
  })

  await p.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await p.waitForFunction(() => window.__navMap && window.AMap, null, { timeout: 45000 })

  const secure = await p.evaluate(() => window.isSecureContext)
  assert(secure === true, `页面是安全上下文（isSecureContext=${secure}）—— 定位的前置条件`)

  // 没有点任何按钮，等待自动定位自己完成
  await waitStatus(p, /已自动定位|未能自动定位/)
  await p.waitForTimeout(1000)
  const autoTxt = await statusText(p)
  console.log('  状态:', autoTxt)
  assert(/已自动定位并设为起点/.test(autoTxt), '未点按钮即自动完成定位')

  const startCur = (await p.locator('.addr-cur').first().innerText()).replace(/\s+/g, ' ').trim()
  const endCur = (await p.locator('.addr-cur').nth(1).innerText()).replace(/\s+/g, ' ').trim()
  console.log('  起点:', startCur)
  console.log('  终点:', endCur)
  assert(startCur !== '未设置', '起点已自动写入当前位置')
  assert(endCur === '未设置', '终点未被定位污染（仍为「未设置」）')

  const view = await p.evaluate(() => {
    const m = window.__navMap
    const c = m.getCenter()
    return { lng: c.getLng(), lat: c.getLat(), zoom: m.getZoom() }
  })
  console.log('  地图中心:', JSON.stringify(view))
  const dLng = Math.abs(view.lng - MOCK.longitude)
  const dLat = Math.abs(view.lat - MOCK.latitude)
  assert(dLng < 0.02 && dLat < 0.02, `地图已居中到定位点（偏差 ${dLng.toFixed(4)}, ${dLat.toFixed(4)}）`)
  assert(Math.abs(view.zoom - 15) < 0.5, `缩放级别为 15（实际 ${view.zoom}）`)

  await p.screenshot({ path: 'shot_locate_auto.png' })

  // 自动定位只跑一次：做几个会引发重渲染的操作，再看调用次数
  console.log('\n[B] 自动定位只跑一次')
  const before = await p.evaluate(() => window.__geoCalls)
  await p.getByRole('checkbox').first().click() // 切换某个图层开关，触发重渲染
  await p.waitForTimeout(1200)
  await p.getByRole('checkbox').first().click()
  await p.waitForTimeout(1500)
  const after = await p.evaluate(() => window.__geoCalls)
  console.log(`  navigator.geolocation 调用次数: 自动定位后 ${before} → 多次重渲染后 ${after}`)
  assert(before === 1 && after === 1, '自动定位只触发一次（重渲染不会重复定位）')
  assert(/已自动定位/.test(await statusText(p)), '重渲染后状态栏未被重复的定位文案覆盖')

  // ============ C. 手动定位仍可用 ============
  console.log('\n[C] 手动点「定位」')
  const btn = p.getByTitle(LOCATE_TITLE)
  assert((await btn.count()) === 1, '「定位」按钮只出现在起点输入框（共 1 个）')
  await btn.click()
  await waitStatus(p, /已定位并设为起点/)
  await p.waitForTimeout(600)
  const manualTxt = await statusText(p)
  console.log('  状态:', manualTxt)
  assert(/^已定位并设为起点/.test(manualTxt), '手动定位文案与自动定位区分（不带「自动」）')

  if (errs.length) console.log('\n错误:\n' + errs.slice(0, 6).join('\n'))
  else console.log('\n无 JS 错误 ✔')

  // ============ D. 失败路径：非安全上下文 ============
  // 用 init script 把 window.isSecureContext 改成 false，模拟线上没上 HTTPS 的情形。
  // 必须用 defineProperty —— isSecureContext 是只读的，直接赋值无效。
  console.log('\n[D] 失败路径：非安全上下文（模拟未启用 HTTPS）')
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

  await waitStatus(p2, /未能自动定位/, 20000)
  await p2.waitForTimeout(500)
  const autoErrTxt = await statusText(p2)
  const autoErrCls = await statusClass(p2)
  console.log('  自动定位状态:', autoErrTxt)
  console.log('  状态样式类:', autoErrCls)
  assert(/HTTPS/.test(autoErrTxt), '自动定位失败提示明确提到 HTTPS')
  assert(!/\berr\b/.test(autoErrCls), '自动定位失败用软提示（非红色错误）')
  const start2 = (await p2.locator('.addr-cur').first().innerText()).trim()
  assert(start2 === '未设置', '自动定位失败时起点保持「未设置」（不写脏数据）')

  // 手动点：应升级为明确的错误提示
  await p2.getByTitle(LOCATE_TITLE).click()
  await waitStatus(p2, /定位失败/, 20000)
  await p2.waitForTimeout(400)
  const manualErrTxt = await statusText(p2)
  const manualErrCls = await statusClass(p2)
  console.log('  手动定位状态:', manualErrTxt)
  assert(/HTTPS/.test(manualErrTxt), '手动定位失败提示明确提到 HTTPS')
  assert(/\berr\b/.test(manualErrCls), '手动定位失败用红色错误样式')

  console.log(failed === 0 ? '\n===== 全部通过 =====' : `\n===== ${failed} 项失败 =====`)
  await b.close()
  process.exit(failed === 0 ? 0 : 1)
})()
