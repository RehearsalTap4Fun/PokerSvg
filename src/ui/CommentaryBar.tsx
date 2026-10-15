import { useEffect, useState } from 'react'
import { MARK_LABEL, type HandComment, type Mark } from '../analysis/commentary'

const MARK_CLASS: Record<Mark, string> = {
  '!!': 'brilliant',
  '!': 'good',
  '!?': 'interesting',
  '': 'standard',
  '?!': 'dubious',
  '?': 'mistake',
  '??': 'blunder',
}

function MarkBadge({ mark }: { mark: Mark }) {
  return (
    <span className={`cm-mark ${MARK_CLASS[mark]}`}>
      {mark ? `${mark} ` : ''}
      {MARK_LABEL[mark]}
    </span>
  )
}

// 观察员点评条：显示最新一条；有历史时可展开查看最近的点评（新的在上）
export function CommentaryBar({ items, emptyText }: { items: readonly HandComment[]; emptyText: string }) {
  const [open, setOpen] = useState(false)
  const latest = items.length > 0 ? items[items.length - 1] : null

  useEffect(() => {
    if (items.length === 0) setOpen(false)
  }, [items.length])

  return (
    <div className="commentary">
      <span className="cm-avatar" aria-hidden>
        🎙️
      </span>
      {latest ? (
        <div className="cm-body" key={`${latest.handNo}-${latest.eventIdx}`}>
          <div className="cm-head">
            <MarkBadge mark={latest.mark} />
            <span>{latest.head}</span>
          </div>
          <div className="cm-text">{latest.text}</div>
        </div>
      ) : (
        <div className="cm-body cm-empty">{emptyText}</div>
      )}
      {items.length > 1 ? (
        <button className="btn btn-quick cm-more" onClick={() => setOpen(!open)}>
          {open ? '收起' : `历史 ${items.length}`}
        </button>
      ) : null}
      {open ? (
        <div className="cm-history">
          {[...items].reverse().map((c) => (
            <div className="cm-item" key={`${c.handNo}-${c.eventIdx}`}>
              <div className="cm-head">
                <MarkBadge mark={c.mark} />
                <span>
                  第 {c.handNo} 手 · {c.head}
                </span>
              </div>
              <div className="cm-text">{c.text}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
