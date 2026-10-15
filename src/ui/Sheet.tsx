import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useLayout } from './layout'
import { IconClose } from './icons'

type Snap = 'half' | 'full'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  /** tall：半屏/全屏两档可拖动；否则按内容高度，只能下拉关闭 */
  tall?: boolean
  children: React.ReactNode
}

// 底部面板：拖动把手或标题区切换半屏/全屏、下拉关闭；横屏手机改为右侧抽屉（不拖动）
export function Sheet({ open, onClose, title, tall = false, children }: SheetProps) {
  const side = useLayout() === 'landscape'
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [snap, setSnap] = useState<Snap>('half')
  const [dragY, setDragY] = useState<number | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)
  // off0：按下时面板相对"完全展开"位置的下移量；h：面板自身高度
  const dragRef = useRef<{ id: number; y0: number; off0: number; h: number; lastY: number; lastT: number; v: number; moved: boolean } | null>(null)
  // 拖动松手后浏览器还会补发一次 click，不能让把手再切一次档
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement
      setMounted(true)
      setClosing(false)
      setSnap('half')
      setDragY(null)
      return
    }
    if (!mounted) return
    setClosing(true)
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
      setDragY(null)
      const opener = openerRef.current
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus({ preventScroll: true })
    }, 220)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !mounted) return
    sheetRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, mounted, onClose])

  if (!mounted) return null

  const onPointerDown = (e: React.PointerEvent) => {
    if (side || (e.pointerType === 'mouse' && e.button !== 0)) return
    const el = sheetRef.current
    if (!el) return
    const h = el.offsetHeight
    const off0 = Math.max(0, el.getBoundingClientRect().top - (window.innerHeight - h))
    dragRef.current = { id: e.pointerId, y0: e.clientY, off0, h, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.id) return
    const dy = e.clientY - d.y0
    if (!d.moved) {
      if (Math.abs(dy) < 6) return
      d.moved = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const dt = e.timeStamp - d.lastT
    if (dt > 0) d.v = d.v * 0.4 + ((e.clientY - d.lastY) / dt) * 0.6
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    setDragY(Math.max(0, Math.min(d.h - 96, d.off0 + dy)))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || e.pointerId !== d.id) return
    if (!d.moved && Math.abs(e.clientY - d.y0) >= 6) d.moved = true
    if (!d.moved) return
    suppressClickRef.current = true
    setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
    const dy = e.clientY - d.y0
    if (!tall) {
      if (d.v > 0.5 || dy > d.h * 0.3) onClose()
      else setDragY(null)
      return
    }
    // 可见高度 = 面板高度 − 下移量；与半屏 56dvh / 全屏 92dvh 两档比较
    const vh = window.innerHeight
    const visible = d.h - Math.max(0, d.off0 + dy)
    const half = vh * 0.56
    const full = vh * 0.92
    if (d.v > 0.6) {
      if (snap === 'full' && visible > half * 0.9) setSnap('half')
      else return onClose()
    } else if (d.v < -0.5) {
      setSnap('full')
    } else if (visible < half * 0.65) {
      return onClose()
    } else {
      setSnap(Math.abs(visible - full) < Math.abs(visible - half) ? 'full' : 'half')
    }
    setDragY(null)
  }

  const style: React.CSSProperties = {}
  if (dragY !== null) style.transform = `translateY(${dragY}px)`
  const dragging = dragRef.current?.moved === true && dragY !== null

  return (
    <div className={`sheet-root${closing ? ' closing' : ''}`}>
      <div className="sheet-scrim" onClick={onClose} />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`sheet ${tall ? `sheet-tall sheet-${snap}` : 'sheet-auto'}${dragging ? ' dragging' : ''}`}
        style={style}
      >
        <div
          className="sheet-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={(e) => {
            if (suppressClickRef.current) {
              e.stopPropagation()
              e.preventDefault()
            }
          }}
        >
          {tall && !side ? (
            <button className="sheet-handle" aria-label={snap === 'half' ? '展开到全屏' : '收回半屏'} onClick={() => setSnap(snap === 'half' ? 'full' : 'half')} />
          ) : (
            <div className="sheet-handle" aria-hidden />
          )}
          <div className="sheet-head">
            <span className="sheet-title">{title}</span>
            <button className="sheet-close" aria-label="关闭" onClick={onClose}>
              <IconClose />
            </button>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

/** 面板里的一行开关/入口：图标 + 文案 + 右侧状态 */
export function SheetRow({
  icon,
  label,
  hint,
  on,
  danger,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  on?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button className={`sheet-row${danger ? ' danger' : ''}`} role={on === undefined ? undefined : 'switch'} aria-checked={on} onClick={onClick}>
      <span className="sheet-row-icon">{icon}</span>
      <span className="sheet-row-text">
        <span>{label}</span>
        {hint ? <span className="sheet-row-hint">{hint}</span> : null}
      </span>
      {on === undefined ? null : <span className={`switch${on ? ' on' : ''}`} aria-hidden />}
    </button>
  )
}
