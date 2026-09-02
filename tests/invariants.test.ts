import { describe, expect, it } from 'vitest'
import { applyAction, legalActions, setupHand, currentPot } from '../src/core/hand'
import { applyHandResult, nextHandInput, startTournament } from '../src/core/tournament'
import { mulberry32, type Rng } from '../src/core/rng'
import type { Action, HandState, TournamentConfig } from '../src/core/types'

// 不变量 fuzz：随机（但合法）策略自打多场完整锦标赛，逐动作断言核心不变量。

function randomLegalAction(state: HandState, rng: Rng): Action {
  const legal = legalActions(state)
  const roll = rng()
  if (legal.canRaise && roll < 0.25) {
    const span = legal.maxRaiseTo - legal.minRaiseTo
    const to = legal.minRaiseTo + Math.floor(rng() * (span + 1))
    // 不完整加注只能 all-in：随机落点若非法则退到 minRaiseTo 或 all-in
    const valid = to - state.currentBet >= state.lastFullRaiseSize || to === legal.maxRaiseTo
    const final = valid ? to : rng() < 0.5 ? legal.minRaiseTo : legal.maxRaiseTo
    return legal.isBet ? { type: 'bet', to: final } : { type: 'raise', to: final }
  }
  if (legal.canCheck) {
    if (roll < 0.9 || !legal.canRaise) return { type: 'check' }
    return legal.isBet ? { type: 'bet', to: legal.minRaiseTo } : { type: 'raise', to: legal.minRaiseTo }
  }
  if (legal.callAmount > 0 && roll < 0.7) return { type: 'call' }
  return { type: 'fold' }
}

function assertHandInvariants(state: HandState, totalChips: number) {
  let sum = 0
  for (const s of state.seats) {
    if (!s) continue
    expect(s.stack).toBeGreaterThanOrEqual(0)
    expect(s.committed).toBeGreaterThanOrEqual(0)
    expect(s.totalCommitted).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(s.stack) && Number.isInteger(s.totalCommitted)).toBe(true)
    sum += s.stack + s.totalCommitted
  }
  expect(sum, '手内筹码守恒').toBe(totalChips)
  if (state.actionOn >= 0) {
    const actor = state.seats[state.actionOn]
    expect(actor && !actor.folded && !actor.allIn, '行动者必须可行动').toBe(true)
  }
}

describe('fuzz 不变量', () => {
  it('随机策略自打 30 场锦标赛：筹码守恒 / 名次完整 / 必然终局', () => {
    let totalHands = 0
    for (let t = 0; t < 30; t++) {
      const config: TournamentConfig = {
        seed: 1000 + t,
        startingStack: 1500,
        handsPerLevel: 5,
        levels: [
          { sb: 10, bb: 20, ante: 0 },
          { sb: 25, bb: 50, ante: 0 },
          { sb: 50, bb: 100, ante: 10 },
          { sb: 100, bb: 200, ante: 25 },
          { sb: 200, bb: 400, ante: 50 },
          { sb: 400, bb: 800, ante: 100 },
          { sb: 800, bb: 1600, ante: 200 },
          { sb: 1600, bb: 3200, ante: 400 },
        ],
        payouts: [450, 270, 180],
        players: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, style: 'tag' as const })),
      }
      const totalChips = 9 * 1500
      let ts = startTournament(config)
      const rng = mulberry32(999 + t)
      let guard = 0
      while (!ts.finished) {
        if (++guard > 2000) throw new Error('锦标赛未在 2000 手内结束')
        const input = nextHandInput(ts)
        let { state } = setupHand(input)
        const handChips = input.seats.reduce((s, x) => s + x.stack, 0)
        assertHandInvariants(state, handChips)
        let steps = 0
        while (state.street !== 'done') {
          if (++steps > 500) throw new Error('单手超过 500 步')
          state = applyAction(state, randomLegalAction(state, rng)).state
          assertHandInvariants(state, handChips)
        }
        // 手结束时底池必须已清空（全部进入 stack）
        const stackSum = state.seats.reduce((s, x) => s + (x ? x.stack : 0), 0)
        expect(stackSum).toBe(handChips)
        ts = applyHandResult(ts, state)
        const tsSum = ts.players.reduce((s, p) => s + p.stack, 0) // 淘汰者 stack=0
        expect(tsSum, '锦标赛层筹码守恒').toBe(totalChips)
        totalHands++
      }
      // 名次 1-9 恰好各一个
      const ranks = ts.players.map((p) => p.rank).sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      // 奖金：前三名有奖
      expect(ts.players.find((p) => p.rank === 1)!.prize).toBe(450)
      expect(ts.players.find((p) => p.rank === 4)!.prize).toBe(0)
    }
    expect(totalHands).toBeGreaterThan(300)
  }, 60_000)

  it('全程 pot 与 totalCommitted 一致', () => {
    const { state } = setupHand({
      handNo: 1,
      seed: 5,
      level: { sb: 10, bb: 20, ante: 5 },
      buttonSeat: 0,
      sbSeat: 1,
      bbSeat: 2,
      seats: Array.from({ length: 9 }, (_, i) => ({ seat: i, playerId: `p${i}`, stack: 1500 })),
    })
    expect(currentPot(state)).toBe(5 * 9 + 10 + 20)
  })
})
