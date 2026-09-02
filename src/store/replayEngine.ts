import { applyAction, setupHand } from '../core/hand'
import type { HandState } from '../core/types'
import type { HandEvent } from '../core/events'
import { initialRange, observeAction, observeBoard, type ObservedAction } from '../analysis/inference'
import type { Range } from '../analysis/range'
import { situationFor } from '../ai/decide'
import type { AiStyle } from '../ai/styles'

// 复盘时重建任意事件游标处的范围推断：
// inference 是事件流的确定性纯函数——用 handStart 里的 seed 重建整副牌，逐 action 重放并观察。

export function rangesAtCursor(events: readonly HandEvent[], upTo: number, styleFor: (seat: number) => AiStyle): Map<number, Range> {
  const start = events[0]
  if (!start || start.t !== 'handStart') return new Map()
  let state: HandState = setupHand({
    handNo: start.handNo,
    seed: start.seed,
    level: start.level,
    buttonSeat: start.buttonSeat,
    sbSeat: start.sbSeat,
    bbSeat: start.bbSeat,
    seats: start.seats.map((s) => ({ seat: s.seat, playerId: s.playerId, stack: s.stack })),
  }).state
  const ranges = new Map<number, Range>()
  for (const s of start.seats) ranges.set(s.seat, initialRange())

  const n = Math.min(upTo, events.length)
  for (let i = 1; i < n; i++) {
    const e = events[i]
    if (e.t !== 'action') continue
    if (state.street === 'done' || state.actionOn !== e.seat) break // 防御：与引擎失配即停
    const sit = situationFor(state, e.seat)
    const boardBefore = state.board.slice()
    const r = applyAction(state, e.action)
    state = r.state
    const obs: ObservedAction | null =
      e.action.type === 'check' ? 'check' : e.action.type === 'call' ? 'call' : e.action.type === 'fold' ? null : 'raise'
    if (obs) {
      const range = ranges.get(e.seat)
      if (range) observeAction(range, styleFor(e.seat), sit, obs, boardBefore)
    }
    for (const ev of r.events) {
      if (ev.t === 'street') for (const range of ranges.values()) observeBoard(range, ev.cards)
    }
  }
  return ranges
}
