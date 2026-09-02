import { RANK_CHARS } from '../core/cards'
import { CLASS_COMBOS } from '../core/handClass'

// 翻前 169 类手牌强度排序（Chen 公式）→ 组合百分位。
// PERCENTILE[cls] = 该类在"从强到弱累计组合数 / 1326"中的位置（0 = 最强，1 = 最弱）。
// 范围表述统一为百分位阈值："开牌前 20%" 即 PERCENTILE <= 0.20。

function chenScore(classId: number): number {
  const row = Math.floor(classId / 13)
  const col = classId % 13
  const hiRank = 12 - Math.min(row, col) // 0=2 .. 12=A
  const loRank = 12 - Math.max(row, col)
  const suited = row < col
  const pair = row === col

  const cardValue = (r: number): number => {
    if (r === 12) return 10 // A
    if (r === 11) return 8 // K
    if (r === 10) return 7 // Q
    if (r === 9) return 6 // J
    return (r + 2) / 2
  }

  let score = cardValue(hiRank)
  if (pair) return Math.max(5, score * 2)
  if (suited) score += 2
  const gap = hiRank - loRank - 1
  if (gap === 1) score -= 1
  else if (gap === 2) score -= 2
  else if (gap === 3) score -= 4
  else if (gap >= 4) score -= 5
  if (gap <= 1 && hiRank < 10) score += 1 // 0-1 间隔且都低于 Q
  return score
}

export const PERCENTILE = new Float64Array(169)
{
  const order = Array.from({ length: 169 }, (_, i) => i).sort((a, b) => chenScore(b) - chenScore(a) || a - b)
  let cum = 0
  for (const cls of order) {
    const combos = CLASS_COMBOS[cls].length
    // 该类的百分位取其组合区间的中点，避免同分排序造成的硬边界
    PERCENTILE[cls] = (cum + combos / 2) / 1326
    cum += combos
  }
}

// —— 位置体系：按与按钮的距离归为 6 档 ——

export type Position = 'early' | 'middle' | 'late' | 'button' | 'sb' | 'bb'

/** 开局加注（RFI）基准百分位（tag 风格 = 系数 1.0） */
export const OPEN_PCT: Record<Position, number> = {
  early: 0.13,
  middle: 0.18,
  late: 0.26,
  button: 0.42,
  sb: 0.38,
  bb: 0.0, // BB 无人加注时免费看牌，不存在 RFI
}

/** 面对开牌的冷跟基准百分位 */
export const CALL_PCT: Record<Position, number> = {
  early: 0.08,
  middle: 0.1,
  late: 0.13,
  button: 0.17,
  sb: 0.12,
  bb: 0.3, // 大盲防守更宽
}

/** 3bet 基准百分位 */
export const THREEBET_PCT = 0.05
/** 4bet 基准百分位 */
export const FOURBET_PCT = 0.025
/** 面对 3bet 的跟注基准 */
export const CALL_3BET_PCT = 0.09

/**
 * 由座位与按钮/盲注位推导位置档。
 * distance = 按钮后顺时针步数（1=SB, 2=BB, ...）
 */
export function positionOf(seat: number, buttonSeat: number, sbSeat: number | null, bbSeat: number, playersInHand: number): Position {
  if (seat === buttonSeat) return 'button'
  if (seat === sbSeat) return 'sb'
  if (seat === bbSeat) return 'bb'
  // 其余按到按钮的逆时针距离分早中晚
  const dist = (buttonSeat - seat + 9) % 9 // 离按钮越近越晚
  if (playersInHand <= 4) return 'late'
  if (dist <= 2) return 'late'
  if (dist <= 4) return 'middle'
  return 'early'
}

/** 便于测试与展示："前 pct 的手牌类列表" */
export function classesWithinPct(pct: number): string[] {
  const out: string[] = []
  for (let cls = 0; cls < 169; cls++) {
    if (PERCENTILE[cls] <= pct) {
      const row = Math.floor(cls / 13)
      const col = cls % 13
      const hi = RANK_CHARS[12 - Math.min(row, col)]
      const lo = RANK_CHARS[12 - Math.max(row, col)]
      out.push(row === col ? hi + lo : row < col ? hi + lo + 's' : hi + lo + 'o')
    }
  }
  return out
}
