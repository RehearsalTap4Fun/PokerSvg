import { RANK_CHARS, rankOf, suitOf } from './cards'

// 169 手牌类（AKs/AKo/AA…）与 1326 具体组合的双向映射。
// 组合索引约定：两张牌 a > b 时 comboIndex = a*(a-1)/2 + b（0..1325）。
// 13x13 矩阵展示约定：行/列 0 = A（左上角 AA），i<j 上三角 = suited，i>j 下三角 = offsuit。

export const COMBO_COUNT = 1326

export function comboIndex(a: number, b: number): number {
  if (a === b) throw new Error('组合两张牌不能相同')
  const hi = a > b ? a : b
  const lo = a > b ? b : a
  return (hi * (hi - 1)) / 2 + lo
}

/** COMBO_CARDS[idx*2] = 大牌, COMBO_CARDS[idx*2+1] = 小牌 */
export const COMBO_CARDS = new Uint8Array(COMBO_COUNT * 2)
{
  for (let hi = 1; hi < 52; hi++) {
    for (let lo = 0; lo < hi; lo++) {
      const idx = (hi * (hi - 1)) / 2 + lo
      COMBO_CARDS[idx * 2] = hi
      COMBO_CARDS[idx * 2 + 1] = lo
    }
  }
}

/** 矩阵格 id = row*13+col（row/col 0 = A） */
export function classIdOfCombo(comboIdx: number): number {
  const c1 = COMBO_CARDS[comboIdx * 2]
  const c2 = COMBO_CARDS[comboIdx * 2 + 1]
  const r1 = rankOf(c1)
  const r2 = rankOf(c2)
  const hi = Math.max(r1, r2)
  const lo = Math.min(r1, r2)
  if (hi === lo) return (12 - hi) * 13 + (12 - hi)
  const suited = suitOf(c1) === suitOf(c2)
  return suited ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi)
}

/** CLASS_OF_COMBO[comboIdx] = classId，预计算 */
export const CLASS_OF_COMBO = new Uint8Array(COMBO_COUNT)
/** 每个 class 的组合索引列表 */
export const CLASS_COMBOS: number[][] = Array.from({ length: 169 }, () => [])
{
  for (let i = 0; i < COMBO_COUNT; i++) {
    const cls = classIdOfCombo(i)
    CLASS_OF_COMBO[i] = cls
    CLASS_COMBOS[cls].push(i)
  }
}

/** "AKs" / "QJo" / "TT" */
export function className(classId: number): string {
  const row = Math.floor(classId / 13)
  const col = classId % 13
  const rowRank = RANK_CHARS[12 - row]
  const colRank = RANK_CHARS[12 - col]
  if (row === col) return rowRank + colRank
  if (row < col) return rowRank + colRank + 's'
  return colRank + rowRank + 'o'
}

/** "AKs" → classId */
export function classIdOfName(name: string): number {
  const r1 = RANK_CHARS.indexOf(name[0].toUpperCase())
  const r2 = RANK_CHARS.indexOf(name[1].toUpperCase())
  if (r1 < 0 || r2 < 0) throw new Error(`非法手牌类: ${name}`)
  const hi = Math.max(r1, r2)
  const lo = Math.min(r1, r2)
  if (hi === lo) return (12 - hi) * 13 + (12 - hi)
  const suited = name[2]?.toLowerCase() === 's'
  return suited ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi)
}

/** 两张具体牌 → classId */
export function classIdOfCards(a: number, b: number): number {
  return CLASS_OF_COMBO[comboIndex(a, b)]
}

/** 组合是否与给定牌位掩码冲突（mask 为 52 位，用两个 32 位数表示） */
export function comboBlocked(comboIdx: number, maskLo: number, maskHi: number): boolean {
  const c1 = COMBO_CARDS[comboIdx * 2]
  const c2 = COMBO_CARDS[comboIdx * 2 + 1]
  const b1 = c1 < 32 ? (maskLo >>> c1) & 1 : (maskHi >>> (c1 - 32)) & 1
  const b2 = c2 < 32 ? (maskLo >>> c2) & 1 : (maskHi >>> (c2 - 32)) & 1
  return (b1 | b2) === 1
}

/** 牌列表 → 52 位掩码 { lo, hi } */
export function cardsToMask(cards: readonly number[]): { lo: number; hi: number } {
  let lo = 0
  let hi = 0
  for (const c of cards) {
    if (c < 32) lo |= 1 << c
    else hi |= 1 << (c - 32)
  }
  return { lo: lo >>> 0, hi: hi >>> 0 }
}
