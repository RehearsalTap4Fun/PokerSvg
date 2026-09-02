import { useMemo, useState } from 'react'
import { CALL_PCT, OPEN_PCT, PERCENTILE, THREEBET_PCT, type Position } from '../ai/preflopCharts'
import { className } from '../core/handClass'
import { RangeMatrix } from './RangeMatrix'

const POSITIONS: { key: Position; label: string }[] = [
  { key: 'early', label: '前位 UTG' },
  { key: 'middle', label: '中位 MP' },
  { key: 'late', label: '后位 CO' },
  { key: 'button', label: '按钮 BTN' },
  { key: 'sb', label: '小盲 SB' },
  { key: 'bb', label: '大盲 BB' },
]

export function PreflopChartModal({ heroClass, currentPos, onClose }: { heroClass: number; currentPos: Position | null; onClose: () => void }) {
  const [pos, setPos] = useState<Position>(currentPos ?? 'button')

  const intensity = useMemo(() => {
    const arr = new Float64Array(169)
    for (let cls = 0; cls < 169; cls++) {
      const pct = PERCENTILE[cls]
      if (pos === 'bb') {
        // BB：展示防守（跟注）+ 3bet
        if (pct <= THREEBET_PCT) arr[cls] = 1
        else if (pct <= CALL_PCT.bb) arr[cls] = 0.45
      } else {
        if (pct <= THREEBET_PCT) arr[cls] = 1
        else if (pct <= OPEN_PCT[pos]) arr[cls] = 0.65
      }
    }
    return arr
  }, [pos])

  const heroPct = heroClass >= 0 ? PERCENTILE[heroClass] : null
  const inOpen = heroPct !== null && pos !== 'bb' && heroPct <= OPEN_PCT[pos]
  const inDefend = heroPct !== null && pos === 'bb' && heroPct <= CALL_PCT.bb

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal chart-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>翻前标准范围表（紧凶基准）</h3>
          <button className="btn" onClick={onClose}>
            关闭 ✕
          </button>
        </div>
        <div className="chart-tabs">
          {POSITIONS.map((p) => (
            <button key={p.key} className={p.key === pos ? 'active' : ''} onClick={() => setPos(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        <RangeMatrix
          intensity={intensity}
          highlightClass={heroClass}
          hue={150}
          tooltip={(cls) => {
            const pct = PERCENTILE[cls]
            const label =
              pct <= THREEBET_PCT ? '加注/3bet 范围' : pos !== 'bb' && pct <= OPEN_PCT[pos] ? '开牌加注范围' : pos === 'bb' && pct <= CALL_PCT.bb ? '防守跟注范围' : '弃牌'
            return `${className(cls)}（前 ${(pct * 100).toFixed(0)}%）：${label}`
          }}
        />
        <div className="chart-legend">
          <span className="lg lg-strong" /> 3bet/顶级 <span className="lg lg-open" /> {pos === 'bb' ? '防守跟注' : '开牌加注'}{' '}
          <span className="lg lg-fold" /> 弃牌
        </div>
        {heroClass >= 0 ? (
          <div className="chart-hint">
            你的手牌 <b>{className(heroClass)}</b>（强度前 {((heroPct ?? 0) * 100).toFixed(0)}%）
            {pos === 'bb' ? (inDefend ? ' — 在 BB 防守范围内' : ' — 不在 BB 防守范围内') : inOpen ? ` — 在${POSITIONS.find((p) => p.key === pos)?.label}标准开牌范围内` : ` — 不在${POSITIONS.find((p) => p.key === pos)?.label}标准开牌范围内`}
          </div>
        ) : null}
      </div>
    </div>
  )
}
