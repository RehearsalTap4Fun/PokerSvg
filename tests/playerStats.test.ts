import { describe, expect, it } from 'vitest'
import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'
import { handStats, ratesOf } from '../src/analysis/playerStats'
import { analyzeTournament } from '../src/analysis/postmortem'
import { OpponentModel } from '../src/store/opponentModel'
import type { AiStyleId } from '../src/core/types'
import type { HandEvent } from '../src/core/events'

// 行为统计提取：与赛后分析的独立实现一致；对手模型可由历史重建（存档恢复确定性）。

const STYLES9: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']

function play(seed: number, maxHands = 120) {
  const cfg = defaultConfig(
    seed,
    STYLES9.map((s, i) => ({ id: `p${i}`, name: `P${i}`, style: s })),
  )
  const gc = new GameController(cfg, -1)
  let guard = 0
  while (!gc.finished && guard < maxHands) {
    guard++
    gc.startNextHand()
    gc.runAiUntilHuman()
  }
  return gc
}

describe('行为统计与对手模型', () => {
  it('手工事件流：VPIP/PFR/3bet/c-bet/弃牌统计正确', () => {
    // 3 人：座位 0 按钮，1 SB，2 BB。0 open，1 3bet，2 弃，0 跟；翻牌 1 c-bet，0 弃
    const ev: HandEvent[] = [
      {
        t: 'handStart',
        handNo: 1,
        level: { sb: 10, bb: 20, ante: 0 },
        buttonSeat: 0,
        sbSeat: 1,
        bbSeat: 2,
        seats: [
          { seat: 0, playerId: 'a', stack: 1000 },
          { seat: 1, playerId: 'b', stack: 1000 },
          { seat: 2, playerId: 'c', stack: 1000 },
        ],
        seed: 1,
      },
      { t: 'postSB', seat: 1, amount: 10, allIn: false },
      { t: 'postBB', seat: 2, amount: 20, allIn: false },
      { t: 'action', seat: 0, action: { type: 'raise', to: 50 }, paid: 50, allIn: false },
      { t: 'action', seat: 1, action: { type: 'raise', to: 160 }, paid: 150, allIn: false },
      { t: 'action', seat: 2, action: { type: 'fold' }, paid: 0, allIn: false },
      { t: 'action', seat: 0, action: { type: 'call' }, paid: 110, allIn: false },
      { t: 'street', street: 'flop', cards: [0, 5, 9] },
      { t: 'action', seat: 1, action: { type: 'bet', to: 200 }, paid: 200, allIn: false },
      { t: 'action', seat: 0, action: { type: 'fold' }, paid: 0, allIn: false },
      { t: 'potAward', potIndex: 0, seat: 1, amount: 540, reason: 'uncontested' },
      { t: 'handEnd', stacks: [], busted: [] },
    ]
    const st = handStats(ev)
    const a = st.get(0)!
    const b = st.get(1)!
    const c = st.get(2)!
    expect(a.vpip).toBe(1)
    expect(a.pfr).toBe(1)
    expect(a.limpOpp).toBe(1)
    expect(a.limp).toBe(0)
    expect(b.vpip).toBe(1)
    expect(b.pfr).toBe(1)
    expect(b.threeBetOpp).toBe(1)
    expect(b.threeBet).toBe(1)
    expect(c.vpip).toBe(0)
    expect(c.threeBetOpp).toBe(0) // 面对的是 3bet 而非单次 open
    // 翻牌：1 是翻前最后进攻者 → c-bet 机会并执行；0 面对 c-bet 弃牌
    expect(b.cbetOpp).toBe(1)
    expect(b.cbet).toBe(1)
    expect(a.faceCbetOpp).toBe(1)
    expect(a.foldToCbet).toBe(1)
    expect(a.postFaceBet).toBe(1)
    expect(a.postFolds).toBe(1)
    expect(a.sawFlop).toBe(1)
    expect(b.sawFlop).toBe(1)
    expect(c.sawFlop).toBe(0)
    const rb = ratesOf(b)
    expect(rb.cbet).toBe(1)
    expect(rb.threeBet).toBe(1)
  })

  it('整场统计的 VPIP/PFR 与赛后分析的独立扫描一致', () => {
    const gc = play(41000)
    const pm = analyzeTournament(gc.history, gc.ts.players, 0)
    const c = gc.model.counters(0)
    expect(c.hands).toBe(pm.stats.hands)
    expect(c.vpip / c.hands).toBeCloseTo(pm.stats.vpip, 10)
    expect(c.pfr / c.hands).toBeCloseTo(pm.stats.pfr, 10)
    for (const seat of [0, 3, 4]) {
      const r = ratesOf(gc.model.counters(seat))
      for (const v of [r.vpip, r.pfr, r.threeBet, r.limp, r.cbet, r.foldToCbet, r.foldVsBet, r.wtsd, r.wsd]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  }, 60_000)

  it('风格差异可从统计读出：疯鱼 VPIP > 紧凶，跟注站 AF < 松凶', () => {
    let maniac = 0
    let tag = 0
    let stationAf = 0
    let lagAf = 0
    let n = 0
    for (let t = 0; t < 4; t++) {
      const gc = play(42000 + t)
      const r = (s: number) => ratesOf(gc.model.counters(s))
      maniac += r(4).vpip
      tag += (r(0).vpip + r(5).vpip) / 2
      stationAf += (r(3).af + r(8).af) / 2
      lagAf += (r(1).af + r(6).af) / 2
      n++
    }
    expect(maniac / n).toBeGreaterThan(tag / n)
    expect(stationAf / n).toBeLessThan(lagAf / n)
  }, 120_000)

  it('对手模型由历史重建后与实时累计完全一致（存档恢复确定性）', () => {
    const gc = play(43000, 60)
    const rebuilt = new OpponentModel(gc.ts.players)
    for (const h of gc.history) rebuilt.observeHand(h.events)
    for (let seat = 0; seat < 9; seat++) {
      expect(rebuilt.counters(seat)).toEqual(gc.model.counters(seat))
      expect(rebuilt.styleFor(seat)).toEqual(gc.model.styleFor(seat))
    }
  }, 60_000)
})
