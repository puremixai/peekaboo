import { useCallback, useEffect, useRef, useState } from 'react'
import { getConfig, getPoints, postPlan } from './api'
import { STRATEGY_DEFAULT } from './constants'
import { locateCurrentPosition } from './locate'
import Lightbox from './components/Lightbox.jsx'
import MapView from './components/MapView.jsx'
import Sidebar from './components/Sidebar.jsx'

export default function App() {
  const [config, setConfig] = useState(null)
  const [points, setPoints] = useState([])
  const [bootErr, setBootErr] = useState('')

  const [start, setStart] = useState(null) // { pt:[lng,lat], name }
  const [end, setEnd] = useState(null)
  const [pickMode, setPickMode] = useState(null) // 'start' | 'end' | null
  const [radius, setRadius] = useState(100)
  const [targetAll, setTargetAll] = useState(false)
  const [strategy, setStrategy] = useState(STRATEGY_DEFAULT)

  const [plan, setPlan] = useState(null)
  const [selPlan, setSelPlan] = useState(-1)
  const [planning, setPlanning] = useState(false)
  const [status, setStatus] = useState(null) // { type:'ok'|'err'|'info', text }

  const [show, setShow] = useState({ points: true, corridor: true, near: true, areas: true, fit: true })
  const [lightbox, setLightbox] = useState(null) // { items, idx }
  const [locating, setLocating] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const mapRef = useRef(null) // 地图实例，供定位后移动视野用

  // 定位相关的守卫一律用 ref，不用 state：
  // state 进 useCallback 依赖会让回调身份变化，自动定位的 useEffect 就会被反复触发。
  const locatingRef = useRef(false)
  const autoTriedRef = useRef(false) // 自动定位只尝试一次
  const startRef = useRef(null)
  startRef.current = start

  /* ---------- 启动：并行拉配置与点位 ---------- */
  useEffect(() => {
    let alive = true
    Promise.all([getConfig(), getPoints()])
      .then(([cfg, pts]) => {
        if (!alive) return
        setConfig(cfg)
        setPoints(pts.points || [])
        if (cfg.defaultRadius) setRadius(cfg.defaultRadius)
        if (!cfg.jsKey) {
          setBootErr('服务端未配置 AMAP_JS_KEY，地图无法加载。请在 .env 中设置后重启服务。')
        }
      })
      .catch((e) => alive && setBootErr(e.message))
    return () => {
      alive = false
    }
  }, [])

  const setPoint = useCallback((kind, pt, name) => {
    const v = { pt, name }
    if (kind === 'start') setStart(v)
    else setEnd(v)
    setPickMode(null)
  }, [])

  const onPick = useCallback((kind, pt) => {
    setPoint(kind, pt, `${pt[0].toFixed(6)}, ${pt[1].toFixed(6)}`)
  }, [setPoint])

  /* ---------- 浏览器定位：把当前位置设为起点 ----------
     auto=true 用于启动时的自动定位：文案更轻，失败只给提示不报错，
     以免在未启用 HTTPS 的部署上每次打开都弹一条红色错误。 */
  const locateMe = useCallback(
    async ({ auto = false } = {}) => {
      if (locatingRef.current) return
      locatingRef.current = true
      setLocating(true)
      setStatus({ type: 'info', text: auto ? '正在定位当前位置…' : '正在定位…' })
      try {
        const r = await locateCurrentPosition()
        const name = r.address || `我的位置（${r.lng.toFixed(6)}, ${r.lat.toFixed(6)}）`
        setPoint('start', [r.lng, r.lat], name)
        // 立即平移，不要动画——否则用户会看到地图慢慢飘过去
        if (mapRef.current) mapRef.current.setZoomAndCenter(15, [r.lng, r.lat], true)
        const acc = r.accuracy ? `，精度约 ${Math.round(r.accuracy)} 米` : ''
        const via = r.locationType === 'ip' ? '（IP 定位）' : ''
        setStatus({
          type: 'ok',
          text: `${auto ? '已自动定位' : '已定位'}并设为起点：${name}${via}${acc}`,
        })
      } catch (e) {
        if (auto) {
          setStatus({
            type: 'info',
            text: `未能自动定位（${e.message}）—— 可点起点右侧「定位」重试，或直接输入地址`,
          })
        } else {
          setStatus({ type: 'err', text: '定位失败：' + e.message })
        }
      } finally {
        locatingRef.current = false
        setLocating(false)
      }
    },
    [setPoint],
  )

  /* ---------- 启动时自动定位当前位置（只跑一次） ----------
     必须等 mapReady：地图 complete 之前调 setZoomAndCenter 会被丢弃。
     若用户抢先设了起点，则放弃自动定位，不覆盖用户输入。 */
  useEffect(() => {
    if (!config || !mapReady || autoTriedRef.current) return
    autoTriedRef.current = true
    if (startRef.current) return
    locateMe({ auto: true })
  }, [config, mapReady, locateMe])

  /* ---------- 规划 ---------- */
  const onPlan = useCallback(async () => {
    if (!start || !end) {
      setStatus({ type: 'err', text: '请先设置起点和终点' })
      return
    }
    setPlanning(true)
    setStatus(null)
    setPlan(null)
    setSelPlan(-1)
    try {
      const res = await postPlan({
        start: start.pt,
        end: end.pt,
        radius,
        targetAll,
        strategy,
      })
      setPlan(res)
      // 默认选中红点最少的方案（用户的目标就是红点清零）
      let best = 0
      res.plans.forEach((p, i) => {
        if (p.red < res.plans[best].red || (p.red === res.plans[best].red && p.dist < res.plans[best].dist)) best = i
      })
      setSelPlan(best)
      if (res.warning) setStatus({ type: 'err', text: res.warning })
      else if (res.plans[best]?.red === 0)
        setStatus({ type: 'ok', text: `已找到红点清零的方案：${(res.plans[best].dist / 1000).toFixed(2)} km` })
      else setStatus({ type: 'info', text: '没有方案能把红点清零，可尝试加大半径或换策略' })
    } catch (e) {
      setStatus({ type: 'err', text: e.message })
    } finally {
      setPlanning(false)
    }
  }, [start, end, radius, targetAll, strategy])

  const onClear = useCallback(() => {
    setPlan(null)
    setSelPlan(-1)
    setStart(null)
    setEnd(null)
    setStatus(null)
  }, [])

  const openLightbox = useCallback((items, idx) => setLightbox({ items, idx }), [])
  const stepLightbox = useCallback(
    (d) =>
      setLightbox((cur) => {
        if (!cur) return cur
        const n = cur.items.length
        return { ...cur, idx: (cur.idx + d + n) % n }
      }),
    [],
  )

  if (bootErr) {
    return (
      <div className="boot-err">
        <h2>启动失败</h2>
        <p>{bootErr}</p>
        <p className="hint">检查后端是否已启动、AMAP_JS_KEY 是否配置。</p>
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        config={config}
        points={points}
        start={start}
        end={end}
        setPoint={setPoint}
        onLocate={locateMe}
        locating={locating}
        pickMode={pickMode}
        setPickMode={setPickMode}
        radius={radius}
        setRadius={setRadius}
        targetAll={targetAll}
        setTargetAll={setTargetAll}
        strategy={strategy}
        setStrategy={setStrategy}
        planning={planning}
        onPlan={onPlan}
        onClear={onClear}
        plan={plan}
        selPlan={selPlan}
        setSelPlan={setSelPlan}
        show={show}
        setShow={setShow}
        status={status}
      />
      <MapView
        config={config}
        points={points}
        plan={plan}
        selPlan={selPlan}
        radius={radius}
        start={start}
        end={end}
        pickMode={pickMode}
        show={show}
        onPick={onPick}
        onOpenLightbox={openLightbox}
        onStatus={setStatus}
        // 把地图实例挂到 window，方便在浏览器控制台调试，也供端到端测试定位坐标
        onReady={(m) => {
          window.__navMap = m
          mapRef.current = m
          setMapReady(true)
        }}
      />
      {lightbox && (
        <Lightbox
          items={lightbox.items}
          idx={lightbox.idx}
          onClose={() => setLightbox(null)}
          onStep={stepLightbox}
        />
      )}
      {!config && !bootErr && <div className="booting">正在加载配置与点位数据…</div>}
    </div>
  )
}
