import { useState } from 'react'
import { RANK_CHARS } from '../core/cards'
import { className } from '../core/handClass'

export interface RangeMatrixProps {
  /** 169 项，0..1 热力值 */
  intensity: Float64Array | number[]
  /** 高亮的手牌类（如英雄当前手牌），-1 = 无 */
  highlightClass?: number
  /** 每格的悬浮说明（可选，默认显示类名与热度） */
  tooltip?: (classId: number) => string
  /** 热力颜色（默认橙红） */
  hue?: number
}

// 13x13 手牌类矩阵：行/列 0 = A；上三角 suited，下三角 offsuit
export function RangeMatrix({ intensity, highlightClass = -1, tooltip, hue = 16 }: RangeMatrixProps) {
  const [hover, setHover] = useState(-1)
  const cells = []
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const cls = row * 13 + col
      const v = Math.max(0, Math.min(1, intensity[cls] ?? 0))
      const bg = v > 0.001 ? `hsla(${hue}, 85%, ${62 - v * 24}%, ${0.25 + v * 0.75})` : undefined
      cells.push(
        <div
          key={cls}
          className={`rm-cell${row === col ? ' rm-pair' : ''}${cls === highlightClass ? ' rm-highlight' : ''}`}
          style={bg ? { background: bg } : undefined}
          onMouseEnter={() => setHover(cls)}
          onMouseLeave={() => setHover(-1)}
          onClick={() => setHover(cls)}
        >
          {className(cls)}
        </div>,
      )
    }
  }
  return (
    <div className="rm-wrap">
      <div className="rm-grid">{cells}</div>
      <div className="rm-tip">
        {hover >= 0
          ? tooltip
            ? tooltip(hover)
            : `${className(hover)}：${(Math.max(0, Math.min(1, intensity[hover] ?? 0)) * 100).toFixed(0)}%`
          : ' '}
      </div>
    </div>
  )
}

export const MATRIX_RANKS = RANK_CHARS
