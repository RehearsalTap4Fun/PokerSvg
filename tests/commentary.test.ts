import { describe, expect, it } from 'vitest'
import { applyAction, setupHand } from '../src/core/hand'
import { strToCards } from '../src/core/cards'
import { mixSeed, mulberry32 } from '../src/core/rng'
import type { Action, HandSetupInput, HandState } from '../src/core/types'
import { initialRange } from '../src/analysis/inference'
import type { Range } from '../src/analysis/range'
import { commentOnAction, MARK_LABEL, type CommentContext } from '../src/analysis/commentary'
import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'
import { decideAi } from '../src/ai/decide'
import type { AiStyleId } from '../src/core/types'

// 观察员点评：确定性、关键局面评级方向、全场烟雾测试（不抛错、文本完整）。

function mkDeck(spec: { sb: string; bb: string; btn: string; board: string }): number[] {
  const cards = strToCards(`${spec.sb} ${spec.bb} ${spec.btn} ${spec.board}`)
  const used = new Set(cards)
  for (let c = 0; c < 52; c++) if (!used.has(c)) cards.push(c)
  return cards
}

function setup3(stacks: [number, number, number], deck: number[]): HandState {
  const input: HandSetupInput = {
    handNo: 1,
    seed: 4242,
    level: { sb: 10, bb: 20, ante: 0 },
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
  return setupHand(input).state
}

function play(state: HandState, actions: Action[]): HandState {
  for (const a of actions) state = applyAction(state, a).state
  return state
}

function ctxFor(state: HandState, action: Action): CommentContext {
  const ranges = new Map<number, Range>()
  for (const s of state.seats) if (s) ranges.set(s.seat, initialRange())
  return { state, seat: state.actionOn, action, ranges, payouts: [450, 270, 180], eventIdx: 10 }
}

const DECK = mkDeck({ sb: 'Kh Qd', bb: '9c 9d', btn: 'Ah As', board: '2c 7d Jh 3s 5c' })

describe('观察员点评', () => {
  it('确定性：同一局面两次点评完全一致', () => {
    const s = setup3([2000, 2000, 2000], DECK)
    const a = commentOnAction(ctxFor(s, { type: 'raise', to: 50 }))
    const b = commentOnAction(ctxFor(s, { type: 'raise', to: 50 }))
    expect(a).not.toBeNull()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('按钮位弃掉 AA 是败着，正常开池是本手', () => {
    const s = setup3([2000, 2000, 2000], DECK)
    expect(s.actionOn).toBe(0)
    expect(commentOnAction(ctxFor(s, { type: 'fold' }))!.mark).toBe('??')
    const open = commentOnAction(ctxFor(s, { type: 'raise', to: 50 }))!
    expect(['', '!']).toContain(open.mark)
    expect(open.head).toContain('翻前')
  })

  it('垃圾牌弃牌是本手', () => {
    const deck = mkDeck({ sb: 'Kh Qd', bb: '9c 9d', btn: '7h 2s', board: '2c 7d Jh 3s 5c' })
    const s = setup3([2000, 2000, 2000], deck)
    expect(commentOnAction(ctxFor(s, { type: 'fold' }))!.mark).toBe('')
  })

  it('能免费过牌却弃牌是败着', () => {
    // 按钮跟、小盲补、大盲过 → 翻牌小盲先行动
    const s = play(setup3([2000, 2000, 2000], DECK), [{ type: 'call' }, { type: 'call' }, { type: 'check' }])
    expect(s.street).toBe('flop')
    expect(s.actionOn).toBe(1)
    expect(commentOnAction(ctxFor(s, { type: 'fold' }))!.mark).toBe('??')
  })

  it('短码用强牌全下是好棋，弃掉是恶手', () => {
    const deck = mkDeck({ sb: 'Kh Qd', bb: '9c 9d', btn: 'Ac Kd', board: '2c 7d Jh 3s 5c' })
    const s = setup3([150, 2000, 2000], deck)
    expect(commentOnAction(ctxFor(s, { type: 'raise', to: 150 }))!.mark).toBe('!')
    expect(commentOnAction(ctxFor(s, { type: 'fold' }))!.mark).toBe('?')
  })

  it('河牌坚果过牌被判为错失价值', () => {
    // 按钮 AA 在 A 高牌面一路过牌到河牌（三条 A），轮到按钮最后行动
    const deck = mkDeck({ sb: 'Kh Qd', bb: '9c 9d', btn: 'Ah As', board: 'Ac 7d 2h 3s 8c' })
    let s = play(setup3([2000, 2000, 2000], deck), [{ type: 'call' }, { type: 'call' }, { type: 'check' }])
    for (let i = 0; i < 6; i++) s = play(s, [{ type: 'check' }])
    expect(s.street).toBe('river')
    s = play(s, [{ type: 'check' }, { type: 'check' }])
    expect(s.actionOn).toBe(0)
    expect(commentOnAction(ctxFor(s, { type: 'check' }))!.mark).toBe('?')
  })

  it('全场烟雾测试：座位 0 的每次行动都能生成完整点评', () => {
    const styles: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']
    const cfg = defaultConfig(
      52700,
      styles.map((s, i) => ({ id: `p${i}`, name: `P${i}`, style: s })),
    )
    const gc = new GameController(cfg, -1)
    const marks = new Map<string, number>()
    let count = 0
    let guard = 0
    while (!gc.finished && gc.ts.players[0].rank === null) {
      if (++guard > 400) break
      gc.startNextHand()
      let n = 0
      while (gc.hand && gc.hand.street !== 'done' && gc.hand.actionOn >= 0) {
        if (++n > 200) throw new Error('行动过多')
        const h = gc.hand
        if (h.actionOn !== 0) {
          gc.stepAi()
          continue
        }
        const action = decideAi({
          state: h,
          seat: 0,
          style: gc.model.styleFor(0),
          ranges: gc.ranges,
          rng: mulberry32(mixSeed(h.seed, 0xabc + n)),
          styleFor: (s) => gc.model.styleFor(s),
          payouts: cfg.payouts,
        })
        const c = commentOnAction({
          state: h,
          seat: 0,
          action,
          ranges: gc.ranges,
          payouts: cfg.payouts,
          eventIdx: gc.handEvents.length,
          styleFor: (s) => gc.model.styleFor(s),
          nameOf: (s) => `P${s}`,
        })
        expect(c).not.toBeNull()
        expect(Object.keys(MARK_LABEL)).toContain(c!.mark)
        expect(c!.text.length).toBeGreaterThan(4)
        expect(c!.text + c!.head).not.toMatch(/undefined|NaN|null|Infinity/)
        marks.set(c!.mark, (marks.get(c!.mark) ?? 0) + 1)
        count++
        gc.act(action)
      }
    }
    expect(count).toBeGreaterThan(20)
    // 紧凶 AI 自己打出来的动作，绝大多数应被判为本手/好棋
    const bad = (marks.get('?') ?? 0) + (marks.get('??') ?? 0)
    expect(bad / count).toBeLessThan(0.15)
  }, 60_000)
})
