import { describe, expect, it } from 'vitest'
import { strToCards } from '../src/core/cards'
import { classIdOfName, CLASS_COMBOS } from '../src/core/handClass'
import { mulberry32 } from '../src/core/rng'
import { equityExact, equityMC, equityAuto, rangeOfCombo, estimateExactCount } from '../src/analysis/equity'
import {
  emptyRange,
  uniformRange,
  aggregateToClasses,
  normalize,
  totalWeight,
  removeConflicts,
  buildSampler,
  sampleCombo,
} from '../src/analysis/range'

function comboRange(hand: string) {
  const [a, b] = strToCards(hand)
  return rangeOfCombo(a, b)
}

function classRange(names: string[], weight = 1): Float64Array {
  const r = emptyRange()
  for (const n of names) for (const c of CLASS_COMBOS[classIdOfName(n)]) r[c] = weight
  return r
}

describe('equity 基准对拍', () => {
  it('AA vs KK 翻前 ≈ 0.82（精确枚举）', () => {
    const [h0, h1] = strToCards('Ah Ad')
    const r = equityExact({ hero: [h0, h1], board: [], opponents: [comboRange('KhKd')] })
    expect(r.exact).toBe(true)
    expect(r.equity).toBeGreaterThan(0.805)
    expect(r.equity).toBeLessThan(0.835)
    // 蒙特卡洛与精确一致（±1.5pp）
    const mc = equityMC({ hero: [h0, h1], board: [], opponents: [comboRange('KhKd')] }, 100_000, mulberry32(1))
    expect(Math.abs(mc.equity - r.equity)).toBeLessThan(0.015)
  }, 30_000)

  it('AKs vs QQ ≈ 0.46；22 vs AKo ≈ 0.51', () => {
    const [a0, a1] = strToCards('As Ks')
    const r1 = equityMC({ hero: [a0, a1], board: [], opponents: [comboRange('QhQd')] }, 150_000, mulberry32(2))
    expect(Math.abs(r1.equity - 0.46)).toBeLessThan(0.02)
    const [b0, b1] = strToCards('2h 2d')
    const r2 = equityMC({ hero: [b0, b1], board: [], opponents: [comboRange('AsKc')] }, 150_000, mulberry32(3))
    expect(Math.abs(r2.equity - 0.52)).toBeLessThan(0.02)
  })

  it('AA vs 随机手牌 ≈ 0.85', () => {
    const [h0, h1] = strToCards('Ah Ad')
    const r = equityMC({ hero: [h0, h1], board: [], opponents: [uniformRange()] }, 150_000, mulberry32(4))
    expect(Math.abs(r.equity - 0.852)).toBeLessThan(0.015)
  })

  it('同花听牌翻牌 vs 顶对 ≈ 0.34-0.42（9 outs 两街）', () => {
    // hero: Ah7h，翻牌 Kh 9h 2c，对手 KsQd 顶对
    const [h0, h1] = strToCards('Ah 7h')
    const board = strToCards('Kh 9h 2c')
    const r = equityAuto({ hero: [h0, h1], board, opponents: [comboRange('KsQd')] }, 100_000, mulberry32(5))
    expect(r.equity).toBeGreaterThan(0.3)
    expect(r.equity).toBeLessThan(0.45)
  })

  it('河牌 heads-up 自动走精确枚举', () => {
    const [h0, h1] = strToCards('Ah Ad')
    const board = strToCards('Kh 9h 2c 3d 7s')
    expect(estimateExactCount({ hero: [h0, h1], board, opponents: [uniformRange()] }, 400_000)).toBeLessThan(400_000)
    const r = equityAuto({ hero: [h0, h1], board, opponents: [uniformRange()] }, 1000, mulberry32(6))
    expect(r.exact).toBe(true)
    // AA 高对在此干燥牌面对随机范围 ≈ 0.8934（990 组合中 105 个两对/暗三领先）
    expect(Math.abs(r.equity - 0.8934)).toBeLessThan(0.001)
  })

  it('河牌坚果 equity = 1；被压制 equity = 0', () => {
    // 板面 Kh Qh 9h 3d 7s，hero AhJh = 坚果同花
    const [h0, h1] = strToCards('Ah Jh')
    const board = strToCards('Kh Qh 9h 3d 7s')
    const nuts = equityExact({ hero: [h0, h1], board, opponents: [comboRange('KsKc')] })
    expect(nuts.equity).toBe(1)
    const [w0, w1] = strToCards('2c 2d')
    const crushed = equityExact({ hero: [w0, w1], board, opponents: [comboRange('KsKc')] })
    expect(crushed.equity).toBe(0)
  })

  it('AKo vs AKo：平局率极高，equity ≈ 0.5', () => {
    const [h0, h1] = strToCards('Ah Kd')
    const r = equityExact({ hero: [h0, h1], board: [], opponents: [comboRange('AsKc')] })
    expect(Math.abs(r.equity - 0.5)).toBeLessThan(0.01)
    expect(r.tie).toBeGreaterThan(0.8)
  }, 30_000)

  it('多人底池：AA vs KK vs QQ', () => {
    const [h0, h1] = strToCards('Ah Ad')
    const r = equityMC({ hero: [h0, h1], board: [], opponents: [comboRange('KhKd'), comboRange('QhQd')] }, 100_000, mulberry32(7))
    // AA 三人全下约 0.66-0.70
    expect(r.equity).toBeGreaterThan(0.63)
    expect(r.equity).toBeLessThan(0.73)
  })

  it('加权范围采样频率 ≈ 权重比', () => {
    // 范围 {AA: 1.0, KK: 0.25}，hero 不阻断：AA 6 组合、KK 6 组合 → 期望频率比 6 : 1.5 = 4:1
    const r = classRange(['AA'], 1)
    for (const c of CLASS_COMBOS[classIdOfName('KK')]) r[c] = 0.25
    const sampler = buildSampler(r, 0, 0)!
    const rng = mulberry32(8)
    let aa = 0
    let kk = 0
    const aaSet = new Set(CLASS_COMBOS[classIdOfName('AA')])
    for (let i = 0; i < 40_000; i++) {
      const c = sampleCombo(sampler, rng())
      if (aaSet.has(c)) aa++
      else kk++
    }
    expect(Math.abs(aa / kk - 4)).toBeLessThan(0.3)
  })

  it('范围工具：冲突移除与聚合', () => {
    const r = uniformRange()
    const dead = strToCards('Ah Ad')
    removeConflicts(r, dead)
    expect(totalWeight(r)).toBe(1326 - (51 + 51 - 1)) // 含 Ah 或 Ad 的组合数 = 51+51-1
    const agg = aggregateToClasses(uniformRange(), dead)
    expect(agg.availCount[classIdOfName('AA')]).toBe(1) // 只剩 AcAs
    expect(agg.availCount[classIdOfName('KK')]).toBe(6)
    normalize(r)
    expect(Math.abs(totalWeight(r) - 1)).toBeLessThan(1e-9)
  })
})
