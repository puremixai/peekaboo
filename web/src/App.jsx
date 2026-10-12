import { useCallback, useEffect, useState } from 'react'
import { getConfig, getPoints, postPlan } from './api'
import { STRATEGY_DEFAULT } from './constants'
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
