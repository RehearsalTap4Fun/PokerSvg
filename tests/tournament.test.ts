import { describe, expect, it } from 'vitest'
import { applyHandResult, currentLevel, nextHandInput, startTournament } from '../src/core/tournament'
import { setupHand, applyAction } from '../src/core/hand'
import type { HandState, TournamentConfig, TournamentState } from '../src/core/types'

function mkConfig(n: number, handsPerLevel = 2): TournamentConfig {
  return {
    seed: 77,
    startingStack: 1000,
    handsPerLevel,
    levels: [
      { sb: 10, bb: 20, ante: 0 },
      { sb: 20, bb: 40, ante: 0 },
      { sb: 50, bb: 100, ante: 10 },
    ],
    payouts: [500, 300, 200],
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, style: 'tag' as const })),
  }
}

/** 构造一个"已结束"的假 HandState（只填 applyHandResult 需要的字段） */
function fakeHandResult(ts: TournamentState, stacksBySeat: Record<number, { start: number; end: number }>): HandState {
  const seats = new Array(9).fill(null)
  for (const p of ts.players) {
    if (p.rank !== null) continue
    const s = stacksBySeat[p.seat]
    seats[p.seat] = {
      seat: p.seat,
      playerId: p.id,
      startStack: s.start,
      stack: s.end,
      committed: 0,
      totalCommitted: 0,
      holeCards: null,
      folded: false,
      allIn: false,
      actedAt: -1,
    }
  }
  return { seats, street: 'done' } as unknown as HandState
}

describe('锦标赛层', () => {
  it('盲注按手数升级，且只在手与手之间生效', () => {
    let ts = startTournament(mkConfig(3, 2))
    expect(currentLevel(ts)).toEqual({ sb: 10, bb: 20, ante: 0 })
    // 打完 2 手
    for (let i = 0; i < 2; i++) {
      const alive = ts.players.filter((p) => p.rank === null)
      const stacks = Object.fromEntries(alive.map((p) => [p.seat, { start: p.stack, end: p.stack }]))
      ts = applyHandResult(ts, fakeHandResult(ts, stacks))
    }
    expect(currentLevel(ts)).toEqual({ sb: 20, bb: 40, ante: 0 })
    expect(nextHandInput(ts).level.bb).toBe(40)
  })

  it('同手双淘汰：起手筹码少者名次更差', () => {
    let ts = startTournament(mkConfig(4))
    const alive = ts.players.filter((p) => p.rank === null)
    expect(alive).toHaveLength(4)
    const [a, b, c, d] = alive.map((p) => p.seat)
    // b(start 300) 与 c(start 500) 同手出局，d 吃光
    ts = applyHandResult(
      ts,
      fakeHandResult(ts, {
        [a]: { start: 1000, end: 1000 },
        [b]: { start: 300, end: 0 },
        [c]: { start: 500, end: 0 },
        [d]: { start: 2200, end: 3000 },
      }),
    )
    const pb = ts.players.find((p) => p.seat === b)!
    const pc = ts.players.find((p) => p.seat === c)!
    expect(pb.rank).toBe(4) // 起手筹码少 → 第 4 名
    expect(pc.rank).toBe(3)
    expect(pc.prize).toBe(200)
  })

  it('冠军产生与奖金结算', () => {
    let ts = startTournament(mkConfig(3))
    const [a, b, c] = ts.players.map((p) => p.seat)
    ts = applyHandResult(ts, fakeHandResult(ts, { [a]: { start: 1000, end: 0 }, [b]: { start: 1000, end: 2000 }, [c]: { start: 1000, end: 1000 } }))
    expect(ts.finished).toBe(false)
    ts = applyHandResult(ts, fakeHandResult(ts, { [b]: { start: 2000, end: 3000 }, [c]: { start: 1000, end: 0 } }))
    expect(ts.finished).toBe(true)
    const winner = ts.players.find((p) => p.seat === b)!
    expect(winner.rank).toBe(1)
    expect(winner.prize).toBe(500)
    const ranks = ts.players.map((p) => p.rank).sort()
    expect(ranks).toEqual([1, 2, 3])
  })

  it('dead button：SB 玩家淘汰 → 按钮落在空座，无人连坐 BB', () => {
    // 手工构造 4 人局面：btn=0, sb=1, bb=2, utg=3
    let ts = startTournament(mkConfig(4))
    ts = { ...ts, buttonSeat: 0, sbSeat: 1, bbSeat: 2 }
    // seat1（SB）出局
    ts = applyHandResult(
      ts,
      fakeHandResult(ts, {
        0: { start: 1000, end: 1500 },
        1: { start: 500, end: 0 },
        2: { start: 1000, end: 1000 },
        3: { start: 1500, end: 1500 },
      }),
    )
    // 下一手：BB 前移到 3，SB = 原 BB 座位 2，按钮 = 原 SB 座位 1（空座 dead button）
    expect(ts.bbSeat).toBe(3)
    expect(ts.sbSeat).toBe(2)
    expect(ts.buttonSeat).toBe(1)
    const input = nextHandInput(ts)
    expect(input.sbSeat).toBe(2) // seat2 存活，正常付 SB
    // 再打一手无人出局：按钮正常前移到 2
    const alive = ts.players.filter((p) => p.rank === null)
    ts = applyHandResult(ts, fakeHandResult(ts, Object.fromEntries(alive.map((p) => [p.seat, { start: p.stack, end: p.stack }]))))
    expect(ts.bbSeat).toBe(0)
    expect(ts.sbSeat).toBe(3)
    expect(ts.buttonSeat).toBe(2)
  })

  it('dead SB：BB 玩家淘汰 → 下一手无人付小盲', () => {
    let ts = startTournament(mkConfig(4))
    ts = { ...ts, buttonSeat: 0, sbSeat: 1, bbSeat: 2 }
    // seat2（BB）出局
    ts = applyHandResult(
      ts,
      fakeHandResult(ts, {
        0: { start: 1000, end: 1000 },
        1: { start: 1000, end: 2000 },
        2: { start: 1000, end: 0 },
        3: { start: 1000, end: 1000 },
      }),
    )
    expect(ts.bbSeat).toBe(3)
    expect(ts.sbSeat).toBe(2) // 座位 2 已空 → dead SB
    expect(ts.buttonSeat).toBe(1)
    const input = nextHandInput(ts)
    expect(input.sbSeat).toBeNull()
    // setupHand 应无 postSB 事件
    const { events } = setupHand(input)
    expect(events.some((e) => e.t === 'postSB')).toBe(false)
    expect(events.some((e) => e.t === 'postBB')).toBe(true)
  })

  it('3 人变 2 人：heads-up 按钮 = 小盲', () => {
    let ts = startTournament(mkConfig(3))
    ts = { ...ts, buttonSeat: 0, sbSeat: 1, bbSeat: 2 }
    // seat1 出局，剩 0 和 2
    ts = applyHandResult(
      ts,
      fakeHandResult(ts, {
        0: { start: 1000, end: 1500 },
        1: { start: 500, end: 0 },
        2: { start: 1500, end: 1500 },
      }),
    )
    // BB 前移：nextAlive(2) = 0；另一人 2 为 SB 兼按钮
    expect(ts.bbSeat).toBe(0)
    expect(ts.sbSeat).toBe(2)
    expect(ts.buttonSeat).toBe(2)
    // heads-up 翻前小盲（按钮）先行动
    const { state } = setupHand(nextHandInput(ts))
    expect(state.actionOn).toBe(2)
    // 翻后 BB 先行动
    let s = applyAction(state, { type: 'call' }).state
    s = applyAction(s, { type: 'check' }).state
    expect(s.street).toBe('flop')
    expect(s.actionOn).toBe(0)
    // 之后每手按钮轮换
    const alive = ts.players.filter((p) => p.rank === null)
    ts = applyHandResult(ts, fakeHandResult(ts, Object.fromEntries(alive.map((p) => [p.seat, { start: p.stack, end: p.stack }]))))
    expect(ts.bbSeat).toBe(2)
    expect(ts.buttonSeat).toBe(0)
  })
})
