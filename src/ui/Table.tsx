import type { TableView } from '../store/viewModel'
import type { TournamentPlayer } from '../core/types'
import { fmtChips } from '../core/format'
import type React from 'react'
import { CardView } from './CardView'
import { Seat, SEAT_POS } from './Seat'

export interface TableProps {
  view: TableView
  players: readonly TournamentPlayer[]
  humanSeat: number
  /** 当前轮到谁（-1 = 无）；仅在动画追上实时状态时传入 */
  turnSeat: number
  /** 上帝视角（复盘）：所有底牌可见 */
  revealAll: boolean
  showStyleTags: boolean
  levelText: string
  subText?: string
}

export function Table({ view, players, humanSeat, turnSeat, revealAll, showStyleTags, levelText, subText }: TableProps) {
  return (
    <div className="table-wrap">
      <div className="table-felt">
        <div className="table-info">
          <div>{levelText}</div>
          {subText ? <div className="table-subinfo">{subText}</div> : null}
        </div>
        <div className="board">
          {[0, 1, 2, 3, 4].map((i) => (
            <CardView key={i} card={view.board[i] ?? null} faceUp={view.board[i] !== undefined} size="lg" />
          ))}
        </div>
        {(() => {
          // 展示的底池不含本街尚未收拢的下注（桌上筹码单独可见）
          const committed = view.seats.reduce((s, x) => s + (x ? x.committed : 0), 0)
          const pot = view.pot - committed
          return pot > 0 ? <div className="pot">底池 {fmtChips(pot)}</div> : null
        })()}
        {view.lastEvent?.t === 'potAward'
          ? (() => {
              const e = view.lastEvent
              const target = SEAT_POS[(e.seat - humanSeat + 9) % 9]
              return (
                <div
                  key={`fly-${e.seat}-${e.amount}-${view.pot}`}
                  className="fly-chip"
                  style={{ '--tx': `${target.x}%`, '--ty': `${target.y}%` } as React.CSSProperties}
                >
                  +{fmtChips(e.amount)}
                </div>
              )
            })()
          : null}
        {view.seats.map((s) => {
          if (!s) return null
          const p = players.find((x) => x.seat === s.seat)
          const displayPos = (s.seat - humanSeat + 9) % 9
          const isHero = s.seat === humanSeat
          const justWon = view.lastEvent?.t === 'potAward' && view.lastEvent.seat === s.seat
          return (
            <Seat
              key={s.seat}
              view={s}
              name={p?.name ?? s.playerId}
              style={p?.style ?? 'tag'}
              displayPos={displayPos}
              isButton={view.buttonSeat === s.seat}
              isTurn={turnSeat === s.seat}
              isHero={isHero}
              showCards={isHero || revealAll}
              showStyleTag={showStyleTags && !isHero}
              rank={null}
              justWon={justWon}
            />
          )
        })}
      </div>
    </div>
  )
}
