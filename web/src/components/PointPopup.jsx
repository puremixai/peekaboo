import { useEffect, useState } from 'react'
import { getPointDetail } from '../api'
import { SITE, TYPE_COLOR, TYPE_NAME } from '../constants'
import { daysAgo } from '../geo'

/**
 * 点位详情弹窗。
 *
 * 详情与评论是点击后才向 /api/points/{id} 懒加载的——
 * 这样首屏只需要点位列表（gzip 后约 170KB），
 * 而 96k 条评论只在你真正点开某个点位时才传输那几十条。
 */
export default function PointPopup({ point, place, onLightbox, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    setData(null)
    setErr('')
    getPointDetail(point.id)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [point.id])

  const detail = data?.detail
  const missing = !!detail?.missing
  const imgs = (!missing && detail?.imgs) || []
  const comments = data?.comments || []
  const total = data?.total || 0
  const href = `${SITE}/content/?${point.id}.html`
  const days = daysAgo(point.time)
  const color = TYPE_COLOR[point.t] || '#6b7280'

  const lightboxItems = imgs.map((im) => ({ src: SITE + im[0], cap: im[1] }))

  return (
    <div className={`popup ${place.above ? 'above' : 'below'}`} style={place.style}>
      <button className="popup-close" onClick={onClose} title="关闭">
        ×
      </button>

      <div className="popup-head">
        <span className="popup-tag" style={{ background: color }}>
          类型 {point.t}
        </span>
        <span className="popup-name">{point.n}</span>
      </div>

      <table className="popup-tb">
        <tbody>
          <tr>
            <td>类型</td>
            <td>
              {point.t} · {TYPE_NAME[point.t] || '未分类'}
            </td>
          </tr>
          <tr>
            <td>更新时间</td>
            <td>
              {point.time}
              {days !== null && days <= 3 && <span className="popup-new">3 天内更新</span>}
            </td>
          </tr>
          {detail?.time && (
            <tr>
              <td>精确时间</td>
              <td>{detail.time}</td>
            </tr>
          )}
          {point.et && (
            <tr>
              <td>修改时间</td>
              <td>{point.et}</td>
            </tr>
          )}
          <tr>
            <td>坐标</td>
            <td>
              {point.lng}, {point.lat}
            </td>
          </tr>
        </tbody>
      </table>

      {err && <div className="popup-note err">详情加载失败：{err}</div>}

      {!data && !err && <div className="popup-note">正在加载原站详情与车主评论…</div>}

      {data && (
        <>
          {missing ? (
            <div className="popup-note">原站详情页已失效（原站已删除该点位页面），仅保留上方基础信息</div>
          ) : imgs.length ? (
            <>
              <div className="popup-imgs">
                {imgs.map((im, k) => (
                  <img
                    key={k}
                    className="popup-img"
                    src={SITE + im[0]}
                    alt={im[1]}
                    title={im[1]}
                    loading="lazy"
                    onClick={() => onLightbox(lightboxItems, k)}
                  />
                ))}
              </div>
              <div className="popup-cap">原站违章截图 {imgs.length} 张 · 点击放大</div>
            </>
          ) : (
            <div className="popup-note">原站该点位未上传违章截图</div>
          )}

          {comments.length > 0 ? (
            <div className="popup-cm">
              <div className="popup-cm-h">
                车主实况评论 <b>{total}</b> 条
                {total > comments.length && <span>（显示最近 {comments.length} 条）</span>}
              </div>
              <div className="popup-cm-list">
                {comments.map((c, k) => (
                  <div className="cm" key={k}>
                    <div className="cm-m">
                      <span className="cm-who">{c[1] || '匿名'}</span>
                      <span className="cm-t">{c[0]}</span>
                    </div>
                    <div className="cm-b">{c[2]}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="popup-cm">
              <div className="popup-cm-h">车主实况评论</div>
              <div className="popup-note">原站暂无车主评论</div>
            </div>
          )}
        </>
      )}

      {!missing && (
        <a className="popup-src" href={href} target="_blank" rel="noopener noreferrer">
          在原站打开此页
        </a>
      )}
      <div className="popup-tip">
        数据来源：进京网 jinjing365.com。类型文字说明以原站「关于本站」图例为准。
      </div>
    </div>
  )
}
