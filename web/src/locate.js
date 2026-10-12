// 浏览器定位：封装高德 AMap.Geolocation 插件。
//
// 两个必须知道的限制（官方文档写明）：
//  1. 移动端（iOS 10+ / 部分 Android）禁止在非 HTTPS 下定位。本机开发用 localhost 没问题
//     —— 浏览器把 localhost 当作安全上下文；但部署到线上必须上 HTTPS。
//  2. PC 上没有 GPS 芯片，走的是高德 IP 定位，官方给的失败率约 5%。
//
// 高德这套接口内部融合了 HTML5 Geolocation、精确 IP 定位和安卓定位 SDK，
// 比直接调 navigator.geolocation 成功率更高，所以走它而不是原生 API。

// 高德返回的失败信息大多是英文，这里映射成人话
const ERR_TEXT = {
  'Geolocation permission denied.': '浏览器拒绝了定位权限 —— 请点地址栏左侧的权限图标允许定位',
  'Browser not Support html5 geolocation': '当前浏览器不支持 HTML5 定位',
  'Geolocation timeout.': '定位超时，可以再试一次',
  'IP_LOCATE_FAILED': 'IP 定位失败（PC 上定位走 IP，官方失败率约 5%）',
  'BROWSER_LOCATE_FAILED': '浏览器定位失败，可能是系统定位服务未开启',
}

function friendly(result) {
  const raw = (result && (result.message || result.info)) || ''
  for (const k of Object.keys(ERR_TEXT)) {
    if (raw.includes(k)) return ERR_TEXT[k]
  }
  return raw || '定位失败（未知原因）'
}

/**
 * 定位当前位置。
 * @returns {Promise<{lng:number, lat:number, accuracy:number, address:string}>}
 */
export function locateCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error(
        '当前页面不是 HTTPS，浏览器会直接拒绝定位。' +
        '本机开发请用 http://localhost 访问；线上部署必须启用 HTTPS。'))
      return
    }
    if (!navigator.geolocation) {
      reject(new Error('当前浏览器不支持定位（navigator.geolocation 不存在）'))
      return
    }
    if (!window.AMap) {
      reject(new Error('地图 SDK 还没加载完，稍后再试'))
      return
    }

    window.AMap.plugin('AMap.Geolocation', () => {
      const geo = new window.AMap.Geolocation({
        enableHighAccuracy: true, // 优先高精度（浏览器 GPS/WiFi 定位）
        timeout: 10000,           // 10 秒超时；默认是无穷大，会一直转
        GeoLocationFirst: true,   // 先试浏览器精确定位，失败再退回 IP 定位
        noIpLocate: 0,            // 允许 IP 定位兜底
        showButton: false,        // 不用插件自带的按钮，UI 由我们自己控制
        showMarker: false,
        showCircle: false,
      })

      geo.getCurrentPosition(
        (status, result) => {
          if (status !== 'complete') {
            reject(new Error(friendly(result)))
            return
          }
          const pos = result.position
          resolve({
            lng: pos.getLng(),
            lat: pos.getLat(),
            accuracy: Number(result.accuracy) || 0,
            // 逆地理结果；IP 定位时可能为空
            address: result.formattedAddress || '',
            locationType: result.location_type || '',
          })
        },
        // 某些版本会走第二个回调，这里也兜住
        (result) => reject(new Error(friendly(result))),
      )
    })
  })
}
