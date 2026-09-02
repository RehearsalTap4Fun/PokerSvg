import { describe, expect, it } from 'vitest'
import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'
import { analyzeTournament } from '../src/analysis/postmortem'
import type { AiStyleId } from '../src/core/types'

// 赛后复盘分析：确定性、统计一致性、发现格式。

const STYLES9: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']

function playFullTournament(seed: number) {
  const cfg = defaultConfig(
    seed,
    STYLES9.map((s, i) => ({ id: `p${i}`, name: `P${i}`, style: s })),
  )
  const gc = new GameController(cfg, -1) // 全 AI；分析时把 seat 0 当作英雄
  let guard = 0
  while (!gc.finished) {
    if (++guard > 800) throw new Error('未结束')
    gc.startNextHand()
    gc.runAiUntilHuman()
  }
  return gc
}

describe('赛后复盘分析', () => {
  it('确定性：同一记录两次分析结果完全一致', () => {
    const gc = playFullTournament(31500)
    const a = analyzeTournament(gc.history, gc.ts.players, 0)
    const b = analyzeTournament(gc.history, gc.ts.players, 0)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  }, 60_000)

  it('统计一致性：VPIP/PFR 与独立事件扫描一致，比率在 [0,1]', () => {
    const gc = playFullTournament(31501)
    const pm = analyzeTournament(gc.history, gc.ts.players, 0)
    const s = pm.stats

    // 独立扫描：seat0 翻前自愿入池/加注（只看每手第一条 street 事件之前的 action）
    let vpip = 0
    let pfr = 0
    let dealt = 0
    for (const rec of gc.history) {
      const start = rec.events[0]
      if (start.t !== 'handStart' || !start.seats.some((x) => x.seat === 0)) continue
      dealt++
      let contributed = false
      let raised = false
      for (const e of rec.events) {
        if (e.t === 'street') break
        if (e.t === 'action' && e.seat === 0) {
          if (e.action.type === 'call' || e.action.type === 'raise' || e.action.type === 'bet') contributed = true
          if (e.action.type === 'raise' || e.action.type === 'bet') raised = true
        }
      }
      if (contributed) vpip++
      if (raised) pfr++
    }
    expect(s.hands).toBe(dealt)
    expect(s.vpip).toBeCloseTo(dealt > 0 ? vpip / dealt : 0, 10)
    expect(s.pfr).toBeCloseTo(dealt > 0 ? pfr / dealt : 0, 10)

    for (const v of [s.vpip, s.pfr, s.sawFlopRate, s.wtsd, s.wsd, s.preflopFoldRate]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(s.rank).not.toBeNull()
    // 盈亏应与名次一致性：冠军净赢 > 0
    if (s.rank === 1) expect(s.netDelta).toBeGreaterThan(0)
  }, 60_000)

  it('发现列表格式：severity 合法、带手号的条目手号存在于历史中', () => {
    const gc = playFullTournament(31502)
    const pm = analyzeTournament(gc.history, gc.ts.players, 0)
    const handNos = new Set(gc.history.map((h) => h.handNo))
    for (const f of pm.findings) {
      expect(['bad', 'warn', 'info', 'good']).toContain(f.severity)
      expect(f.text.length).toBeGreaterThan(6)
      if (f.handNo !== undefined) expect(handNos.has(f.handNo)).toBe(true)
    }
    // 排序：bad → warn → info → good
    const order = pm.findings.map((f) => ({ bad: 0, warn: 1, info: 2, good: 3 })[f.severity])
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  }, 60_000)

  it('对每个座位分析都不抛错（含中途淘汰者）', () => {
    const gc = playFullTournament(31503)
    for (let seat = 0; seat < 9; seat++) {
      const pm = analyzeTournament(gc.history, gc.ts.players, seat)
      expect(pm.stats.hands).toBeGreaterThan(0)
    }
  }, 60_000)
})
