import type { HandEvent } from '../core/events'
import type { BlindLevel, Street } from '../core/types'
import { fmtChips } from '../core/format'

// 由事件流构建渲染视图（前 upTo 条事件）。牌桌动画 = 逐步推进 upTo；复盘 = 任意跳转。
// 与引擎状态解耦：重建只依赖事件，天然支持回放。

export interface SeatView {
  seat: number
  playerId: string
  stack: number
  committed: number // 本街已投入（展示在座位前的筹码）
  hole: [number, number] | null
  folded: boolean
  allIn: boolean
  lastAction: string | null
  revealed: boolean // 摊牌翻开
  showdownDesc: string | null
  won: number // 本手赢得
}

export interface TableView {
  handNo: number
  level: BlindLevel
  buttonSeat: number
  board: number[]
  pot: number
  street: Street
  seats: (SeatView | null)[]
  done: boolean
  /** 最近一条事件（用于动画/音效提示） */
  lastEvent: HandEvent | null
}

function actionText(e: Extract<HandEvent, { t: 'action' }>): string {
  switch (e.action.type) {
    case 'fold':
      return '弃牌'
    case 'check':
      return '过牌'
    case 'call':
      return e.allIn ? `全下跟注 ${fmtChips(e.paid)}` : `跟注 ${fmtChips(e.paid)}`
    case 'bet':
      return e.allIn ? `全下 ${fmtChips(e.action.to)}` : `下注 ${fmtChips(e.action.to)}`
    case 'raise':
      return e.allIn ? `全下到 ${fmtChips(e.action.to)}` : `加注到 ${fmtChips(e.action.to)}`
  }
}

export function buildView(events: readonly HandEvent[], upTo: number): TableView {
  const view: TableView = {
    handNo: 0,
    level: { sb: 0, bb: 0, ante: 0 },
    buttonSeat: 0,
    board: [],
    pot: 0,
    street: 'preflop',
    seats: new Array(9).fill(null),
    done: false,
    lastEvent: null,
  }
  const n = Math.min(upTo, events.length)
  for (let i = 0; i < n; i++) {
    const e = events[i]
    view.lastEvent = e
    switch (e.t) {
      case 'handStart': {
        view.handNo = e.handNo
        view.level = e.level
        view.buttonSeat = e.buttonSeat
        for (const s of e.seats) {
          view.seats[s.seat] = {
            seat: s.seat,
            playerId: s.playerId,
            stack: s.stack,
            committed: 0,
            hole: null,
            folded: false,
            allIn: false,
            lastAction: null,
            revealed: false,
            showdownDesc: null,
            won: 0,
          }
        }
        break
      }
      case 'postAnte': {
        const s = view.seats[e.seat]!
        s.stack -= e.amount
        s.allIn = e.allIn
        view.pot += e.amount
        break
      }
      case 'postSB':
      case 'postBB': {
        const s = view.seats[e.seat]!
        s.stack -= e.amount
        s.committed += e.amount
        s.allIn = e.allIn
        view.pot += e.amount
        s.lastAction = e.t === 'postSB' ? `小盲 ${fmtChips(e.amount)}` : `大盲 ${fmtChips(e.amount)}`
        break
      }
      case 'dealHole': {
        view.seats[e.seat]!.hole = e.cards
        break
      }
      case 'action': {
        const s = view.seats[e.seat]!
        s.stack -= e.paid
        s.committed += e.paid
        view.pot += e.paid
        s.allIn = e.allIn
        s.lastAction = actionText(e)
        if (e.action.type === 'fold') s.folded = true
        break
      }
      case 'street': {
        view.street = e.street
        view.board.push(...e.cards)
        for (const s of view.seats) {
          if (s) {
            s.committed = 0
            if (!s.folded) s.lastAction = null
          }
        }
        break
      }
      case 'showdown': {
        const s = view.seats[e.seat]!
        s.revealed = e.reveal
        s.showdownDesc = e.reveal ? e.desc : null
        if (!e.reveal) s.lastAction = '盖牌'
        view.street = 'showdown'
        break
      }
      case 'potAward': {
        const s = view.seats[e.seat]!
        s.stack += e.amount
        s.won += e.amount
        s.lastAction = e.reason === 'uncalled' ? `收回 ${fmtChips(e.amount)}` : `赢得 ${fmtChips(e.amount)}`
        view.pot -= e.amount
        break
      }
      case 'handEnd': {
        view.done = true
        for (const s of view.seats) if (s) s.committed = 0
        view.pot = 0
        break
      }
    }
  }
  return view
}
