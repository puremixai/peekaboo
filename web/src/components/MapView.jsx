import { useCallback, useEffect, useRef, useState } from 'react'
import { loadAMap } from '../amap'
import { metersToPixels, pixelsToMeters } from '../geo'
import { nearIcon, typeIcon } from '../icons'
import PointPopup from './PointPopup'

const MARKER_SIZE = 11
const POPUP_GAP = 14 // 弹窗与点位的间距（px）
const POPUP_PAD = 10 // 弹窗与地图边缘的最小留白

export default function MapView({
  config,
  points,
  plan,
  selPlan,
  radius,
  start,
  end,
  pickMode,
  show,
  onPick,
  onOpenLightbox,
  onReady,
  onStatus,
}) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const overlayRef = useRef(null)
  const endpRef = useRef({ s: null, e: null })
  const clickRef = useRef(null) // 始终指向最新回调，避免重复绑定事件
  const pointsRef = useRef(points)
  pointsRef.current = points

  const [ready, setReady] = useState(false)
  const [popup, setPopup] = useState(null) // { idx, x, y }

  /** 把经纬度换算成地图容器内的像素坐标 */
  const anchorOf = useCallback((idx) => {
    const map = mapRef.current
    const p = pointsRef.current[idx]
    if (!map || !p || !window.AMap) return { x: 0, y: 0 }
    const pt = map.lngLatToContainer(new window.AMap.LngLat(p.lng, p.lat))
    return { x: pt.getX(), y: pt.getY() }
  }, [])

  const openPoint = useCallback(
    (idx) => setPopup({ idx, ...anchorOf(idx) }),
    [anchorOf],
  )

  /* ---------- 1. 初始化地图（只建一次） ---------- */
  useEffect(() => {
    if (!config || !boxRef.current) return
    let cancelled = false

    loadAMap(config)
      .then((AMap) => {
        if (cancelled || !boxRef.current) return
        const map = new AMap.Map(boxRef.current, {
          zoom: config.zoom || 11,
          center: config.center || [116.397045, 39.909729],
          viewMode: '2D',
          zooms: [8, 19],
        })
        mapRef.current = map

        map.on('complete', () => {
          if (cancelled) return
          setReady(true)
          onReady && onReady(map)
        })
        AMap.plugin(['AMap.Scale', 'AMap.ToolBar'], () => {
          map.addControl(new AMap.Scale())
          map.addControl(new AMap.ToolBar({ position: 'RB' }))
        })
        map.on('click', (e) => {
          if (clickRef.current) clickRef.current([e.lnglat.getLng(), e.lnglat.getLat()])
        })
        // 地图一动就重算锚点，弹窗才会始终贴在点位上
        const reposition = () =>
          setPopup((cur) => (cur ? { idx: cur.idx, ...anchorOf(cur.idx) } : cur))
        map.on('moving', reposition)
        map.on('zoomchange', reposition)
        map.on('moveend', reposition)
      })
      .catch((err) => onStatus && onStatus({ type: 'err', text: err.message }))

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.destroy()
        mapRef.current = null
      }
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, anchorOf])

  /* ---------- 2. 渲染全部点位 ---------- */
  useEffect(() => {
    const map = mapRef.current
    const AMap = window.AMap
    if (!ready || !map || !AMap || !points.length) return

    const layer = new AMap.LabelsLayer({ zooms: [9, 20], zIndex: 100, collision: false, animation: false })
    const markers = new Array(points.length)
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const m = new AMap.LabelMarker({
        position: [p.lng, p.lat],
        zIndex: 100,
        clickable: true,
        icon: { type: 'image', image: typeIcon(p.t), size: [MARKER_SIZE, MARKER_SIZE], anchor: 'center' },
      })
      m.on('click', () => openPoint(i))
      markers[i] = m
    }
    layer.add(markers)
    map.add(layer)

    return () => {
      map.remove(layer)
    }
  }, [ready, points, openPoint])

  /* ---------- 3. 起终点标记 ---------- */
  useEffect(() => {
    const map = mapRef.current
    const AMap = window.AMap
    if (!ready || !map || !AMap) return
    const { s, e } = endpRef.current
    if (s) map.remove(s)
    if (e) map.remove(e)
    endpRef.current = { s: null, e: null }

    const make = (pt, color, label) => {
      const dot = document.createElement('div')
      dot.className = 'endp'
      dot.style.background = color
      dot.textContent = label
      return new AMap.Marker({ position: pt, content: dot, offset: new AMap.Pixel(-13, -13), zIndex: 300 })
    }
    if (start) endpRef.current.s = make(start.pt, '#1e9e63', '起')
    if (end) endpRef.current.e = make(end.pt, '#d32f2f', '终')
    if (endpRef.current.s) map.add(endpRef.current.s)
    if (endpRef.current.e) map.add(endpRef.current.e)
  }, [ready, start, end])

  /* ---------- 4. 绘制选中方案 ---------- */
  useEffect(() => {
    const map = mapRef.current
    const AMap = window.AMap
    if (!ready || !map || !AMap) return
    if (overlayRef.current) {
      map.remove(overlayRef.current)
      overlayRef.current = null
    }
    const p = plan?.plans?.[selPlan]
    if (!p) return

    const shapes = []
    const lines = []

    // 避让走廊：用很粗的半透明折线表示「路线两侧 R 米」
    if (show.corridor) {
      const w = Math.max(4, metersToPixels(2 * radius, p.poly[0][1], map.getZoom()))
      lines.push(
        new AMap.Polyline({
          path: p.poly,
          strokeColor: '#2f6fed',
          strokeWeight: w,
          strokeOpacity: 0.18,
          lineJoin: 'round',
          zIndex: 5,
        }),
      )
    }

    // 路线本体：红点清零时画绿色，否则蓝色
    lines.push(
      new AMap.Polyline({
        path: p.poly,
        strokeColor: p.red === 0 ? '#1e9e63' : '#2f6fed',
        strokeWeight: 6,
        strokeOpacity: 0.95,
        lineJoin: 'round',
        zIndex: 20,
      }),
    )
    shapes.push(...lines)

    // 避让区（黄色矩形）
    if (show.areas && p.areas?.length) {
      p.areas.forEach((a) =>
        shapes.push(
          new AMap.Polygon({
            path: a.poly,
            strokeColor: '#ff9800',
            strokeWeight: 1.5,
            strokeOpacity: 0.9,
            fillColor: '#ffb300',
            fillOpacity: 0.22,
            zIndex: 6,
          }),
        ),
      )
    }

    // 走廊内需要留意的点位
    if (show.near && p.near?.length) {
      const lm = new AMap.LabelsLayer({ zooms: [9, 20], zIndex: 105, collision: false, animation: false })
      lm.add(
        p.near.map((idx) => {
          const c = pointsRef.current[idx]
          const m = new AMap.LabelMarker({
            position: [c.lng, c.lat],
            zIndex: 105,
            clickable: true,
            icon: { type: 'image', image: nearIcon(), size: [19, 19], anchor: 'center' },
          })
          // 这一层压在所有点位之上，必须也绑定点击，
          // 否则橙色标记会把点击吞掉，用户点它没反应
          m.on('click', () => openPoint(idx))
          return m
        }),
      )
      shapes.push(lm)
    }

    map.add(shapes)
    overlayRef.current = shapes

    if (show.fit && lines.length) {
      map.setFitView(lines, false, [70, 70, 70, 70])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, plan, selPlan, radius, show, openPoint])

  /* ---------- 地图点击：选点 或 就近命中点位 ---------- */
  clickRef.current = (pt) => {
    if (pickMode) {
      onPick(pickMode, pt)
      return
    }
    const map = mapRef.current
    const pts = pointsRef.current
    if (!map || !pts.length) return
    // 图标只有 11px，直接点中很难；按当前缩放换算容差（40~150 米）做就近命中
    const tol = Math.min(150, Math.max(40, pixelsToMeters(10, pt[1], map.getZoom())))
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < pts.length; i++) {
      const c = pts[i]
      if (Math.abs(c.lng - pt[0]) > 0.02 || Math.abs(c.lat - pt[1]) > 0.02) continue // 廉价粗筛
      const d = Math.hypot((c.lng - pt[0]) * 85000, (c.lat - pt[1]) * 111320)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0 && bestD <= tol) openPoint(best)
    else setPopup(null)
  }

  /* ---------- 弹窗位置：自动决定朝上还是朝下，并限制高度 ---------- */
  const place = (() => {
    if (!popup) return null
    const box = boxRef.current
    if (!box) return null
    const h = box.clientHeight
    const above = popup.y - POPUP_GAP - POPUP_PAD
    const below = h - popup.y - POPUP_GAP - POPUP_PAD
    const useAbove = above >= 260 || above >= below
    const maxH = Math.max(200, Math.min(useAbove ? above : below, h * 0.72))
    const style = useAbove
      ? { left: popup.x, bottom: h - popup.y + POPUP_GAP, maxHeight: maxH }
      : { left: popup.x, top: popup.y + POPUP_GAP, maxHeight: maxH }
    return { above: useAbove, style }
  })()

  return (
    <div className="map-wrap">
      <div ref={boxRef} className="map" />
      {pickMode && <div className="pick-hint">点击地图选择{pickMode === 'start' ? '起点' : '终点'}</div>}
      {popup && place && (
        <PointPopup
          point={points[popup.idx]}
          place={place}
          onLightbox={onOpenLightbox}
          onClose={() => setPopup(null)}
        />
      )}
      {plan?.plans?.[selPlan] && <PlanBadge plan={plan.plans[selPlan]} radius={radius} />}
    </div>
  )
}

/** 地图左下角的方案摘要，省得用户再回头看侧栏 */
function PlanBadge({ plan, radius }) {
  return (
    <div className="map-badge">
      <div className="map-badge-h">{plan.label}</div>
      <div className="map-badge-r">
        <span>
          里程 <b>{(plan.dist / 1000).toFixed(2)}</b> km
        </span>
        <span>
          走廊内红点 <b style={{ color: plan.red ? '#d32f2f' : '#1e9e63' }}>{plan.red}</b>
        </span>
        <span>走廊 {radius} m</span>
      </div>
    </div>
  )
}
