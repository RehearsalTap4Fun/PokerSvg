import type { HandState } from '../core/types'
import { currentPot } from '../core/hand'

// ICM（独立筹码模型，Malmuth-Harville）：把筹码分布换算为每人的奖金期望。
// 用于：HUD 的"ICM 口径所需胜率"、赛后复盘的泡沫期 all-in 评价、AI 短码域的风险溢价。
// 9 人 × 3 个奖位，递归深度 = 奖位数，成本可忽略。

/** 每个玩家的奖金期望（与 stacks 同序；stack 为 0 者期望 0） */
export function icmEquities(stacks: readonly number[], payouts: readonly number[]): number[] {
  const n = stacks.length
  const out = new Array<number>(n).fill(0)
  const total = stacks.reduce((s, x) => s + x, 0)
  if (total <= 0) return out
  const places = Math.min(payouts.length, stacks.filter((s) => s > 0).length)
  if (places === 0) return out

  const used = new Array<boolean>(n).fill(false)
  const recurse = (place: number, remaining: number, prob: number): void => {
    if (place >= places || prob <= 0) return
    for (let i = 0; i < n; i++) {
      if (used[i] || stacks[i] <= 0) continue
      const p = (prob * stacks[i]) / remaining
      out[i] += p * payouts[place]
      if (place + 1 < places) {
        used[i] = true
        recurse(place + 1, remaining - stacks[i], p)
        used[i] = false
      }
    }
  }
  recurse(0, total, 1)
  return out
}

/**
 * 面对下注时"跟注所需胜率"的 ICM 口径（假定跟注即摊牌，赢/输全部与最后进攻者结算）。
 * 返回 null 表示无法计算（无进攻者/无需跟注/奖金结构空）。
 */
export function icmRequiredEquity(state: HandState, heroSeat: number, payouts: readonly number[]): number | null {
  const hero = state.seats[heroSeat]
  if (!hero || payouts.length === 0) return null
  const aggr = state.lastAggressor
  if (aggr < 0 || aggr === heroSeat) return null
  const villain = state.seats[aggr]
  if (!villain) return null
  const toCall = Math.min(hero.stack, Math.max(0, state.currentBet - hero.committed))
  if (toCall <= 0) return null
  const pot = currentPot(state)

  const seats = state.seats.filter((s): s is NonNullable<typeof s> => s !== null)
  const idx = new Map<number, number>()
  seats.forEach((s, i) => idx.set(s.seat, i))
  const base = seats.map((s) => s.stack)
  const hi = idx.get(heroSeat)!
  const vi = idx.get(aggr)!

  const win = base.slice()
  win[hi] = hero.stack + pot
  const lose = base.slice()
  lose[hi] = hero.stack - toCall
  lose[vi] = villain.stack + pot + toCall
  const fold = base.slice()
  fold[vi] = villain.stack + pot

  const eqWin = icmEquities(win, payouts)[hi]
  const eqLose = icmEquities(lose, payouts)[hi]
  const eqFold = icmEquities(fold, payouts)[hi]
  if (eqWin - eqLose <= 1e-9) return null
  return Math.min(1, Math.max(0, (eqFold - eqLose) / (eqWin - eqLose)))
}

/** 筹码口径所需胜率与 ICM 口径的差值（风险溢价，≥0 表示 ICM 更苛刻） */
export function icmRiskPremium(state: HandState, heroSeat: number, payouts: readonly number[]): number {
  const hero = state.seats[heroSeat]
  if (!hero) return 0
  const toCall = Math.min(hero.stack, Math.max(0, state.currentBet - hero.committed))
  if (toCall <= 0) return 0
  const chip = toCall / (currentPot(state) + toCall)
  const icm = icmRequiredEquity(state, heroSeat, payouts)
  return icm === null ? 0 : icm - chip
}
