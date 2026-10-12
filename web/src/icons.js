import { TYPE_COLOR } from './constants'

// 用 canvas 生成圆形点位图标（PNG data URI）。
// 旧版是用 Python 预生成后内嵌的，现在改成运行时生成，省掉构建步骤里的图标注入。
const cache = new Map()

export function dotIcon(color, size = 14, border = '#ffffff') {
  const key = `${color}|${size}|${border}`
  const hit = cache.get(key)
  if (hit) return hit

  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')
  const r = size / 2

  g.beginPath()
  g.arc(r, r, r - 0.5, 0, Math.PI * 2)
  g.fillStyle = border
  g.fill()

  g.beginPath()
  g.arc(r, r, r - 2.2, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()

  const url = cv.toDataURL('image/png')
  cache.set(key, url)
  return url
}

/** 按类型取点位图标 */
export const typeIcon = (type) => dotIcon(TYPE_COLOR[type] || '#6b7280')

/** 避让区中心的小黄点 */
export const avoidIcon = () => dotIcon('#ffd400', 22, '#7a5c00')

/** 路线附近的点位（需要留意的） */
export const nearIcon = () => dotIcon('#ff6d00', 19, '#7a3000')
