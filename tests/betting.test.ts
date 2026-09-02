import { describe, expect, it } from 'vitest'
import { setupHand, applyAction, legalActions } from '../src/core/hand'
import type { Action, HandSetupInput, HandState } from '../src/core/types'
import type { HandEvent } from '../src/core/events'

// 3 人局标准布局：seat0 = 按钮，seat1 = SB，seat2 = BB

function setup3(stacks: [number, number, number], blinds = { sb: 1, bb: 2, ante: 0 }, deck?: number[]) {
  const input: HandSetupInput = {
    handNo: 1,
    seed: 12345,
    level: blinds,
    buttonSeat: 0,
    sbSeat: 1,
    bbSeat: 2,
    seats: [
      { seat: 0, playerId: 'btn', stack: stacks[0] },
      { seat: 1, playerId: 'sb', stack: stacks[1] },
      { seat: 2, playerId: 'bb', stack: stacks[2] },
    ],
    deckOverride: deck,
  }
  return setupHand(input)
}

function act(state: HandState, action: Action): { state: HandState; events: HandEvent[] } {
  return applyAction(state, action)
}

describe('下注规则', () => {
  it('翻前行动顺序：3 人局按钮先行动（UTG=按钮）', () => {
    const { state } = setup3([1000, 1000, 1000])
    expect(state.actionOn).toBe(0)
  })

  it('最小加注累积：raise-to 语义', () => {
    let { state } = setup3([1000, 1000, 1000])
    // bb=2，min raise-to = 4
    expect(legalActions(state).minRaiseTo).toBe(4)
    state = act(state, { type: 'raise', to: 6 }).state // 增量 4
    // 下一位最小 re-raise-to = 6 + 4 = 10
    expect(state.actionOn).toBe(1)
    expect(legalActions(state).minRaiseTo).toBe(10)
  })

  it('BB option：全员平跟后 BB 可过牌或加注', () => {
    let { state } = setup3([1000, 1000, 1000])
    state = act(state, { type: 'call' }).state // btn 平跟
    state = act(state, { type: 'call' }).state // sb 补齐
    expect(state.actionOn).toBe(2)
    const legal = legalActions(state)
    expect(legal.canCheck).toBe(true)
    expect(legal.canRaise).toBe(true)
    const r = act(state, { type: 'check' })
    expect(r.state.street).toBe('flop')
  })

  it('不完整加注不重开已行动者，未行动者仍可加注且最小加注基于完整加注', () => {
    // 翻牌：B(sb) check, C(bb) check, A(btn) bet 100, B all-in 150（增量 50 < 100 不完整）
    let { state } = setup3([1000, 152, 1000])
    state = act(state, { type: 'call' }).state // btn call 2
    state = act(state, { type: 'call' }).state // sb call
    state = act(state, { type: 'check' }).state // bb check → flop
    expect(state.street).toBe('flop')
    expect(state.actionOn).toBe(1) // 翻后 SB 先行动
    state = act(state, { type: 'check' }).state // sb check
    state = act(state, { type: 'check' }).state // bb check
    state = act(state, { type: 'bet', to: 100 }).state // btn bet 100
    expect(state.actionOn).toBe(1)
    state = act(state, { type: 'raise', to: 150 }).state // sb all-in 150，不完整加注
    // bb 尚未对 100 行动过（只 check 过 0）：可加注，min raise-to = 150 + 100 = 250
    expect(state.actionOn).toBe(2)
    const bbLegal = legalActions(state)
    expect(bbLegal.canRaise).toBe(true)
    expect(bbLegal.minRaiseTo).toBe(250)
    state = act(state, { type: 'call' }).state // bb call 150
    // btn 已对自己的 bet 100 行动过，面对累计增量 50 < 100：不可再加注
    expect(state.actionOn).toBe(0)
    const btnLegal = legalActions(state)
    expect(btnLegal.canRaise).toBe(false)
    expect(btnLegal.callAmount).toBe(50)
    expect(() => act(state, { type: 'raise', to: 300 })).toThrow()
  })

  it('多个不足额 all-in 累计构成完整加注后重新开放行动', () => {
    // 4 人局：btn bet 100，sb all-in 160（+60 不完整），bb all-in 230（累计 +130 ≥ 100 → btn 重开）
    // utg 保留筹码使加注有响应对象
    const input: HandSetupInput = {
      handNo: 1,
      seed: 12345,
      level: { sb: 1, bb: 2, ante: 0 },
      buttonSeat: 0,
      sbSeat: 1,
      bbSeat: 2,
      seats: [
        { seat: 0, playerId: 'btn', stack: 1000 },
        { seat: 1, playerId: 'sb', stack: 162 },
        { seat: 2, playerId: 'bb', stack: 232 },
        { seat: 3, playerId: 'utg', stack: 1000 },
      ],
    }
    let { state } = setupHand(input)
    expect(state.actionOn).toBe(3) // 翻前 UTG 先行动
    state = act(state, { type: 'call' }).state // utg
    state = act(state, { type: 'call' }).state // btn
    state = act(state, { type: 'call' }).state // sb
    state = act(state, { type: 'check' }).state // bb → flop
    expect(state.street).toBe('flop')
    state = act(state, { type: 'check' }).state // sb
    state = act(state, { type: 'check' }).state // bb
    state = act(state, { type: 'check' }).state // utg
    state = act(state, { type: 'bet', to: 100 }).state // btn
    state = act(state, { type: 'raise', to: 160 }).state // sb all-in 不完整
    state = act(state, { type: 'raise', to: 230 }).state // bb all-in（累计构成完整加注）
    state = act(state, { type: 'call' }).state // utg call 230
    expect(state.actionOn).toBe(0)
    const legal = legalActions(state)
    // btn 上次行动于 100，累计增量 230 - 100 = 130 >= lastFullRaiseSize 100 → 重开
    expect(legal.canRaise).toBe(true)
    expect(legal.minRaiseTo).toBe(330) // 230 + 100
  })

  it('恰好等额的 all-in 跟注不构成加注、不重开', () => {
    let { state } = setup3([1000, 102, 1000])
    state = act(state, { type: 'call' }).state
    state = act(state, { type: 'call' }).state
    state = act(state, { type: 'check' }).state
    state = act(state, { type: 'check' }).state // sb
    state = act(state, { type: 'check' }).state // bb
    state = act(state, { type: 'bet', to: 100 }).state // btn bet 100
    state = act(state, { type: 'call' }).state // sb all-in call 100（正好）
    expect(state.currentBet).toBe(100)
    expect(state.actionOn).toBe(2)
    state = act(state, { type: 'call' }).state // bb call
    // 三人都行动完毕 → 转牌
    expect(state.street).toBe('turn')
  })

  it('短码 BB：currentBet 仍为完整 BB，其他人需跟满', () => {
    let { state } = setup3([1000, 1000, 30], { sb: 50, bb: 100, ante: 0 })
    const bb = state.seats[2]!
    expect(bb.allIn).toBe(true)
    expect(bb.totalCommitted).toBe(30)
    expect(state.currentBet).toBe(100)
    expect(state.actionOn).toBe(0)
    expect(legalActions(state).callAmount).toBe(100)
    state = act(state, { type: 'call' }).state // btn call 100
    expect(state.actionOn).toBe(1)
    expect(legalActions(state).callAmount).toBe(50) // sb 已投 50，补 50
  })

  it('ante 先扣且计入底池', () => {
    const { state } = setup3([1000, 1000, 1000], { sb: 10, bb: 20, ante: 5 })
    let pot = 0
    for (const s of state.seats) if (s) pot += s.totalCommitted
    expect(pot).toBe(5 * 3 + 10 + 20)
    expect(state.seats[0]!.committed).toBe(0) // ante 不计入本街 committed
    expect(state.seats[1]!.committed).toBe(10)
  })

  it('全员翻前全下：直接发完 5 张并摊牌', () => {
    const { state, events } = (() => {
      let r = setup3([500, 500, 500])
      r = act(r.state, { type: 'raise', to: 500 })
      const events = [...r.events]
      r = act(r.state, { type: 'call' })
      events.push(...r.events)
      r = act(r.state, { type: 'call' })
      events.push(...r.events)
      return { state: r.state, events }
    })()
    expect(state.street).toBe('done')
    expect(state.board).toHaveLength(5)
    const streets = events.filter((e) => e.t === 'street').map((e) => (e as { street: string }).street)
    expect(streets).toEqual(['flop', 'turn', 'river'])
    expect(events.some((e) => e.t === 'showdown')).toBe(true)
  })

  it('walk：全员弃牌 BB 直接收池，无摊牌', () => {
    let r = setup3([1000, 1000, 1000], { sb: 10, bb: 20, ante: 0 })
    r = applyAction(r.state, { type: 'fold' }) // btn
    const r2 = applyAction(r.state, { type: 'fold' }) // sb
    expect(r2.state.street).toBe('done')
    const award = r2.events.find((e) => e.t === 'potAward')
    expect(award).toMatchObject({ seat: 2, amount: 30, reason: 'uncontested' })
    expect(r2.events.some((e) => e.t === 'showdown')).toBe(false)
    expect(r2.state.seats[2]!.stack).toBe(1010)
  })

  it('非法动作必抛：面对下注不可过牌、超范围加注、无注可跟', () => {
    let { state } = setup3([1000, 1000, 1000])
    expect(() => act(state, { type: 'check' })).toThrow() // 面对 BB 不可过牌
    expect(() => act(state, { type: 'raise', to: 3 })).toThrow() // 低于最小加注
    expect(() => act(state, { type: 'raise', to: 2000 })).toThrow() // 超过 all-in
    expect(() => act(state, { type: 'bet', to: 10 })).toThrow() // 已有注应用 raise
    state = act(state, { type: 'call' }).state
    state = act(state, { type: 'call' }).state
    state = act(state, { type: 'check' }).state // → flop
    expect(() => act(state, { type: 'call' })).toThrow() // 无注可跟
    expect(() => act(state, { type: 'raise', to: 10 })).toThrow() // 无注应用 bet
  })

  it('对手全部 all-in 时不可加注（加注无意义）', () => {
    let { state } = setup3([1000, 300, 300])
    state = act(state, { type: 'call' }).state // btn call 2
    state = act(state, { type: 'raise', to: 300 }).state // sb all-in
    state = act(state, { type: 'call' }).state // bb all-in call
    // btn 面对 300：只剩 all-in 对手，可跟注/弃牌但不可加注
    expect(state.actionOn).toBe(0)
    const legal = legalActions(state)
    expect(legal.canRaise).toBe(false)
    expect(legal.callAmount).toBe(298)
  })
})
