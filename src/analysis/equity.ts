import { evaluate7 } from '../core/evaluator'
import { COMBO_CARDS, cardsToMask } from '../core/handClass'
import { mulberry32, type Rng } from '../core/rng'
import { buildSampler, sampleCombo, type Range, type RangeSampler } from './range'

// equity 计算核心：蒙特卡洛 + 条件精确枚举。同步纯函数，被 Web Worker（HUD）与 AI 决策共用。
// 平局按 1/k 计（k 人平分），多人底池不会算错。

export interface EquityInput {
  hero: [number, number]
  board: readonly number[]
  /** 每个对手一个 1326 权重范围 */
  opponents: readonly Range[]
  /** 额外死牌（除 hero/board 外） */
  dead?: readonly number[]
}

export interface EquityResult {
  /** 英雄赢得底池的期望份额 0..1 */
  equity: number
  /** 平局（与至少一人平分）的发生频率 0..1 */
  tie: number
  /** 蒙特卡洛试验数（精确枚举时为枚举终局数） */
  trials: number
  exact: boolean
}

interface Prepared {
  samplers: RangeSampler[]
  avail: Int32Array // 未知牌（52 - hero - board - dead）
  toCome: number
  deadLo: number
  deadHi: number
}

function prepare(input: EquityInput): Prepared | null {
  const fixed = [input.hero[0], input.hero[1], ...input.board, ...(input.dead ?? [])]
  const { lo, hi } = cardsToMask(fixed)
  const samplers: RangeSampler[] = []
  for (const r of input.opponents) {
    const s = buildSampler(r, lo, hi)
    if (!s) return null // 某对手无可用组合
    samplers.push(s)
  }
  const avail: number[] = []
  for (let c = 0; c < 52; c++) {
    const blocked = c < 32 ? (lo >>> c) & 1 : (hi >>> (c - 32)) & 1
    if (!blocked) avail.push(c)
  }
  return { samplers, avail: Int32Array.from(avail), toCome: 5 - input.board.length, deadLo: lo, deadHi: hi }
}

/** 估算精确枚举的终局数（超过 limit 时返回 Infinity 提前退出） */
export function estimateExactCount(input: EquityInput, limit: number): number {
  const p = prepare(input)
  if (!p) return Infinity
  let count = 1
  for (const s of p.samplers) {
    count *= s.combos.length
    if (count > limit) return Infinity
  }
  // 剩余公共牌组合数 C(n, k)，按对手已占用 2 张/人 的最坏情况估算上界
  const n = p.avail.length - p.samplers.length * 2
  for (let i = 0; i < p.toCome; i++) {
    count = (count * (n - i)) / (i + 1)
    if (count > limit) return Infinity
  }
  return count
}

const boardScratch = new Int32Array(5)

/** 蒙特卡洛：返回累计结果。budgetTrials 为本次试验数。 */
export function equityMC(input: EquityInput, budgetTrials: number, rng?: Rng): EquityResult {
  const p = prepare(input)
  if (!p) return { equity: 0, tie: 0, trials: 0, exact: false }
  const rand = rng ?? mulberry32(0x9527)
  const { samplers, avail, toCome } = p
  const nOpp = samplers.length
  const oppCards = new Int32Array(nOpp * 2)
  const h0 = input.hero[0]
  const h1 = input.hero[1]
  const board = boardScratch
  for (let i = 0; i < input.board.length; i++) board[i] = input.board[i]

  let share = 0
  let tieCount = 0
  let done = 0
  let attempts = 0
  const maxAttempts = budgetTrials * 10 + 100
  outer: while (done < budgetTrials && attempts < maxAttempts) {
    attempts++
    // 1) 为每个对手采样组合，冲突则重采（上限 20 次，超限整个 trial 重来）
    let usedLo = 0
    let usedHi = 0
    for (let o = 0; o < nOpp; o++) {
      let ok = false
      for (let attempt = 0; attempt < 20; attempt++) {
        const combo = sampleCombo(samplers[o], rand())
        const c1 = COMBO_CARDS[combo * 2]
        const c2 = COMBO_CARDS[combo * 2 + 1]
        const b1 = c1 < 32 ? (usedLo >>> c1) & 1 : (usedHi >>> (c1 - 32)) & 1
        const b2 = c2 < 32 ? (usedLo >>> c2) & 1 : (usedHi >>> (c2 - 32)) & 1
        if ((b1 | b2) === 0) {
          if (c1 < 32) usedLo |= 1 << c1
          else usedHi |= 1 << (c1 - 32)
          if (c2 < 32) usedLo |= 1 << c2
          else usedHi |= 1 << (c2 - 32)
          oppCards[o * 2] = c1
          oppCards[o * 2 + 1] = c2
          ok = true
          break
        }
      }
      if (!ok) continue outer
    }
    // 2) 发剩余公共牌（rejection：avail 里再排除对手占用的牌）
    for (let i = 0; i < toCome; i++) {
      for (;;) {
        const c = avail[Math.floor(rand() * avail.length)]
        const used = c < 32 ? (usedLo >>> c) & 1 : (usedHi >>> (c - 32)) & 1
        if (!used) {
          if (c < 32) usedLo |= 1 << c
          else usedHi |= 1 << (c - 32)
          board[input.board.length + i] = c
          break
        }
      }
    }
    // 3) 评估
    const heroScore = evaluate7(h0, h1, board[0], board[1], board[2], board[3], board[4])
    let bestOpp = -1
    for (let o = 0; o < nOpp; o++) {
      const s = evaluate7(oppCards[o * 2], oppCards[o * 2 + 1], board[0], board[1], board[2], board[3], board[4])
      if (s > bestOpp) bestOpp = s
    }
    if (heroScore > bestOpp) {
      share += 1
    } else if (heroScore === bestOpp) {
      let k = 1
      for (let o = 0; o < nOpp; o++) {
        const s = evaluate7(oppCards[o * 2], oppCards[o * 2 + 1], board[0], board[1], board[2], board[3], board[4])
        if (s === heroScore) k++
      }
      share += 1 / k
      tieCount++
    }
    done++
  }
  return { equity: done > 0 ? share / done : 0, tie: done > 0 ? tieCount / done : 0, trials: done, exact: false }
}

/** 精确枚举（调用前先用 estimateExactCount 判断可行性） */
export function equityExact(input: EquityInput): EquityResult {
  const p = prepare(input)
  if (!p) return { equity: 0, tie: 0, trials: 0, exact: true }
  const { samplers, avail, toCome } = p
  const nOpp = samplers.length
  const oppCards = new Int32Array(nOpp * 2)
  const h0 = input.hero[0]
  const h1 = input.hero[1]
  const board = new Int32Array(5)
  for (let i = 0; i < input.board.length; i++) board[i] = input.board[i]

  let shareW = 0
  let tieW = 0
  let totalW = 0
  let terminals = 0

  const evalTerminal = (weight: number) => {
    terminals++
    const heroScore = evaluate7(h0, h1, board[0], board[1], board[2], board[3], board[4])
    let bestOpp = -1
    let bestCount = 0
    for (let o = 0; o < nOpp; o++) {
      const s = evaluate7(oppCards[o * 2], oppCards[o * 2 + 1], board[0], board[1], board[2], board[3], board[4])
      if (s > bestOpp) {
        bestOpp = s
        bestCount = 1
      } else if (s === bestOpp) bestCount++
    }
    totalW += weight
    if (heroScore > bestOpp) shareW += weight
    else if (heroScore === bestOpp) {
      shareW += weight / (bestCount + 1)
      tieW += weight
    }
  }

  // 递归发公共牌（组合而非排列：起始下标递增）
  const dealBoard = (pos: number, startIdx: number, usedLo: number, usedHi: number, weight: number) => {
    if (pos === toCome) {
      evalTerminal(weight)
      return
    }
    for (let i = startIdx; i < avail.length; i++) {
      const c = avail[i]
      const used = c < 32 ? (usedLo >>> c) & 1 : (usedHi >>> (c - 32)) & 1
      if (used) continue
      board[input.board.length + pos] = c
      if (c < 32) dealBoard(pos + 1, i + 1, usedLo | (1 << c), usedHi, weight)
      else dealBoard(pos + 1, i + 1, usedLo, usedHi | (1 << (c - 32)), weight)
    }
  }

  // 递归枚举对手组合（权重相乘）
  const dealOpp = (o: number, usedLo: number, usedHi: number, weight: number) => {
    if (o === nOpp) {
      dealBoard(0, 0, usedLo, usedHi, weight)
      return
    }
    const s = samplers[o]
    for (let i = 0; i < s.combos.length; i++) {
      const combo = s.combos[i]
      const w = i === 0 ? s.cumWeights[0] : s.cumWeights[i] - s.cumWeights[i - 1]
      const c1 = COMBO_CARDS[combo * 2]
      const c2 = COMBO_CARDS[combo * 2 + 1]
      const b1 = c1 < 32 ? (usedLo >>> c1) & 1 : (usedHi >>> (c1 - 32)) & 1
      const b2 = c2 < 32 ? (usedLo >>> c2) & 1 : (usedHi >>> (c2 - 32)) & 1
      if ((b1 | b2) !== 0) continue
      let nl = usedLo
      let nh = usedHi
      if (c1 < 32) nl |= 1 << c1
      else nh |= 1 << (c1 - 32)
      if (c2 < 32) nl |= 1 << c2
      else nh |= 1 << (c2 - 32)
      oppCards[o * 2] = c1
      oppCards[o * 2 + 1] = c2
      dealOpp(o + 1, nl, nh, weight * w)
    }
  }

  dealOpp(0, 0, 0, 1)
  if (totalW === 0) return { equity: 0, tie: 0, trials: terminals, exact: true }
  return { equity: shareW / totalW, tie: tieW / totalW, trials: terminals, exact: true }
}

export const EXACT_LIMIT = 400_000

/** 自动选择：可精确枚举则精确，否则蒙特卡洛 */
export function equityAuto(input: EquityInput, mcTrials: number, rng?: Rng): EquityResult {
  if (estimateExactCount(input, EXACT_LIMIT) <= EXACT_LIMIT) return equityExact(input)
  return equityMC(input, mcTrials, rng)
}

/** 便捷：单对手用具体牌（构造只含一个组合的范围） */
export function rangeOfCombo(c1: number, c2: number): Range {
  const r = new Float64Array(1326)
  const hi = Math.max(c1, c2)
  const lo = Math.min(c1, c2)
  r[(hi * (hi - 1)) / 2 + lo] = 1
  return r
}
