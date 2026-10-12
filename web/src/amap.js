// 高德 JS API 2.0 加载器。
//
// 这里用的 Key 必然会出现在浏览器里，属于「Web 端(JS API)」Key，
// 只能靠高德控制台的 Referer 白名单保护；真正敏感的 Web 服务 Key 只留在服务端。
let pending = null

export function loadAMap({ jsKey, serviceHost, securityCode }) {
  if (window.AMap) return Promise.resolve(window.AMap)
  if (pending) return pending

  pending = new Promise((resolve, reject) => {
    if (!jsKey || jsKey === 'YOUR_AMAP_KEY') {
      reject(new Error('服务端未配置 AMAP_JS_KEY'))
      return
    }
    // 必须在 JS API 脚本加载之前挂到 window 上，否则设置无效。
    //
    // 优先走官方推荐的「代理服务器转发」：只暴露一个代理地址，
    // 真正的 securityJsCode 留在服务端，由代理转发时补 &jscode=xxx。
    // 明文方式（securityJsCode 直接写在这里）会让密钥在 DevTools 里一览无余，
    // 官方明确不建议生产使用，因此只在服务端没配安全密钥时才退回。
    if (serviceHost) {
      window._AMapSecurityConfig = { serviceHost }
    } else if (securityCode) {
      window._AMapSecurityConfig = { securityJsCode: securityCode }
    }
    const s = document.createElement('script')
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(jsKey)}` +
      `&plugin=AMap.Scale,AMap.ToolBar,AMap.Geolocation`
    s.async = true
    s.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('高德 SDK 加载后未暴露 AMap')))
    s.onerror = () => reject(new Error('高德 SDK 脚本加载失败（检查网络或 Key 的域名白名单）'))
    document.head.appendChild(s)
  })
  return pending
}
