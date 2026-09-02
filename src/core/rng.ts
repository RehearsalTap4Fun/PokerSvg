// 全项目唯一的随机源：mulberry32 种子 PRNG。
// 铁律：任何进入发牌/AI 决策的随机数都必须来自这里且种子可追溯，禁止裸 Math.random()——复盘确定性回放的基石。

export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 混合两个整数得到新种子（如 tournamentSeed 与 handNo） */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** Fisher-Yates 原地洗牌 */
export function shuffleInPlace<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = arr[i]
    arr[i] = arr[j]
    arr[j] = t
  }
  return arr
}

/** 按权重采样下标（权重需非负，和>0） */
export function weightedPick(weights: readonly number[], rng: Rng): number {
  let total = 0
  for (const w of weights) total += w
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

/** 生成一个非确定性的锦标赛种子（仅在开赛时调用一次并记录） */
export function randomSeed(): number {
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
}
