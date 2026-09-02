import type { SeatState } from './types'

// 边池构造：按 totalCommitted 分层。
// 每层金额 = 所有玩家（含弃牌者）在该层区间内的投入之和；有资格者 = 投入达到该层上限的未弃牌玩家。
// 未被跟注的多余下注自然形成"只有一人有资格"的最外层池，直接退还（uncalled）。

export interface Pot {
  amount: number
  /** 有资格争夺该池的座位号（未弃牌且投入达到该层） */
  eligible: number[]
}

export function buildPots(seats: readonly (SeatState | null)[]): Pot[] {
  const alive = seats.filter((s): s is SeatState => s !== null)
  const contenders = alive.filter((s) => !s.folded)
  // 分层边界：未弃牌玩家的投入档位
  const levels = [...new Set(contenders.map((s) => s.totalCommitted))].sort((a, b) => a - b)

  const pots: Pot[] = []
  let prev = 0
  for (const level of levels) {
    if (level <= prev) continue
    let amount = 0
    for (const s of alive) amount += Math.max(0, Math.min(s.totalCommitted, level) - prev)
    const eligible = contenders.filter((s) => s.totalCommitted >= level).map((s) => s.seat)
    if (amount > 0) pots.push({ amount, eligible })
    prev = level
  }
  // 弃牌者投入超过所有未弃牌者的部分（真实流程中不会出现，防御性保底）并入最外层池，避免筹码丢失
  let excess = 0
  for (const s of alive) excess += Math.max(0, s.totalCommitted - prev)
  if (excess > 0 && pots.length > 0) pots[pots.length - 1].amount += excess
  return pots
}

/**
 * 平分一个池：base = floor(amount/k)，余数按"按钮左起顺时针"逐个多给 1。
 * winnersInOrder 必须已按按钮左起顺序排列。
 */
export function splitPot(amount: number, winnersInOrder: readonly number[]): Map<number, number> {
  const k = winnersInOrder.length
  const base = Math.floor(amount / k)
  let remainder = amount - base * k
  const out = new Map<number, number>()
  for (const seat of winnersInOrder) {
    out.set(seat, base + (remainder > 0 ? 1 : 0))
    if (remainder > 0) remainder--
  }
  return out
}

/** 从 fromSeat 的下一位开始顺时针枚举 9 个座位号 */
export function seatsClockwiseFrom(fromSeat: number, seatCount = 9): number[] {
  const out: number[] = []
  for (let i = 1; i <= seatCount; i++) out.push((fromSeat + i) % seatCount)
  return out
}
