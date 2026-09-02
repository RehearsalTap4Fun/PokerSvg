import { describe, expect, it } from 'vitest'
import { GameController } from '../src/store/gameController'
import { payoutsFor, presetConfig, seatsFor } from '../src/data/blindSchedule'
import { positionOf } from '../src/ai/preflopCharts'
import { PRO_ROSTER } from '../src/data/aiNames'
import type { AiStyleId } from '../src/core/types'

// 赛制预设：6 人/单挑稀疏座位下的完整比赛、奖金结构、按玩家数计算的位置。

function playPreset(seed: number, size: 9 | 6 | 2, structure: 'standard' | 'turbo' | 'deep') {
  const ais = PRO_ROSTER.slice(0, size - 1)
  const cfg = presetConfig(seed, { size, structure }, [
    { id: 'h', name: 'H', style: 'tag' as AiStyleId },
    ...ais.map((a) => ({ id: a.id, name: a.name, style: a.style })),
  ])
  const gc = new GameController(cfg, -1)
  let guard = 0
  while (!gc.finished) {
    if (++guard > 1500) throw new Error('未在 1500 手内结束')
    gc.startNextHand()
    gc.runAiUntilHuman()
  }
  return gc
}

describe('赛制预设', () => {
  it('奖金结构：9 人 50/30/20；6 人 65/35；单挑赢者全拿；总额 = 买入 × 人数', () => {
    expect(payoutsFor(9)).toEqual([450, 270, 180])
    expect(payoutsFor(6)).toEqual([390, 210])
    expect(payoutsFor(2)).toEqual([200])
    for (const n of [9, 6, 2] as const) expect(payoutsFor(n).reduce((a, b) => a + b, 0)).toBe(100 * n)
  })

  it('稀疏座位：人类固定 0，座位互不重复且在 0-8', () => {
    for (const n of [9, 6, 2] as const) {
      const seats = seatsFor(n)
      expect(seats.length).toBe(n)
      expect(seats[0]).toBe(0)
      expect(new Set(seats).size).toBe(n)
      for (const s of seats) expect(s >= 0 && s <= 8).toBe(true)
    }
  })

  it('6 人桌（稀疏座位）与单挑都能稳定完赛，名次完整、奖金按结构分配', () => {
    for (const [seed, size, st] of [
      [51000, 6, 'standard'],
      [51001, 6, 'turbo'],
      [51002, 2, 'deep'],
      [51003, 2, 'standard'],
    ] as const) {
      const gc = playPreset(seed, size, st)
      const ranks = gc.ts.players.map((p) => p.rank).sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(ranks).toEqual(Array.from({ length: size }, (_, i) => i + 1))
      const prize = gc.ts.players.reduce((s, p) => s + p.prize, 0)
      expect(prize).toBe(100 * size)
      // 座位应与预设一致
      expect(gc.ts.players.map((p) => p.seat).sort((a, b) => a - b)).toEqual([...seatsFor(size)].sort((a, b) => a - b))
    }
  }, 120_000)

  it('位置按"之间的玩家数"计算：稀疏 6 人桌上 CO/HJ 为后位、UTG 为中位', () => {
    // 座位 [0,1,3,5,7,8]，按钮 8：SB=0，BB=1，UTG=3，HJ=5，CO=7
    const occ = [0, 1, 3, 5, 7, 8]
    expect(positionOf(8, 8, 0, 1, occ)).toBe('button')
    expect(positionOf(0, 8, 0, 1, occ)).toBe('sb')
    expect(positionOf(1, 8, 0, 1, occ)).toBe('bb')
    expect(positionOf(7, 8, 0, 1, occ)).toBe('late')
    expect(positionOf(5, 8, 0, 1, occ)).toBe('late')
    expect(positionOf(3, 8, 0, 1, occ)).toBe('middle')
    // 满桌 9 人：UTG(距按钮 6 人) 为前位
    const full = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    expect(positionOf(3, 0, 1, 2, full)).toBe('early')
    expect(positionOf(7, 0, 1, 2, full)).toBe('late')
    expect(positionOf(5, 0, 1, 2, full)).toBe('middle')
  })
})
