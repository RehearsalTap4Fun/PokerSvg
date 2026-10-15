import type React from 'react'
import type { SeatView } from '../store/viewModel'
import { HUMAN_COLOR, STYLES } from '../ai/styles'
import type { AiStyleId } from '../core/types'
import { fmtChips } from '../core/format'
import { CardView } from './CardView'
import { Avatar } from './Avatar'
import type { Layout } from './layout'

export type XY = { x: number; y: number }

// 座位定位：display 位置 0 = 屏幕正下方（人类），顺时针排布
export const SEAT_POS: XY[] = [
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

// 横屏手机：桌面同款宽椭圆，但上下收进来，座位不出桌沿
const SEAT_POS_LANDSCAPE: XY[] = [
  { x: 50, y: 83 },
  { x: 23, y: 80 },
  { x: 7, y: 52 },
  { x: 13, y: 20 },
  { x: 35, y: 13 },
  { x: 65, y: 13 },
  { x: 87, y: 20 },
  { x: 93, y: 52 },
  { x: 77, y: 80 },
]

// 竖屏：按开局人数沿高椭圆均匀排布（下标 = 从英雄起顺时针的次序）
const SEAT_POS_PORTRAIT: Record<number, XY[]> = {
  9: [
    { x: 50, y: 86 },
    { x: 11, y: 73 },
    { x: 10, y: 52 },
    { x: 11, y: 30 },
    { x: 31, y: 10 },
    { x: 69, y: 10 },
    { x: 89, y: 30 },
    { x: 90, y: 52 },
    { x: 89, y: 73 },
  ],
  6: [
    { x: 50, y: 86 },
    { x: 11, y: 64 },
    { x: 13, y: 26 },
    { x: 50, y: 9 },
    { x: 87, y: 26 },
    { x: 89, y: 64 },
  ],
  2: [
    { x: 50, y: 86 },
    { x: 50, y: 10 },
  ],
}

/** 每个座位号在当前布局下的桌面坐标（百分比） */
export function seatPositions(layout: Layout, seats: readonly number[], humanSeat: number): Map<number, XY> {
  const out = new Map<number, XY>()
  const disp = (s: number) => (s - humanSeat + 9) % 9
  const portrait = layout === 'portrait' ? SEAT_POS_PORTRAIT[seats.length] : undefined
  if (portrait) {
    ;[...seats].sort((a, b) => disp(a) - disp(b)).forEach((s, i) => out.set(s, portrait[i]))
    return out
  }
  const table = layout === 'landscape' ? SEAT_POS_LANDSCAPE : SEAT_POS
  for (const s of seats) out.set(s, table[disp(s)])
  return out
}

/** 下注筹码位置：座位向桌心偏移；竖屏两侧座位只做水平偏移，避开公共牌 */
function betPos(pos: XY, layout: Layout): XY {
  const heroSpot = pos.x > 40 && pos.x < 60 && pos.y > 75
  if (layout === 'portrait') {
    if (heroSpot) return { x: 50, y: pos.y - 17 }
    if (pos.x < 22) return { x: pos.x + 17, y: pos.y }
    if (pos.x > 78) return { x: pos.x - 17, y: pos.y }
    return { x: pos.x + (50 - pos.x) * 0.3, y: pos.y + (45 - pos.y) * 0.3 }
  }
  if (layout === 'landscape' && heroSpot) return { x: 50, y: pos.y - 22 }
  return { x: pos.x + (50 - pos.x) * 0.38, y: pos.y + (45 - pos.y) * 0.38 }
}

export interface SeatProps {
  view: SeatView
  playerId: string
  name: string
  style: AiStyleId | 'human'
  pos: XY
  layout: Layout
  isButton: boolean
  isTurn: boolean
  isHero: boolean
  showCards: boolean
  showStyleTag: boolean
  rank: number | null
  /** 刚赢得底池（触发高亮动画） */
  justWon: boolean
}

export function Seat({ view, playerId, name, style, pos, layout, isButton, isTurn, isHero, showCards, showStyleTag, rank, justWon }: SeatProps) {
  const side = pos.x > 62 ? ' seat-right' : pos.x < 38 ? ' seat-left' : ''
  const st = style === 'human' ? null : STYLES[style]
  const color = st ? st.color : HUMAN_COLOR
  const faceUp = showCards || view.revealed
  const { x: betX, y: betY } = betPos(pos, layout)
  return (
    <>
      <div
        className={`seat${side}${view.folded ? ' seat-folded' : ''}${isTurn ? ' seat-turn' : ''}${isHero ? ' seat-hero' : ''}${justWon ? ' seat-won' : ''}`}
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
            <Avatar playerId={playerId} style={style} />
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
