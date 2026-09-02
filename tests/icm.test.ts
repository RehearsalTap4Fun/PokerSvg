import { describe, expect, it } from 'vitest'
import { icmEquities, icmRequiredEquity } from '../src/analysis/icm'
import { setupHand, applyAction } from '../src/core/hand'
import type { HandState } from '../src/core/types'

// ICM：守恒、对称、单调；泡沫期跟注所需胜率高于筹码口径。

const PAYOUTS = [450, 270, 180]

describe('ICM', () => {
  it('奖金期望之和 = 奖池；等筹码时人人相等', () => {
    const eq = icmEquities([1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500], PAYOUTS)
    const sum = eq.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(900, 6)
    for (const e of eq) expect(e).toBeCloseTo(100, 6)
  })

  it('筹码越多期望越高，但边际递减（大码的每筹码价值低于短码）', () => {
    const stacks = [6000, 4000, 2000, 1500]
    const eq = icmEquities(stacks, PAYOUTS)
    expect(eq.reduce((a, b) => a + b, 0)).toBeCloseTo(900, 6)
    expect(eq[0]).toBeGreaterThan(eq[1])
    expect(eq[1]).toBeGreaterThan(eq[2])
    expect(eq[2]).toBeGreaterThan(eq[3])
    // 每筹码价值：短码 > 大码
    expect(eq[3] / stacks[3]).toBeGreaterThan(eq[0] / stacks[0])
  })

  it('已淘汰（0 筹码）者期望为 0；奖位少于人数时只分前几名', () => {
    const eq = icmEquities([5000, 0, 3000, 500], PAYOUTS)
    expect(eq[1]).toBe(0)
    expect(eq.reduce((a, b) => a + b, 0)).toBeCloseTo(900, 6)
    const two = icmEquities([5000, 5000], PAYOUTS)
    // 两人时只剩冠亚军奖金
    expect(two.reduce((a, b) => a + b, 0)).toBeCloseTo(720, 6)
  })

  it('泡沫期（4 人剩 3 个奖位）中等筹码面对大码全下：ICM 口径所需胜率 > 筹码口径', () => {
    // 座位 0 大码 all-in，座位 1（中等码）决策；另有两个短码
    let st: HandState = setupHand({
      handNo: 1,
      seed: 7,
      level: { sb: 100, bb: 200, ante: 0 },
      buttonSeat: 3,
      sbSeat: 0,
      bbSeat: 1,
      seats: [
        { seat: 0, playerId: 'big', stack: 7000 },
        { seat: 1, playerId: 'mid', stack: 3500 },
        { seat: 2, playerId: 'short1', stack: 1500 },
        { seat: 3, playerId: 'short2', stack: 1500 },
      ],
    }).state
    // 翻前顺序：BB 左起 = 座位 2、3、0(SB)、1(BB)
    st = applyAction(st, { type: 'fold' }).state // 2
    st = applyAction(st, { type: 'fold' }).state // 3
    st = applyAction(st, { type: 'raise', to: 7000 }).state // 0 all-in
    expect(st.actionOn).toBe(1)
    const icm = icmRequiredEquity(st, 1, PAYOUTS)
    expect(icm).not.toBeNull()
    const toCall = 7000 - 200 > 3500 - 200 ? 3300 : 0
    const pot = 7000 + 200
    const chip = toCall / (pot + toCall)
    expect(icm!).toBeGreaterThan(chip + 0.05)
    expect(icm!).toBeLessThan(0.95)
  })
})
