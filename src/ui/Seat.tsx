import type React from 'react'
import type { SeatView } from '../store/viewModel'
import { HUMAN_COLOR, STYLES } from '../ai/styles'
import type { AiStyleId } from '../core/types'
import { fmtChips } from '../core/format'
import { CardView } from './CardView'

// 座位定位：display 位置 0 = 屏幕正下方（人类），顺时针排布
export const SEAT_POS: { x: number; y: number }[] = [
  { x: 50, y: 90 },
  { x: 21, y: 84 },
  { x: 4, y: 55 },
  { x: 9, y: 22 },
  { x: 30, y: 8 },
  { x: 62, y: 6 },
  { x: 84, y: 16 },
  { x: 95, y: 46 },
  { x: 80, y: 80 },
]

export interface SeatProps {
  view: SeatView
  name: string
  style: AiStyleId | 'human'
  displayPos: number
  isButton: boolean
  isTurn: boolean
  isHero: boolean
  showCards: boolean
  showStyleTag: boolean
  rank: number | null
  /** 刚赢得底池（触发高亮动画） */
  justWon: boolean
}

export function Seat({ view, name, style, displayPos, isButton, isTurn, isHero, showCards, showStyleTag, rank, justWon }: SeatProps) {
  const pos = SEAT_POS[displayPos]
  const st = style === 'human' ? null : STYLES[style]
  const color = st ? st.color : HUMAN_COLOR
  const faceUp = showCards || view.revealed
  // 下注筹码位置：座位向桌心偏移
  const betX = pos.x + (50 - pos.x) * 0.38
  const betY = pos.y + (45 - pos.y) * 0.38
  return (
    <>
      <div
        className={`seat${view.folded ? ' seat-folded' : ''}${isTurn ? ' seat-turn' : ''}${isHero ? ' seat-hero' : ''}${justWon ? ' seat-won' : ''}`}
        style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      >
        <div className="seat-cards">
          {view.hole && !view.folded ? (
            <>
              <CardView card={view.hole[0]} faceUp={faceUp} size={isHero ? 'md' : 'sm'} />
              <CardView card={view.hole[1]} faceUp={faceUp} size={isHero ? 'md' : 'sm'} />
            </>
          ) : null}
        </div>
        <div className="seat-plate" title={st ? `${st.name}：${st.desc}` : undefined}>
          <div className="seat-avatar" style={{ borderColor: color, background: `${color}24` }}>
            {st ? st.emoji : '👤'}
          </div>
          <div className="seat-meta">
            <div className="seat-name">
              {name}
              {st && showStyleTag ? <span className="seat-style-tag">{st.name}</span> : null}
            </div>
            <div className="seat-stack">
              {rank !== null ? `第 ${rank} 名` : view.allIn && view.stack === 0 ? '全下' : fmtChips(view.stack)}
            </div>
          </div>
        </div>
        {view.showdownDesc ? <div className="seat-desc">{view.showdownDesc}</div> : null}
        {view.lastAction ? <div className={`seat-action${view.won > 0 ? ' seat-action-win' : ''}`}>{view.lastAction}</div> : null}
        {isButton ? <div className="dealer-btn">D</div> : null}
      </div>
      {view.committed > 0 ? (
        <div
          className="bet-chip"
          style={{ left: `${betX}%`, top: `${betY}%`, '--sx': `${pos.x}%`, '--sy': `${pos.y}%` } as React.CSSProperties}
        >
          {fmtChips(view.committed)}
        </div>
      ) : null}
    </>
  )
}
