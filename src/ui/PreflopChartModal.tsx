import { useMemo, useState } from 'react'
import { PERCENTILE, POSITION_ZH, type Position } from '../ai/preflopCharts'
import { BB_DEFEND, CALL_VS_OPEN, RFI, THREEBET, POS_CALL_MULT, widen, tablePct } from '../ai/preflopRanges'
import { className } from '../core/handClass'
import { RangeMatrix } from './RangeMatrix'

// 翻前范围表（紧凶基准）：与 AI 策略、范围推断共用同一份 preflopRanges 数据——看到的即 AI 打的。

const POSITIONS: { key: Position; label: string }[] = [
  { key: 'early', label: '前位 UTG' },
  { key: 'middle', label: '中位 MP' },
  { key: 'late', label: '后位 CO' },
  { key: 'button', label: '按钮 BTN' },
  { key: 'sb', label: '小盲 SB' },
  { key: 'bb', label: '大盲 BB' },
]

type Mode = 'rfi' | 'vsOpen'

export function PreflopChartModal({ heroClass, currentPos, onClose }: { heroClass: number; currentPos: Position | null; onClose: () => void }) {
  const [pos, setPos] = useState<Position>(currentPos ?? 'button')
  const [mode, setMode] = useState<Mode>(currentPos === 'bb' ? 'vsOpen' : 'rfi')

  const view = useMemo(() => {
    if (mode === 'rfi' && pos !== 'bb') {
      const t = RFI[pos]
      return { intensity: t, freq: (cls: number) => t[cls], label: (cls: number) => (t[cls] > 0 ? `开牌加注 ${Math.round(t[cls] * 100)}%` : '弃牌'), pct: tablePct(t), title: '无人入池时开牌加注（RFI）' }
    }
    // 面对后位 2.5bb 开牌：3bet 满色，跟注半色
    const call = pos === 'bb' ? BB_DEFEND : widen(CALL_VS_OPEN, POS_CALL_MULT[pos])
    const intensity = new Float64Array(169)
    for (let cls = 0; cls < 169; cls++) {
      const three = THREEBET[cls]
      const c = (1 - three) * call[cls]
      intensity[cls] = Math.min(1, three + c * 0.5)
    }
    return {
      intensity,
      freq: (cls: number) => THREEBET[cls] + (1 - THREEBET[cls]) * call[cls],
      label: (cls: number) => {
        const three = THREEBET[cls]
        const c = (1 - three) * call[cls]
        if (three <= 0 && c <= 0) return '弃牌'
        const parts: string[] = []
        if (three > 0) parts.push(`3bet ${Math.round(three * 100)}%`)
        if (c > 0) parts.push(`跟注 ${Math.round(c * 100)}%`)
        return parts.join(' / ')
      },
      pct: tablePct(THREEBET) + tablePct(call) * (1 - tablePct(THREEBET)),
      title: pos === 'bb' ? '大盲面对后位 2.5bb 开牌的防守' : `${POSITION_ZH[pos]}面对后位开牌（跟注 / 3bet）`,
    }
  }, [mode, pos])

  const heroPct = heroClass >= 0 ? PERCENTILE[heroClass] : null
  const heroFreq = heroClass >= 0 ? view.freq(heroClass) : 0

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal chart-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>翻前范围表（紧凶基准）</h3>
          <button className="btn" onClick={onClose}>
            关闭 ✕
          </button>
        </div>
        <div className="chart-tabs">
          {POSITIONS.map((p) => (
            <button
              key={p.key}
              className={p.key === pos ? 'active' : ''}
              onClick={() => {
                setPos(p.key)
                if (p.key === 'bb') setMode('vsOpen')
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="chart-tabs chart-modes">
          <button className={mode === 'rfi' ? 'active' : ''} disabled={pos === 'bb'} onClick={() => setMode('rfi')}>
            开牌加注
          </button>
          <button className={mode === 'vsOpen' ? 'active' : ''} onClick={() => setMode('vsOpen')}>
            面对开牌
          </button>
          <span className="chart-pct">{view.title} · 覆盖 {(view.pct * 100).toFixed(0)}% 组合</span>
        </div>
        <RangeMatrix
          intensity={view.intensity}
          highlightClass={heroClass}
          hue={150}
          tooltip={(cls) => `${className(cls)}（强度前 ${(PERCENTILE[cls] * 100).toFixed(0)}%）：${view.label(cls)}`}
        />
        <div className="chart-legend">
          {mode === 'rfi' && pos !== 'bb' ? (
            <>
              <span className="lg lg-strong" /> 开牌加注（半色 = 混合频率） <span className="lg lg-fold" /> 弃牌
            </>
          ) : (
            <>
              <span className="lg lg-strong" /> 3bet <span className="lg lg-open" /> 跟注 <span className="lg lg-fold" /> 弃牌
            </>
          )}
        </div>
        {heroClass >= 0 ? (
          <div className="chart-hint">
            你的手牌 <b>{className(heroClass)}</b>（强度前 {((heroPct ?? 0) * 100).toFixed(0)}%）
            {heroFreq >= 0.99 ? ' — 在此范围内' : heroFreq > 0 ? ` — 混合频率 ${Math.round(heroFreq * 100)}%` : ' — 不在此范围内'}
          </div>
        ) : null}
        <div className="chart-note">这份表就是紧凶 AI 实际使用的策略表，其他风格按松紧沿强弱顺序展开或收窄；范围推断的似然也来自它。</div>
      </div>
    </div>
  )
}
