// 所有接口都用相对路径，生产环境前后端同源；开发环境由 Vite 代理到 Go 服务。
const BASE = '/api'

async function request(path, opts) {
  const res = await fetch(BASE + path, opts)
  let data = {}
  try {
    data = await res.json()
  } catch {
    /* 非 JSON 响应（例如 502 网关页） */
  }
  if (!res.ok) {
    throw new Error(data.error || `请求失败（HTTP ${res.status}）`)
  }
  return data
}

export const getConfig = () => request('/config')

export const getPoints = () => request('/points')

export const getPointDetail = (id) => request(`/points/${id}`)

export const getTips = (kw, signal) =>
  request(`/tips?kw=${encodeURIComponent(kw)}`, { signal })

export const postPlan = (body, signal) =>
  request('/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
