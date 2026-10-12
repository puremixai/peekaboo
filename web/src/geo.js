// 客户端几何工具：与服务端 server/internal/geo 使用同一套近似算法。
// 前端只用于「最近红点距离」「弹窗自适应视口」这类轻量计算，避让规划本身在服务端。
const R_EARTH = 6371000
const D2R = Math.PI / 180

export function distPointSeg(p, a, b) {
  const lat0 = ((a[1] + b[1]) / 2) * D2R
  const kx = R_EARTH * Math.cos(lat0) * D2R
  const ky = R_EARTH * D2R
  const ax = a[0] * kx, ay = a[1] * ky
  const bx = b[0] * kx, by = b[1] * ky
  const px = p[0] * kx, py = p[1] * ky
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export const distM = (p, q) => distPointSeg(p, q, q)

export function minDistToPoly(p, poly) {
  let d = Infinity
  for (let s = 0; s + 1 < poly.length; s++) {
    const dd = distPointSeg(p, poly[s], poly[s + 1])
    if (dd < d) d = dd
  }
  return d
}

/** Web Mercator：米 → 屏幕像素 */
export const metersToPixels = (m, lat, zoom) =>
  m / ((156543.03392 * Math.cos(lat * D2R)) / Math.pow(2, zoom))

/** 屏幕像素 → 米 */
export const pixelsToMeters = (px, lat, zoom) =>
  px * ((156543.03392 * Math.cos(lat * D2R)) / Math.pow(2, zoom))

export const fmtKm = (m) => `${(m / 1000).toFixed(2)} km`

export function fmtMin(sec) {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`
}

/** 距离「今天」多少天；无法解析返回 null */
export function daysAgo(dateStr) {
  if (!dateStr) return null
  const t = new Date(String(dateStr).replace(/-/g, '/')).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}
