import { describe, expect, it } from 'vitest'
import { parseRange, tablePct } from '../src/ai/rangeNotation'
import { HAND_ORDER, RANK_PCT } from '../src/ai/handRanking'
import { BB_DEFEND, CALL_VS_OPEN, RFI, THREEBET, widen, sizeCallMult } from '../src/ai/preflopRanges'
import { classIdOfName } from '../src/core/handClass'
import { policyForCombo, type PublicSituation } from '../src/ai/policy'
import { STYLES } from '../src/ai/styles'
import { CLASS_COMBOS } from '../src/core/handClass'

// 范围记法解析、手牌排序、基准表覆盖率、展开/收窄、翻前策略对开牌者位置与尺度的响应。

const cls = classIdOfName
const combo = (h: string) => CLASS_COMBOS[cls(h)][0]

const BASE: PublicSituation = {
  street: 'preflop',
  position: 'bb',
  line: 'vsOpen',
  toCallBB: 1.5,
  potBB: 4,
  effBB: 75,
  nActive: 2,
  board: [],
  raiseToBB: 2.5,
  aggressorPos: 'button',
  hasAnte: false,
  inPosition: false,
  isAggressor: false,
  barreling: false,
  spr: 20,
  wetness: 0,
  paired: false,
}

describe('范围记法', () => {
  it('对子/后缀+/区间/双色/频率', () => {
    const t = parseRange('TT+, A2s+, KQo, 76s-54s, 88-66:0.5, JT')
    expect(t[cls('AA')]).toBe(1)
    expect(t[cls('TT')]).toBe(1)
    expect(t[cls('99')]).toBe(0)
    expect(t[cls('A2s')]).toBe(1)
    expect(t[cls('AKs')]).toBe(1)
    expect(t[cls('A2o')]).toBe(0)
    expect(t[cls('KQo')]).toBe(1)
    expect(t[cls('KQs')]).toBe(0)
    expect(t[cls('65s')]).toBe(1)
    expect(t[cls('87s')]).toBe(0)
    expect(t[cls('77')]).toBe(0.5)
    expect(t[cls('JTs')]).toBe(1)
    expect(t[cls('JTo')]).toBe(1)
    // 覆盖率：TT+ 5×6=30, A2s+ 12×4=48, KQo 12, 76s-54s 3×4=12, 88-66 半 9, JT 16 = 127
    expect(tablePct(t) * 1326).toBeCloseTo(127, 6)
  })

  it('A9s-A2s 同高张区间；非法记法抛错', () => {
    const t = parseRange('A9s-A2s')
    expect(t[cls('A9s')]).toBe(1)
    expect(t[cls('A2s')]).toBe(1)
    expect(t[cls('ATs')]).toBe(0)
    expect(() => parseRange('AKs-T8s')).toThrow()
    expect(() => parseRange('XYs')).toThrow()
  })
})

describe('手牌排序与基准表', () => {
  it('169 类完整；A5s 强于 A6o、KQo；72o 最弱', () => {
    expect(HAND_ORDER.length).toBe(169)
    expect(RANK_PCT[cls('A5s')]).toBeLessThan(RANK_PCT[cls('A6o')])
    expect(RANK_PCT[cls('A5s')]).toBeLessThan(RANK_PCT[cls('KJo')])
    expect(RANK_PCT[cls('AA')]).toBeLessThan(RANK_PCT[cls('KK')])
    expect(HAND_ORDER[HAND_ORDER.length - 1]).toBe(cls('72o'))
  })

  it('RFI 覆盖率随位置单调变宽，且在常见区间内', () => {
    const e = tablePct(RFI.early)
    const m = tablePct(RFI.middle)
    const l = tablePct(RFI.late)
    const b = tablePct(RFI.button)
    expect(e).toBeGreaterThan(0.1)
    expect(e).toBeLessThan(0.17)
    expect(m).toBeGreaterThan(e)
    expect(l).toBeGreaterThan(m)
    expect(b).toBeGreaterThan(l)
    expect(b).toBeGreaterThan(0.4)
    expect(b).toBeLessThan(0.5)
    expect(tablePct(THREEBET)).toBeGreaterThan(0.04)
    expect(tablePct(THREEBET)).toBeLessThan(0.08)
    expect(tablePct(BB_DEFEND)).toBeGreaterThan(tablePct(CALL_VS_OPEN))
  })

  it('展开保留结构：按钮 ×1.45 后 A5s 仍在、72o 仍不在；收窄 ×0.55 去掉最弱', () => {
    const wide = widen(RFI.button, 1.45)
    expect(wide[cls('A5s')]).toBe(1)
    expect(wide[cls('72o')]).toBe(0)
    expect(tablePct(wide)).toBeGreaterThan(tablePct(RFI.button) * 1.3)
    const tight = widen(RFI.button, 0.55)
    expect(tablePct(tight)).toBeLessThan(tablePct(RFI.button) * 0.65)
    expect(tight[cls('AA')]).toBe(1)
    expect(tight[cls('43s')]).toBe(0)
    // 原表内不在排序前列的手牌被去掉，但排序靠前的保留
    expect(tight[cls('KQo')]).toBeGreaterThan(0)
  })
})

describe('翻前策略对局面的响应', () => {
  const tag = STYLES.tag
  it('BB 面对按钮开牌的防守比面对前位开牌宽', () => {
    let vsBtn = 0
    let vsUtg = 0
    for (const h of ['K9o', 'Q8s', '76s', 'A4o', 'J9o']) {
      const c = combo(h)
      const dB = policyForCombo(tag, { ...BASE, aggressorPos: 'button' }, c)
      const dU = policyForCombo(tag, { ...BASE, aggressorPos: 'early' }, c)
      vsBtn += dB.call + dB.raise
      vsUtg += dU.call + dU.raise
    }
    expect(vsBtn).toBeGreaterThan(vsUtg * 1.3)
  })

  it('面对 5bb 大开牌比面对 2.2bb 小开牌跟注更少', () => {
    let small = 0
    let big = 0
    for (const h of ['K9o', 'Q8s', '76s', 'A4o', 'J9o', '55']) {
      const c = combo(h)
      small += policyForCombo(tag, { ...BASE, raiseToBB: 2.2, toCallBB: 1.2 }, c).call
      big += policyForCombo(tag, { ...BASE, raiseToBB: 5, toCallBB: 4 }, c).call
    }
    expect(sizeCallMult(5)).toBeLessThan(sizeCallMult(2.2))
    expect(big).toBeLessThan(small)
  })

  it('开牌范围结构：按钮 A5s 开、A6o 与 72o 弃；前位 AJo 开、KJo 弃', () => {
    const btn: PublicSituation = { ...BASE, position: 'button', line: 'unopened', aggressorPos: null, toCallBB: 1, raiseToBB: 1 }
    expect(policyForCombo(tag, btn, combo('A5s')).raise).toBeGreaterThan(0.9)
    expect(policyForCombo(tag, btn, combo('72o')).raise).toBeLessThan(0.05)
    const utg: PublicSituation = { ...btn, position: 'early' }
    expect(policyForCombo(tag, utg, combo('AJo')).raise).toBeGreaterThan(0.9)
    expect(policyForCombo(tag, utg, combo('KJo')).raise).toBeLessThan(0.05)
    // 疯鱼在前位也开 KJo
    expect(policyForCombo(STYLES.maniac, utg, combo('KJo')).raise).toBeGreaterThan(0.5)
  })
})
