import type { HandState, LegalActions, SeatState } from './types'

// 下注规则辅助：合法动作计算与"待行动"判定。
// 加注权（reopen）采用累计式判定：currentBet - actedAt >= lastFullRaiseSize 时可再加注，
// 自然覆盖"多个不足额 all-in 累计构成完整加注则重新开放行动"的 TDA 规则。

/** 是否存在 seat 之外的、未弃牌且未 all-in 的对手（决定 BB option / 加注是否有意义） */
export function othersCanRespond(state: HandState, seat: number): boolean {
  for (const s of state.seats) {
    if (s && s.seat !== seat && !s.folded && !s.allIn) return true
  }
  return false
}

/** 该座位本条街是否还需要/可以行动 */
export function isPending(state: HandState, s: SeatState | null): boolean {
  if (!s || s.folded || s.allIn) return false
  if (s.committed < state.currentBet) return true
  if (s.actedAt >= 0) return false
  // 未主动行动过且无需跟注（如 BB option、翻后未行动）：仅当有对手能响应时才有行动意义
  return othersCanRespond(state, s.seat)
}

/** 从 fromSeat 的下一位开始顺时针找第一个待行动座位，无则返回 -1 */
export function findNextActor(state: HandState, fromSeat: number): number {
  const n = state.seats.length
  for (let i = 1; i <= n; i++) {
    const seat = (fromSeat + i) % n
    if (isPending(state, state.seats[seat])) return seat
  }
  return -1
}

export function legalActions(state: HandState): LegalActions {
  const actor = state.seats[state.actionOn]
  if (!actor || actor.folded || actor.allIn) {
    throw new Error(`座位 ${state.actionOn} 当前不可行动`)
  }
  const toCall = Math.max(0, state.currentBet - actor.committed)
  const callAmount = Math.min(toCall, actor.stack)
  const maxRaiseTo = actor.committed + actor.stack
  const reopenOk = actor.actedAt < 0 || state.currentBet - actor.actedAt >= state.lastFullRaiseSize
  const canRaise = reopenOk && maxRaiseTo > state.currentBet && othersCanRespond(state, actor.seat)
  return {
    canFold: true,
    canCheck: toCall === 0,
    callAmount,
    canRaise,
    isBet: state.currentBet === 0,
    minRaiseTo: Math.min(state.currentBet + state.lastFullRaiseSize, maxRaiseTo),
    maxRaiseTo,
  }
}
