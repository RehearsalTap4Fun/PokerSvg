import { RANK_CHARS } from '../core/cards'
import { RANK_PCT } from './handRanking'

// 翻前手牌强度百分位与位置体系。
// PERCENTILE[cls] = 该类在"从强到弱累计组合数 / 1326"中的位置（0 = 最强，1 = 最弱），
// 顺序来自 handRanking.ts 的现代排序。范围表本体见 preflopRanges.ts。

export const PERCENTILE: Float64Array = RANK_PCT

// —— 位置体系：按与按钮的距离归为 6 档 ——

export type Position = 'early' | 'middle' | 'late' | 'button' | 'sb' | 'bb'

export const POSITION_ZH: Record<Position, string> = {
  early: '前位',
  middle: '中位',
  late: '后位',
  button: '按钮',
  sb: '小盲',
  bb: '大盲',
}

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
