// 7 张牌评牌器：位掩码逐类判断 + 两张 8192 项预计算表（启动时生成，约 24KB）。
// 返回 32 位可比分数：score = category<<26 | majorMask<<13 | minorMask，数值越大牌越强。
// 依据：≤7 张牌时同花不可能与葫芦/四条并存，因此有同花时只需再查同花顺。

export const CAT_HIGH = 0
export const CAT_PAIR = 1
export const CAT_TWO_PAIR = 2
export const CAT_TRIPS = 3
export const CAT_STRAIGHT = 4
export const CAT_FLUSH = 5
export const CAT_FULL_HOUSE = 6
export const CAT_QUADS = 7
export const CAT_STRAIGHT_FLUSH = 8

export const CAT_NAMES_ZH = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺']

// STRAIGHT_TABLE[mask13] = 顺子最高牌 rank+1（wheel A-5 为 4，即 rank '5'(3)+1），0 = 无顺子
const STRAIGHT_TABLE = new Int8Array(8192)
// POP[mask13] = 置位数
const POP = new Uint8Array(8192)

{
  for (let m = 1; m < 8192; m++) POP[m] = POP[m >> 1] + (m & 1)
  const WHEEL = (1 << 12) | 0b1111 // A,5,4,3,2
  for (let m = 0; m < 8192; m++) {
    let hi = 0
    for (let high = 12; high >= 4; high--) {
      const need = 0b11111 << (high - 4)
      if ((m & need) === need) {
        hi = high + 1
        break
      }
    }
    if (hi === 0 && (m & WHEEL) === WHEEL) hi = 4 // wheel：5 高顺
    STRAIGHT_TABLE[m] = hi
  }
}

/** 保留 mask 中最高的 n 个置位 */
function topN(mask: number, n: number): number {
  let m = mask
  let c = POP[m]
  while (c > n) {
    m &= m - 1 // 清最低位
    c--
  }
  return m
}

const rcScratch = new Int8Array(13)

/** 7 张牌求最优 5 张的分数。参数展开避免热路径数组分配。 */
export function evaluate7(c0: number, c1: number, c2: number, c3: number, c4: number, c5: number, c6: number): number {
  let sm0 = 0,
    sm1 = 0,
    sm2 = 0,
    sm3 = 0
  let sc0 = 0,
    sc1 = 0,
    sc2 = 0,
    sc3 = 0
  const rc = rcScratch
  rc.fill(0)
  for (let i = 0; i < 7; i++) {
    const c = i === 0 ? c0 : i === 1 ? c1 : i === 2 ? c2 : i === 3 ? c3 : i === 4 ? c4 : i === 5 ? c5 : c6
    const r = c >> 2
    rc[r]++
    const bit = 1 << r
    switch (c & 3) {
      case 0:
        sm0 |= bit
        sc0++
        break
      case 1:
        sm1 |= bit
        sc1++
        break
      case 2:
        sm2 |= bit
        sc2++
        break
      default:
        sm3 |= bit
        sc3++
    }
  }
  const rankMask = sm0 | sm1 | sm2 | sm3

  // 同花 / 同花顺
  const fsMask = sc0 >= 5 ? sm0 : sc1 >= 5 ? sm1 : sc2 >= 5 ? sm2 : sc3 >= 5 ? sm3 : 0
  if (fsMask !== 0) {
    const st = STRAIGHT_TABLE[fsMask]
    if (st !== 0) return (CAT_STRAIGHT_FLUSH << 26) | ((1 << (st - 1)) << 13)
    return (CAT_FLUSH << 26) | topN(fsMask, 5)
  }

  // 扫描点数计数（从大到小记录）
  let quad = -1,
    trips1 = -1,
    trips2 = -1,
    pair1 = -1,
    pair2 = -1
  for (let r = 12; r >= 0; r--) {
    const n = rc[r]
    if (n === 4) quad = r
    else if (n === 3) {
      if (trips1 < 0) trips1 = r
      else if (trips2 < 0) trips2 = r
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r
      else if (pair2 < 0) pair2 = r
    }
  }

  if (quad >= 0) {
    const kick = topN(rankMask & ~(1 << quad), 1)
    return (CAT_QUADS << 26) | ((1 << quad) << 13) | kick
  }
  if (trips1 >= 0 && (trips2 >= 0 || pair1 >= 0)) {
    const pr = trips2 > pair1 ? trips2 : pair1
    return (CAT_FULL_HOUSE << 26) | ((1 << trips1) << 13) | (1 << pr)
  }
  const st = STRAIGHT_TABLE[rankMask]
  if (st !== 0) return (CAT_STRAIGHT << 26) | ((1 << (st - 1)) << 13)
  if (trips1 >= 0) {
    const kick = topN(rankMask & ~(1 << trips1), 2)
    return (CAT_TRIPS << 26) | ((1 << trips1) << 13) | kick
  }
  if (pair2 >= 0) {
    const kick = topN(rankMask & ~(1 << pair1) & ~(1 << pair2), 1)
    return (CAT_TWO_PAIR << 26) | (((1 << pair1) | (1 << pair2)) << 13) | kick
  }
  if (pair1 >= 0) {
    const kick = topN(rankMask & ~(1 << pair1), 3)
    return (CAT_PAIR << 26) | ((1 << pair1) << 13) | kick
  }
  return topN(rankMask, 5)
}

/** 5-7 张牌的通用入口（非热路径：测试、AI 粗评用）。逻辑与 evaluate7 一致，按实际张数计数。 */
export function evaluateCards(cards: readonly number[]): number {
  const n = cards.length
  if (n === 7) return evaluate7(cards[0], cards[1], cards[2], cards[3], cards[4], cards[5], cards[6])
  if (n < 5 || n > 7) throw new Error(`evaluateCards 需要 5-7 张牌，收到 ${n}`)
  const sm = [0, 0, 0, 0]
  const sc = [0, 0, 0, 0]
  const rc = rcScratch
  rc.fill(0)
  for (let i = 0; i < n; i++) {
    const c = cards[i]
    const r = c >> 2
    rc[r]++
    sm[c & 3] |= 1 << r
    sc[c & 3]++
  }
  const rankMask = sm[0] | sm[1] | sm[2] | sm[3]
  const fsMask = sc[0] >= 5 ? sm[0] : sc[1] >= 5 ? sm[1] : sc[2] >= 5 ? sm[2] : sc[3] >= 5 ? sm[3] : 0
  if (fsMask !== 0) {
    const st = STRAIGHT_TABLE[fsMask]
    if (st !== 0) return (CAT_STRAIGHT_FLUSH << 26) | ((1 << (st - 1)) << 13)
    return (CAT_FLUSH << 26) | topN(fsMask, 5)
  }
  let quad = -1,
    trips1 = -1,
    trips2 = -1,
    pair1 = -1,
    pair2 = -1
  for (let r = 12; r >= 0; r--) {
    const k = rc[r]
    if (k === 4) quad = r
    else if (k === 3) {
      if (trips1 < 0) trips1 = r
      else if (trips2 < 0) trips2 = r
    } else if (k === 2) {
      if (pair1 < 0) pair1 = r
      else if (pair2 < 0) pair2 = r
    }
  }
  if (quad >= 0) return (CAT_QUADS << 26) | ((1 << quad) << 13) | topN(rankMask & ~(1 << quad), 1)
  if (trips1 >= 0 && (trips2 >= 0 || pair1 >= 0)) {
    const pr = trips2 > pair1 ? trips2 : pair1
    return (CAT_FULL_HOUSE << 26) | ((1 << trips1) << 13) | (1 << pr)
  }
  const st = STRAIGHT_TABLE[rankMask]
  if (st !== 0) return (CAT_STRAIGHT << 26) | ((1 << (st - 1)) << 13)
  if (trips1 >= 0) return (CAT_TRIPS << 26) | ((1 << trips1) << 13) | topN(rankMask & ~(1 << trips1), 2)
  if (pair2 >= 0)
    return (CAT_TWO_PAIR << 26) | (((1 << pair1) | (1 << pair2)) << 13) | topN(rankMask & ~(1 << pair1) & ~(1 << pair2), 1)
  if (pair1 >= 0) return (CAT_PAIR << 26) | ((1 << pair1) << 13) | topN(rankMask & ~(1 << pair1), 3)
  return topN(rankMask, 5)
}

export const categoryOf = (score: number): number => score >> 26

const RANK_NAMES_ZH = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

function highestBitRank(mask: number): number {
  return 31 - Math.clz32(mask)
}

/** 分数 → 中文描述，如 "两对 K 和 8"、"A 高同花" */
export function describeScore(score: number): string {
  const cat = score >> 26
  const major = (score >> 13) & 0x1fff
  switch (cat) {
    case CAT_STRAIGHT_FLUSH:
      return highestBitRank(major) === 12 ? '皇家同花顺' : `${RANK_NAMES_ZH[highestBitRank(major)]} 高同花顺`
    case CAT_QUADS:
      return `四条 ${RANK_NAMES_ZH[highestBitRank(major)]}`
    case CAT_FULL_HOUSE: {
      const minor = score & 0x1fff
      return `葫芦 ${RANK_NAMES_ZH[highestBitRank(major)]} 带 ${RANK_NAMES_ZH[highestBitRank(minor)]}`
    }
    case CAT_FLUSH:
      return `${RANK_NAMES_ZH[highestBitRank(score & 0x1fff)]} 高同花`
    case CAT_STRAIGHT:
      return `${RANK_NAMES_ZH[highestBitRank(major)]} 高顺子`
    case CAT_TRIPS:
      return `三条 ${RANK_NAMES_ZH[highestBitRank(major)]}`
    case CAT_TWO_PAIR: {
      const hi = highestBitRank(major)
      const lo = highestBitRank(major & ~(1 << hi))
      return `两对 ${RANK_NAMES_ZH[hi]} 和 ${RANK_NAMES_ZH[lo]}`
    }
    case CAT_PAIR:
      return `一对 ${RANK_NAMES_ZH[highestBitRank(major)]}`
    default:
      return `${RANK_NAMES_ZH[highestBitRank(score & 0x1fff)]} 高牌`
  }
}

// —— 测试基准用的朴素实现：C(7,5)=21 次 5 张评估取最大 ——

function evaluate5Naive(c: readonly number[]): number {
  // 直接构造 5 张牌的分数（独立实现，用于对拍）
  const ranks = c.map((x) => x >> 2).sort((a, b) => b - a)
  const suits = c.map((x) => x & 3)
  const isFlush = suits.every((s) => s === suits[0])
  let mask = 0
  for (const r of ranks) mask |= 1 << r
  const st = STRAIGHT_TABLE[mask]
  const isStraight = POP[mask] === 5 && st !== 0
  if (isFlush && isStraight) return (CAT_STRAIGHT_FLUSH << 26) | ((1 << (st - 1)) << 13)
  const cnt = new Map<number, number>()
  for (const r of ranks) cnt.set(r, (cnt.get(r) ?? 0) + 1)
  const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  if (groups[0][1] === 4) return (CAT_QUADS << 26) | ((1 << groups[0][0]) << 13) | (1 << groups[1][0])
  if (groups[0][1] === 3 && groups[1][1] === 2) return (CAT_FULL_HOUSE << 26) | ((1 << groups[0][0]) << 13) | (1 << groups[1][0])
  if (isFlush) return (CAT_FLUSH << 26) | mask
  if (isStraight) return (CAT_STRAIGHT << 26) | ((1 << (st - 1)) << 13)
  if (groups[0][1] === 3) return (CAT_TRIPS << 26) | ((1 << groups[0][0]) << 13) | (1 << groups[1][0]) | (1 << groups[2][0])
  if (groups[0][1] === 2 && groups[1][1] === 2)
    return (CAT_TWO_PAIR << 26) | (((1 << groups[0][0]) | (1 << groups[1][0])) << 13) | (1 << groups[2][0])
  if (groups[0][1] === 2) return (CAT_PAIR << 26) | ((1 << groups[0][0]) << 13) | (mask & ~(1 << groups[0][0]))
  return mask
}

/** 朴素 7 张评估（仅测试对拍用，勿在热路径调用） */
export function evaluate7Naive(cards: readonly number[]): number {
  let best = 0
  for (let i = 0; i < 7; i++)
    for (let j = i + 1; j < 7; j++) {
      const five: number[] = []
      for (let k = 0; k < 7; k++) if (k !== i && k !== j) five.push(cards[k])
      const s = evaluate5Naive(five)
      if (s > best) best = s
    }
  return best
}
