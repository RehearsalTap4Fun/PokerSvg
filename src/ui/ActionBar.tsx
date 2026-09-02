import { useEffect, useMemo, useState } from 'react'
import type { Action, LegalActions } from '../core/types'

export interface ActionBarProps {
  legal: LegalActions
  pot: number
  bb: number
  heroStack: number
  onAction: (a: Action) => void
}

// 行动条：按钮只渲染引擎给出的合法动作；快捷键 F=弃牌 C=过牌/跟注 R=下注/加注确认 A=全下
export function ActionBar({ legal, pot, bb, heroStack, onAction }: ActionBarProps) {
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo)

  useEffect(() => {
    setRaiseTo(legal.minRaiseTo)
  }, [legal.minRaiseTo, legal.maxRaiseTo])

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

  return (
    <div className="action-bar">
      <div className="action-buttons">
        <button className="btn btn-fold" onClick={() => onAction({ type: 'fold' })}>
          弃牌 <kbd>F</kbd>
        </button>
        {legal.canCheck ? (
          <button className="btn btn-check" onClick={() => onAction({ type: 'check' })}>
            过牌 <kbd>C</kbd>
          </button>
        ) : (
          <button className="btn btn-call" onClick={() => onAction({ type: 'call' })}>
            {callAllIn ? '全下跟注' : '跟注'} {legal.callAmount} <kbd>C</kbd>
          </button>
        )}
        {legal.canRaise ? (
          <button className="btn btn-raise" onClick={() => onAction(legal.isBet ? { type: 'bet', to: raiseTo } : { type: 'raise', to: raiseTo })}>
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
            step={Math.max(1, Math.floor(bb / 2))}
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
