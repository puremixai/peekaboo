// 高德 JS API 2.0 加载器。
//
// 这里用的 Key 必然会出现在浏览器里，属于「Web 端(JS API)」Key，
// 只能靠高德控制台的 Referer 白名单保护；真正敏感的 Web 服务 Key 只留在服务端。
let pending = null

export function loadAMap({ jsKey, securityCode }) {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (pending) return pending

  pending = new Promise((resolve, reject) => {
    if (!jsKey || jsKey === 'YOUR_AMAP_KEY') {
      reject(new Error('服务端未配置 AMAP_JS_KEY'))
      return
    }
    if (securityCode) {
      // JS API 2.0 的安全密钥，必须在脚本加载前挂到 window 上
      window._AMapSecurityConfig = { securityJsCode: securityCode }
    }
    const s = document.createElement('script')
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}&plugin=AMap.Scale,AMap.ToolBar`
    s.async = true
    s.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('高德 SDK 加载后未暴露 AMap')))
    s.onerror = () => reject(new Error('高德 SDK 脚本加载失败（检查网络或 Key 的域名白名单）'))
    document.head.appendChild(s)
  })
  return pending
}
