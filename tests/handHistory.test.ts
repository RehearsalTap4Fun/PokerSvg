import { describe, expect, it } from 'vitest'
import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'
import { exportHandHistory } from '../src/store/handHistoryExport'
import { strToCard } from '../src/core/cards'
import type { AiStyleId } from '../src/core/types'

// 手牌历史导出：每手一个 PokerStars 风格块，关键段落齐全，方括号内的牌合法，非上帝视角不泄露未亮出的底牌。

const STYLES9: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']

function play(seed: number, hands: number) {
  const cfg = defaultConfig(
    seed,
    STYLES9.map((s, i) => ({ id: `p${i}`, name: `P${i}`, style: s })),
  )
  const gc = new GameController(cfg, 0)
  let n = 0
  while (!gc.finished && n < hands) {
    n++
    gc.startNextHand()
    // 人类座位 0 由 AI 代打：轮到人类时随机跟注/弃牌
    let guard = 0
    while (gc.hand && gc.hand.street !== 'done' && guard++ < 100) {
      if (gc.isHumanTurn()) {
        const legal = gc.humanLegal()
        gc.act(legal.canCheck ? { type: 'check' } : n % 2 === 0 ? { type: 'call' } : { type: 'fold' })
      } else gc.stepAi()
    }
  }
  return gc
}

describe('手牌历史导出', () => {
  it('段落齐全、手数一致、牌面合法', () => {
    const gc = play(61000, 25)
    const text = exportHandHistory(gc.history, gc.ts, 0, { startTime: new Date('2026-09-02T10:00:00') })
    const blocks = text.trim().split(/\n\n\n/)
    expect(blocks.length).toBe(gc.history.length)
    for (const b of blocks) {
      expect(b).toMatch(/^PokerStars Hand #\d+: Tournament #\d+/)
      expect(b).toContain("Hold'em No Limit")
      expect(b).toContain('is the button')
      expect(b).toContain('*** HOLE CARDS ***')
      if (b.includes('Seat 1: P0 (')) expect(b).toContain('Dealt to P0 [')
      expect(b).toContain('*** SUMMARY ***')
      expect(b).toMatch(/Total pot \d+ \| Rake 0/)
      for (const m of b.matchAll(/\[([^\]]+)\]/g)) {
        for (const c of m[1].split(' ')) expect(() => strToCard(c)).not.toThrow()
      }
    }
    // 总底池 = 该手所有 collected 之和（未被跟注部分已退回）
    for (const b of blocks) {
      const total = Number(/Total pot (\d+)/.exec(b)![1])
      let collected = 0
      for (const m of b.matchAll(/collected (\d+) from/g)) collected += Number(m[1])
      expect(collected).toBe(total)
    }
  }, 60_000)

  it('非上帝视角只写英雄底牌与摊牌亮出的牌；上帝视角写出所有人的底牌', () => {
    const gc = play(61001, 20)
    const std = exportHandHistory(gc.history, gc.ts, 0)
    const god = exportHandHistory(gc.history, gc.ts, 0, { godView: true })
    const dealtStd = (std.match(/^Dealt to /gm) ?? []).length
    const dealtGod = (god.match(/^Dealt to /gm) ?? []).length
    const heroHands = gc.history.filter((h) => h.events[0].t === 'handStart' && h.events[0].seats.some((x) => x.seat === 0)).length
    expect(dealtStd).toBe(heroHands)
    expect(dealtGod).toBeGreaterThan(dealtStd)
    expect(god.length).toBeGreaterThan(std.length)
  }, 60_000)
})
