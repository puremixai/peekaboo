import { useEffect, useMemo, useRef, useState } from 'react'
import { getTips } from '../api'
import { RED_TYPE, STRATEGIES, TYPE_COLOR, TYPE_NAME } from '../constants'
import { fmtKm, fmtMin, minDistToPoly } from '../geo'

export default function Sidebar({
  config,
  points,
  start,
  end,
  setPoint,
  onLocate,
  locating,
  pickMode,
  setPickMode,
  radius,
  setRadius,
  targetAll,
  setTargetAll,
  strategy,
  setStrategy,
  planning,
  onPlan,
  onClear,
  plan,
  selPlan,
  setSelPlan,
  show,
  setShow,
  status,
}) {
  const [progress, setProgress] = useState('')

  useEffect(() => {
    if (!planning) {
      setProgress('')
      return
    }
    const t0 = Date.now()
    setProgress('正在算路…')
    const id = setInterval(() => {
      setProgress(`正在算路…已用 ${Math.round((Date.now() - t0) / 1000)} 秒（每轮都要调用高德接口）`)
    }, 1000)
    return () => clearInterval(id)
  }, [planning])

  const redPoints = useMemo(() => {
    const out = []
    if (!plan?.plans) return out
    plan.plans.forEach((p, pi) => {
      const list = (p.near || [])
        .filter((i) => points[i]?.t === RED_TYPE)
        .map((i) => ({ i, d: minDistToPoly([points[i].lng, points[i].lat], p.poly) }))
        .sort((a, b) => a.d - b.d)
      out.push(list)
    })
    return out
  }, [plan, points])

  const sel = plan?.plans?.[selPlan]

  return (
    <aside className="side">
      <header className="side-head">
        <h1>幽州迂道览胜舆</h1>
        <p>
          数据来源 <b>jinjing365.com</b>，共 <b>{points.length || '—'}</b> 个点位（坐标 GCJ-02）。
          点击地图上任意点位即可就地查看原站详情（精确到秒的更新时间 + 违章截图 + 车主评论）。
        </p>
      </header>

      <section className="side-sec">
        <AddressInput
          label="起点"
          value={start}
          placeholder="输入地点，如：北京南站"
          pickMode={pickMode}
          onPickMode={() => setPickMode(pickMode === 'start' ? null : 'start')}
          onSelect={(pt, name) => setPoint('start', pt, name)}
          onLocate={onLocate}
          locating={locating}
        />
        <AddressInput
          label="终点"
          value={end}
          placeholder="输入地点，如：首都机场"
          pickMode={pickMode}
          onPickMode={() => setPickMode(pickMode === 'end' ? null : 'end')}
          onSelect={(pt, name) => setPoint('end', pt, name)}
        />
      </section>

      <section className="side-sec">
        <div className="row">
          <label htmlFor="radius">
            避让半径：<b>{radius}</b> 米
          </label>
        </div>
        <input
          id="radius"
          type="range"
          min="20"
          max="400"
          step="10"
          value={radius}
          onChange={(e) => setRadius(+e.target.value)}
        />
        <p className="hint">
          摄像头与路线的距离小于该值就算「经过」。100 米能避开大部分路口，再往大可能避不开（路网被逼死）。
        </p>

        <label className="field">
          <span>避让目标</span>
          <select value={targetAll ? 'all' : 'red'} onChange={(e) => setTargetAll(e.target.value === 'all')}>
            <option value="red">仅红点（类型 2 · 主要抓拍点位）</option>
            <option value="all">全部类型点位</option>
          </select>
        </label>

        <label className="field">
          <span>驾车策略</span>
          <select value={strategy} onChange={(e) => setStrategy(+e.target.value)}>
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <button className="primary" onClick={onPlan} disabled={planning || !start || !end}>
          {planning ? '算路中…' : '生成避让方案'}
        </button>
        <button className="ghost" onClick={onClear} disabled={planning}>
          清除路线与标记
        </button>

        {progress && <div className="status">{progress}</div>}
        {status && <div className={`status ${status.type}`}>{status.text}</div>}
      </section>

      {plan && (
        <section className="side-sec">
          <h2>方案对比（{plan.plans.length} 个）</h2>
          <div className="plans">
            {plan.plans.map((p, i) => (
              <button key={i} className={`plan ${i === selPlan ? 'on' : ''}`} onClick={() => setSelPlan(i)}>
                <div className="plan-t">
                  <b>{p.label}</b>
                  {p.red === 0 && <span className="tag ok">红点已清零</span>}
                  <em>{fmtKm(p.dist)}</em>
                </div>
                <div className="plan-m">
                  <span>
                    走廊内红点 <b className={p.red ? 'bad' : 'good'}>{p.red}</b>
                  </span>
                  <span>避让区 {p.areas?.length || 0} 个</span>
                  <span>{fmtMin(p.dur)}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="kv">
            <span>不避让基准</span>
            <span>
              {fmtKm(plan.baseline.dist)} · 红点 {plan.baseline.red}
            </span>
          </div>
          <div className="kv">
            <span>调用高德接口</span>
            <span>{plan.calls} 次</span>
          </div>

          {plan.edgeRed?.length > 0 && (
            <div className="warn">
              起点/终点附近有 <b>{plan.edgeRed.length}</b> 个红点，属于进出必经，无法避让：
              {plan.edgeRed.slice(0, 5).map((e) => (
                <div key={e.i} className="edge">
                  {e.where}外 {Math.round(e.d)} 米 · {points[e.i]?.n}
                </div>
              ))}
            </div>
          )}

          {sel && (
            <div className={sel.red === 0 ? 'good' : 'warn'}>
              {sel.red === 0 ? (
                <>
                  当前方案在 {radius} 米走廊内<b>没有红点</b>，里程 {fmtKm(sel.dist)}（比基准多{' '}
                  {fmtKm(sel.dist - plan.baseline.dist)}）。
                </>
              ) : (
                <>
                  仍有 <b>{sel.red}</b> 个红点在 {radius} 米走廊内，最近的 {Math.round(redPoints[selPlan][0]?.d || 0)} 米。
                  可尝试加大避让半径或更换策略。
                </>
              )}
            </div>
          )}

          {redPoints[selPlan]?.length > 0 && (
            <details className="nearest">
              <summary>最近的 {Math.min(8, redPoints[selPlan].length)} 个红点（点一下可在地图定位）</summary>
              <ol>
                {redPoints[selPlan].slice(0, 8).map((o) => (
                  <li key={o.i}>
                    <span>{Math.round(o.d)} 米</span>
                    <span className="nm">{points[o.i]?.n}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}

      <section className="side-sec">
        <h2>显示选项</h2>
        {[
          ['points', '显示全部摄像头点位'],
          ['corridor', '显示避让走廊（±半径的蓝色带）'],
          ['near', '显示走廊内点位（橙）'],
          ['areas', '显示避让区域（黄框）'],
        ].map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={!!show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </section>

      <section className="side-sec">
        <h2>点位类型</h2>
        <ul className="legend">
          {Object.keys(TYPE_COLOR).map((t) => (
            <li key={t}>
              <i style={{ background: TYPE_COLOR[t] }} />
              {t} — {TYPE_NAME[t]}
            </li>
          ))}
        </ul>
        <p className="hint">
          类型文字说明以原站「关于本站」图例为准；1、2 原站未给出文字定义，此处按语义补注。
        </p>
      </section>

      <footer className="side-foot">
        高德 Key 由服务端注入（{config?.jsKey ? '已配置' : '未配置'}）；
        安全密钥{config?.securityProxy ? '经服务端代理转发，前端不可见' : '未配置（未启用代理模式）'}；
        避让算法在 Go 服务端执行。
      </footer>
    </aside>
  )
}

/** 起终点输入框：带防抖的输入提示（走服务端 /api/tips 代理，Key 不外泄） */
function AddressInput({ label, value, placeholder, pickMode, onPickMode, onSelect, onLocate, locating }) {
  const [kw, setKw] = useState('')
  const [tips, setTips] = useState([])
  const [open, setOpen] = useState(false)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!kw.trim() || kw === value?.name) {
      setTips([])
      return
    }
    const id = setTimeout(() => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      getTips(kw.trim(), ac.signal)
        .then((d) => {
          setTips(d.tips || [])
          setOpen(true)
        })
        .catch(() => {})
    }, 300)
    return () => clearTimeout(id)
  }, [kw, value?.name])

  const choose = (t) => {
    const [lng, lat] = t.location.split(',').map(Number)
    onSelect([lng, lat], t.name)
    setKw(t.name)
    setOpen(false)
    setTips([])
  }

  return (
    <div className="addr">
      <div className="addr-row">
        <span className="addr-label">{label}</span>
        <div className="addr-input">
          <input
            value={kw}
            placeholder={placeholder}
            onChange={(e) => setKw(e.target.value)}
            onFocus={() => tips.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
          />
          {open && tips.length > 0 && (
            <ul className="tips">
              {tips.slice(0, 8).map((t, i) => (
                <li key={i} onMouseDown={() => choose(t)}>
                  <b>{t.name}</b>
                  <span>{t.district}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {onLocate && (
          <button
            className="pick"
            onClick={onLocate}
            disabled={locating}
            title="用浏览器定位到的当前位置作为起点"
          >
            {locating ? '定位中' : '定位'}
          </button>
        )}
        <button className={pickMode ? 'pick on' : 'pick'} onClick={onPickMode} title="在地图上选点">
          地图选点
        </button>
      </div>
      <div className="addr-cur">{value ? value.name : '未设置'}</div>
    </div>
  )
}
