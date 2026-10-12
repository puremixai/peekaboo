// 业务常量。类型文字说明以原站「关于本站」图例为准：
// 5 / 4 / 6 是原站给出的，1 和 2 原站未定义文字，这里按语义补上。
export const TYPE_NAME = {
  1: '其他点位',
  2: '主要抓拍点位',
  3: '仅拍摄早晚高峰',
  4: '已停拍或个例',
  5: '拍未办六环内进京证 + 违反早晚高峰',
  6: '办理六环外进京证即可通行的区域',
}

export const TYPE_COLOR = {
  1: '#1e88e5',
  2: '#e53935',
  4: '#fb8c00',
  5: '#43a047',
  6: '#8e24aa',
}

export const RED_TYPE = '2'

// 原站资源
export const SITE = 'https://www.jinjing365.com'
export const IMG_PREFIX = '/upload/image/' // 详情页图片路径前缀

// 高德驾车策略（v5）
export const STRATEGIES = [
  { value: 32, label: '高德推荐（默认）' },
  { value: 33, label: '躲避拥堵' },
  { value: 34, label: '高速优先' },
  { value: 35, label: '不走高速' },
  { value: 36, label: '少收费' },
  { value: 0, label: '速度最快' },
]

export const STRATEGY_DEFAULT = 32
