import { useEffect } from 'react'

/** 违章截图放大层：点击任意处关闭，Esc 关闭，← → 切换 */
export default function Lightbox({ items, idx, onClose, onStep }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onStep(-1)
      else if (e.key === 'ArrowRight') onStep(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  const it = items?.[idx]
  if (!it) return null

  return (
    <div className="lb" onClick={onClose}>
      <img className="lb-img" src={it.src} alt={it.cap} onClick={(e) => e.stopPropagation()} />
      {items.length > 1 && (
        <div className="lb-nav" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onStep(-1)}>‹ 上一张</button>
          <span className="lb-pos">
            {idx + 1} / {items.length}
          </span>
          <button onClick={() => onStep(1)}>下一张 ›</button>
        </div>
      )}
      <div className="lb-cap">{it.cap}</div>
      <div className="lb-hint">点击任意处关闭 · Esc 关闭 · ← → 切换</div>
    </div>
  )
}
