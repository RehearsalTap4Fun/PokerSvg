import { describe, expect, it } from 'vitest'
import { applyAction, setupHand } from '../src/core/hand'
import { strToCards } from '../src/core/cards'
import type { Action, HandSetupInput, HandState } from '../src/core/types'
import type { HandEvent } from '../src/core/events'

function mkDeck(spec: { sb: string; bb: string; btn: string; board: string }): number[] {
  const cards = strToCards(`${spec.sb} ${spec.bb} ${spec.btn} ${spec.board}`)
  const used = new Set(cards)
  for (let c = 0; c < 52; c++) if (!used.has(c)) cards.push(c)
  return cards
}

function setup3(stacks: [number, number, number], blinds = { sb: 10, bb: 20, ante: 0 }, deck?: number[]) {
  const input: HandSetupInput = {
    handNo: 1,
    seed: 999,
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

function playAll(start: { state: HandState; events: HandEvent[] }, actions: Action[]): { state: HandState; events: HandEvent[] } {
  let state = start.state
  const events = [...start.events]
  for (const a of actions) {
    const r = applyAction(state, a)
    state = r.state
    events.push(...r.events)
  }
  return { state, events }
}

describe('整手牌与摊牌', () => {
  it('三层边池归属：最好牌短码只赢主池', () => {
    // A(btn)=AA 100 筹码，B(sb)=KK 300，C(bb)=QQ 300，全员全下
    const deck = mkDeck({ sb: 'Kh Kd', bb: 'Qh Qd', btn: 'Ah Ad', board: '2c 7d 9h 3s 5c' })
    const r = playAll(setup3([100, 300, 300], { sb: 10, bb: 20, ante: 0 }, deck), [
      { type: 'raise', to: 100 }, // btn all-in
      { type: 'raise', to: 300 }, // sb all-in re-raise（增量 200 ≥ 80 完整）
      { type: 'call' }, // bb all-in call
    ])
    expect(r.state.street).toBe('done')
    // 主池 300（100×3）归 AA；边池 400（200×2）归 KK
    const awards = r.events.filter((e) => e.t === 'potAward')
    expect(awards).toContainEqual({ t: 'potAward', potIndex: 0, seat: 0, amount: 300, reason: 'win' })
    expect(awards).toContainEqual({ t: 'potAward', potIndex: 1, seat: 1, amount: 400, reason: 'win' })
    expect(r.state.seats[0]!.stack).toBe(300)
    expect(r.state.seats[1]!.stack).toBe(400)
    expect(r.state.seats[2]!.stack).toBe(0)
    const end = r.events.find((e) => e.t === 'handEnd')
    expect(end).toMatchObject({ busted: [2] })
  })

  it('未被跟注的多余下注退还', () => {
    // btn 加注到 200，sb 只有 80 跟注 all-in，bb 弃牌 → 120 退还 btn
    const deck = mkDeck({ sb: 'Ah Ad', bb: '2h 7d', btn: 'Kh Kd', board: '2c 8d 9h 3s 5c' })
    const r = playAll(setup3([1000, 80, 1000], { sb: 10, bb: 20, ante: 0 }, deck), [
      { type: 'raise', to: 200 }, // btn
      { type: 'call' }, // sb all-in 80
      { type: 'fold' }, // bb
    ])
    expect(r.state.street).toBe('done')
    const awards = r.events.filter((e) => e.t === 'potAward')
    // 退还层：btn 独得 120（uncalled）；主池 180（80×2 + bb 的 20）归 AA（sb）
    expect(awards).toContainEqual({ t: 'potAward', potIndex: 1, seat: 0, amount: 120, reason: 'uncalled' })
    expect(awards).toContainEqual({ t: 'potAward', potIndex: 0, seat: 1, amount: 180, reason: 'win' })
    expect(r.state.seats[0]!.stack).toBe(1000 - 200 + 120)
    expect(r.state.seats[1]!.stack).toBe(180)
  })

  it('平分底池：打板双赢家均分', () => {
    // 公共牌 AKQJT 打板，双方都用公共牌
    const deck = mkDeck({ sb: '2h 3d', bb: '4c 5s', btn: '6h 7d', board: 'As Ks Qd Jc Th' })
    const r = playAll(setup3([500, 500, 500], { sb: 10, bb: 20, ante: 0 }, deck), [
      { type: 'fold' }, // btn 弃
      { type: 'call' }, // sb 补 10
      { type: 'check' }, // bb
      { type: 'check' }, // flop: sb
      { type: 'check' }, // bb
      { type: 'check' }, // turn: sb
      { type: 'check' }, // bb
      { type: 'check' }, // river: sb
      { type: 'check' }, // bb
    ])
    expect(r.state.street).toBe('done')
    // 池 40 平分
    expect(r.state.seats[1]!.stack).toBe(500)
    expect(r.state.seats[2]!.stack).toBe(500)
  })

  it('摊牌顺序：河牌进攻者先亮牌；被压制者 muck', () => {
    // river: sb bet，btn call。sb 是进攻者先亮；btn 牌更差 → muck
    const deck = mkDeck({ sb: 'Ah Ad', bb: '2h 7d', btn: 'Kh Kd', board: '2c 8d 9h 3s 5c' })
    const r = playAll(setup3([500, 500, 500], { sb: 10, bb: 20, ante: 0 }, deck), [
      { type: 'call' }, // btn
      { type: 'call' }, // sb
      { type: 'fold' }, // bb 弃牌
      { type: 'check' }, // flop sb
      { type: 'check' }, // btn
      { type: 'check' }, // turn sb
      { type: 'check' }, // btn
      { type: 'bet', to: 50 }, // river sb 下注
      { type: 'call' }, // btn 跟
    ])
    const shows = r.events.filter((e) => e.t === 'showdown') as Extract<HandEvent, { t: 'showdown' }>[]
    expect(shows).toHaveLength(2)
    expect(shows[0].seat).toBe(1) // 进攻者先亮
    expect(shows[0].reveal).toBe(true)
    expect(shows[1].seat).toBe(0)
    expect(shows[1].reveal).toBe(false) // KK 被 AA 压制 → muck
    expect(shows[0].desc).toBe('一对 A')
  })

  it('无河牌下注时按钮左起先亮牌', () => {
    const deck = mkDeck({ sb: 'Ah Ad', bb: '2h 7d', btn: 'Kh Kd', board: '2c 8d 9h 3s 5c' })
    const r = playAll(setup3([500, 500, 500], { sb: 10, bb: 20, ante: 0 }, deck), [
      { type: 'call' },
      { type: 'call' },
      { type: 'fold' },
      { type: 'check' },
      { type: 'check' },
      { type: 'check' },
      { type: 'check' },
      { type: 'check' },
      { type: 'check' },
    ])
    const shows = r.events.filter((e) => e.t === 'showdown') as Extract<HandEvent, { t: 'showdown' }>[]
    expect(shows[0].seat).toBe(1) // 按钮左起第一个未弃牌者
  })

  it('筹码守恒：一手结束后总量不变', () => {
    const r = playAll(setup3([500, 300, 700]), [
      { type: 'raise', to: 60 },
      { type: 'call' },
      { type: 'call' },
      { type: 'check' }, // flop sb
      { type: 'bet', to: 100 }, // bb
      { type: 'call' }, // btn
      { type: 'fold' }, // sb
      { type: 'check' }, // turn bb
      { type: 'check' }, // btn
      { type: 'bet', to: 140 }, // river bb
      { type: 'fold' }, // btn
    ])
    expect(r.state.street).toBe('done')
    const total = r.state.seats.reduce((s, x) => s + (x ? x.stack : 0), 0)
    expect(total).toBe(1500)
  })

  it('确定性：同一 seed 与动作序列产生完全相同的结果', () => {
    const play = () =>
      playAll(setup3([500, 300, 700]), [
        { type: 'call' },
        { type: 'call' },
        { type: 'check' },
        { type: 'check' },
        { type: 'bet', to: 40 },
        { type: 'call' },
        { type: 'fold' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
      ])
    const a = play()
    const b = play()
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
  })
})
