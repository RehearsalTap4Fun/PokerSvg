import { CLASS_OF_COMBO, COMBO_CARDS, COMBO_COUNT, cardsToMask, comboBlocked } from '../core/handClass'

// 范围 = Float64Array(1326) 组合权重（0..1）。
// 选 1326 组合而非 169 类：阻断牌（card removal）与逐组合贝叶斯更新是刚需。
// 169 类仅用于矩阵展示聚合与翻前查表索引。

export type Range = Float64Array

export function uniformRange(): Range {
  return new Float64Array(COMBO_COUNT).fill(1)
}

export function emptyRange(): Range {
  return new Float64Array(COMBO_COUNT)
}

export function cloneRange(r: Range): Range {
  return new Float64Array(r)
}

/** 把与 deadCards 冲突的组合权重清零（原地修改并返回） */
export function removeConflicts(r: Range, deadCards: readonly number[]): Range {
  if (deadCards.length === 0) return r
  const { lo, hi } = cardsToMask(deadCards)
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (r[i] > 0 && comboBlocked(i, lo, hi)) r[i] = 0
  }
  return r
}

export function totalWeight(r: Range): number {
  let s = 0
  for (let i = 0; i < COMBO_COUNT; i++) s += r[i]
  return s
}

/** 归一化到总权重 1（总权重为 0 时原样返回） */
export function normalize(r: Range): Range {
  const s = totalWeight(r)
  if (s > 0) for (let i = 0; i < COMBO_COUNT; i++) r[i] /= s
  return r
}

export interface ClassAggregate {
  /** 每个 169 类的权重和 */
  weightSum: Float64Array
  /** 每个 169 类当前未被 deadCards 阻断的组合数（展示分母） */
  availCount: Float64Array
  /** weightSum / availCount，0..1，矩阵热力值 */
  intensity: Float64Array
}

/** 聚合到 13x13 展示矩阵 */
export function aggregateToClasses(r: Range, deadCards: readonly number[] = []): ClassAggregate {
  const weightSum = new Float64Array(169)
  const availCount = new Float64Array(169)
  const { lo, hi } = cardsToMask(deadCards)
  for (let i = 0; i < COMBO_COUNT; i++) {
    const cls = CLASS_OF_COMBO[i]
    if (!comboBlocked(i, lo, hi)) {
      availCount[cls]++
      weightSum[cls] += r[i]
    }
  }
  const intensity = new Float64Array(169)
  for (let c = 0; c < 169; c++) intensity[c] = availCount[c] > 0 ? Math.min(1, weightSum[c] / availCount[c]) : 0
  return { weightSum, availCount, intensity }
}

// —— 加权采样器：预构建前缀和，O(log n) 采样 ——

export interface RangeSampler {
  combos: Int32Array
  cumWeights: Float64Array
  total: number
}

/** 过滤 deadCards 后构建采样器；返回 null 表示无可用组合 */
export function buildSampler(r: Range, deadLo: number, deadHi: number): RangeSampler | null {
  const combos: number[] = []
  const cum: number[] = []
  let total = 0
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (r[i] > 0 && !comboBlocked(i, deadLo, deadHi)) {
      total += r[i]
      combos.push(i)
      cum.push(total)
    }
  }
  if (combos.length === 0) return null
  return { combos: Int32Array.from(combos), cumWeights: Float64Array.from(cum), total }
}

/** 从采样器中按权重取一个组合索引 */
export function sampleCombo(s: RangeSampler, roll: number): number {
  const target = roll * s.total
  let lo = 0
  let hi = s.cumWeights.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (s.cumWeights[mid] < target) lo = mid + 1
    else hi = mid
  }
  return s.combos[lo]
}

export { COMBO_CARDS }
