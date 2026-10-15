import { useEffect, useMemo, useState } from 'react'
import type { Action, LegalActions } from '../core/types'
import { fmtChips } from '../core/format'

export interface ActionBarProps {
  legal: LegalActions
  pot: number
  bb: number
  heroStack: number
  onAction: (a: Action) => void
  /** 触屏布局：加注改为两步（展开额度面板 → 确认），默认只占一排大按钮 */
  compact?: boolean
}

// 行动条：按钮只渲染引擎给出的合法动作；快捷键 F=弃牌 C=过牌/跟注 R=下注/加注确认 A=全下
export function ActionBar({ legal, pot, bb, heroStack, onAction, compact = false }: ActionBarProps) {
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo)
  const [raiseOpen, setRaiseOpen] = useState(false)

  useEffect(() => {
    setRaiseTo(legal.minRaiseTo)
    setRaiseOpen(false)
  }, [legal.minRaiseTo, legal.maxRaiseTo])

  const clampTo = (x: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(x)))

  const quickSizes = useMemo(() => {
    // 快捷 sizing：以"加注后"的目标额度计算（含跟注部分）
    const base = pot + legal.callAmount
    const mk = (label: string, amount: number) => ({ label, to: clamp(Math.round(amount)) })
    function clamp(x: number) {
      return Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, x))
    }
    const opts = [mk('最小', legal.minRaiseTo), mk('1/2池', base * 0.5), mk('2/3池', base * 0.67), mk('底池', base), mk('全下', legal.maxRaiseTo)]
    const seen = new Set<number>()
    return opts.filter((o) => {
      if (seen.has(o.to)) return false
      seen.add(o.to)
      return true
    })
  }, [legal, pot])

  const raiseAction = (to: number): Action => (legal.isBet ? { type: 'bet', to } : { type: 'raise', to })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const k = e.key.toLowerCase()
      if (k === 'f') onAction({ type: 'fold' })
      else if (k === 'c') onAction(legal.canCheck ? { type: 'check' } : { type: 'call' })
      else if (k === 'r' && legal.canRaise) onAction(legal.isBet ? { type: 'bet', to: raiseTo } : { type: 'raise', to: raiseTo })
      else if (k === 'a' && legal.canRaise) onAction(legal.isBet ? { type: 'bet', to: legal.maxRaiseTo } : { type: 'raise', to: legal.maxRaiseTo })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [legal, raiseTo, onAction])

  const raiseLabel = legal.isBet ? '下注' : '加注到'
  const callAllIn = legal.callAmount >= heroStack
  const step = Math.max(1, Math.floor(bb / 2))

  const callButton = legal.canCheck ? (
    <button className="btn btn-check" onClick={() => onAction({ type: 'check' })}>
      过牌 <kbd>C</kbd>
    </button>
  ) : (
    <button className="btn btn-call" onClick={() => onAction({ type: 'call' })}>
      {callAllIn ? '全下跟注' : '跟注'} {legal.callAmount} <kbd>C</kbd>
    </button>
  )

  if (compact) {
    const onlyAllIn = legal.maxRaiseTo <= legal.minRaiseTo
    const allIn = raiseTo >= legal.maxRaiseTo
    return (
      <div className={`action-bar action-bar-compact${raiseOpen ? ' raising' : ''}`}>
        {raiseOpen ? (
          <div className="raise-panel" role="group" aria-label="选择额度">
            <div className="raise-presets">
              {quickSizes.map((q) => (
                <button key={q.label} className={`raise-preset${q.to === raiseTo ? ' active' : ''}`} onClick={() => setRaiseTo(q.to)}>
                  {q.label}
                </button>
              ))}
            </div>
            <div className="raise-slider">
              <button className="raise-step" aria-label="减少一个大盲" disabled={raiseTo <= legal.minRaiseTo} onClick={() => setRaiseTo(clampTo(raiseTo - bb))}>
                −
              </button>
              <input
                type="range"
                aria-label="额度"
                min={legal.minRaiseTo}
                max={legal.maxRaiseTo}
                step={step}
                value={raiseTo}
                onChange={(e) => setRaiseTo(clampTo(Number(e.target.value)))}
              />
              <button className="raise-step" aria-label="增加一个大盲" disabled={allIn} onClick={() => setRaiseTo(clampTo(raiseTo + bb))}>
                +
              </button>
            </div>
          </div>
        ) : null}
        <div className="action-buttons">
          {raiseOpen ? (
            <>
              <button className="btn btn-fold" onClick={() => setRaiseOpen(false)}>
                取消
              </button>
              <button className="btn btn-raise btn-confirm" onClick={() => onAction(raiseAction(raiseTo))}>
                <span>
                  {allIn ? '确认全下' : `确认${raiseLabel}`} {fmtChips(raiseTo)}
                </span>
                <span className="btn-sub">
                  {(raiseTo / bb).toFixed(1)} BB · 底池 {fmtChips(pot)}
                </span>
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-fold" onClick={() => onAction({ type: 'fold' })}>
                弃牌
              </button>
              {callButton}
              {legal.canRaise ? (
                onlyAllIn ? (
                  <button className="btn btn-raise" onClick={() => onAction(raiseAction(legal.maxRaiseTo))}>
                    全下 {fmtChips(legal.maxRaiseTo)}
                  </button>
                ) : (
                  <button className="btn btn-raise" aria-expanded={false} onClick={() => setRaiseOpen(true)}>
                    {legal.isBet ? '下注' : '加注'}
                  </button>
                )
              ) : null}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="action-bar">
      <div className="action-buttons">
        <button className="btn btn-fold" onClick={() => onAction({ type: 'fold' })}>
          弃牌 <kbd>F</kbd>
        </button>
        {callButton}
        {legal.canRaise ? (
          <button className="btn btn-raise" onClick={() => onAction(raiseAction(raiseTo))}>
            {raiseTo >= legal.maxRaiseTo ? '全下' : raiseLabel} {raiseTo} <kbd>R</kbd>
          </button>
        ) : null}
      </div>
      {legal.canRaise ? (
        <div className="raise-controls">
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={step}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Number(e.target.value))))}
          />
          <input
            className="raise-input"
            type="number"
            value={raiseTo}
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            onChange={(e) => setRaiseTo(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(Number(e.target.value) || legal.minRaiseTo))))}
          />
          <div className="quick-sizes">
            {quickSizes.map((q) => (
              <button key={q.label} className="btn btn-quick" onClick={() => setRaiseTo(q.to)}>
                {q.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
