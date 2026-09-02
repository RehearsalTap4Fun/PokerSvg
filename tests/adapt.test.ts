import { describe, expect, it } from 'vitest'
import { adaptStyle, describeProfile, REF } from '../src/ai/adapt'
import { emptyCounters, ratesOf, type StatCounters } from '../src/analysis/playerStats'
import { STYLES } from '../src/ai/styles'
import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'

// 动态风格推导：样本少贴近先验；松→looseness 升；被动→aggression 降；REF 与紧凶 AI 实测不漂移。

function counters(over: Partial<StatCounters>): StatCounters {
  return { ...emptyCounters(), ...over }
}

describe('对手建模 → 动态风格', () => {
  it('无样本 = 先验；少量样本变化有限', () => {
    const base = STYLES.tag
    expect(adaptStyle(base, emptyCounters())).toEqual(base)
    const few = adaptStyle(base, counters({ hands: 3, vpip: 3, pfr: 3 }))
    expect(few.looseness).toBeGreaterThan(base.looseness)
    expect(few.looseness).toBeLessThan(base.looseness * 1.5)
  })

  it('入池 60% 的疯打者：looseness 显著上升；入池 8% 的岩石：下降', () => {
    const base = STYLES.tag
    const loose = adaptStyle(base, counters({ hands: 100, vpip: 60, pfr: 20 }))
    const tight = adaptStyle(base, counters({ hands: 100, vpip: 8, pfr: 6 }))
    expect(loose.looseness).toBeGreaterThan(1.8)
    expect(tight.looseness).toBeLessThan(0.7)
  })

  it('被动跟注站：aggression 降、callDown 升；面对下注总弃牌：foldToAgg 升', () => {
    const base = STYLES.tag
    const station = adaptStyle(
      base,
      counters({ hands: 100, vpip: 45, pfr: 5, postBets: 5, postCalls: 40, postFaceBet: 50, postFolds: 8, sawFlop: 40, wtsd: 25 }),
    )
    expect(station.aggression).toBeLessThan(base.aggression)
    expect(station.callDown).toBeGreaterThan(base.callDown)
    expect(station.foldToAgg).toBeLessThan(base.foldToAgg)
    const folder = adaptStyle(base, counters({ hands: 100, vpip: 20, pfr: 15, postFaceBet: 40, postFolds: 36 }))
    expect(folder.foldToAgg).toBeGreaterThan(base.foldToAgg)
  })

  it('画像文案：样本少为观察中，松凶样本给出松凶', () => {
    expect(describeProfile(counters({ hands: 2 }), STYLES.tag).quadrant).toBe('观察中')
    const c = counters({ hands: 80, vpip: 40, pfr: 30, postBets: 40, postCalls: 12 })
    expect(describeProfile(c, adaptStyle(STYLES.tag, c)).quadrant).toBe('松凶')
  })

  it('REF 校准：全紧凶桌实测统计与 REF 相差不超过 40%（与 scripts/calibrate.ts 同种子；policy 变动后用它重校）', () => {
    const gcs = Array.from({ length: 6 }, (_, g) => {
      const c = defaultConfig(
        9000 + g * 17,
        Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, name: `X${i}`, style: 'tag' as const })),
      )
      const gc = new GameController(c, -1)
      let guard = 0
      while (!gc.finished && guard < 200) {
        guard++
        gc.startNextHand()
        gc.runAiUntilHuman()
      }
      return gc
    })
    const total = emptyCounters()
    for (const gc of gcs) {
      for (let s = 0; s < 9; s++) {
        const c = gc.model.counters(s)
        for (const k of Object.keys(total) as (keyof StatCounters)[]) total[k] += c[k]
      }
    }
    const r = ratesOf(total)
    const within = (obs: number, ref: number, tol: number) => Math.abs(obs - ref) <= ref * tol
    expect(within(r.vpip, REF.vpip, 0.4), `vpip 实测 ${r.vpip.toFixed(3)} vs REF ${REF.vpip}`).toBe(true)
    expect(within(r.pfr, REF.pfr, 0.4), `pfr 实测 ${r.pfr.toFixed(3)} vs REF ${REF.pfr}`).toBe(true)
    expect(within(r.af, REF.af, 0.4), `af 实测 ${r.af.toFixed(2)} vs REF ${REF.af}`).toBe(true)
    expect(within(r.foldVsBet, REF.foldVsBet, 0.4), `foldVsBet 实测 ${r.foldVsBet.toFixed(3)} vs REF ${REF.foldVsBet}`).toBe(true)
    expect(within(r.wtsd, REF.wtsd, 0.4), `wtsd 实测 ${r.wtsd.toFixed(3)} vs REF ${REF.wtsd}`).toBe(true)
    expect(within(r.cbet, REF.cbet, 0.4), `cbet 实测 ${r.cbet.toFixed(3)} vs REF ${REF.cbet}`).toBe(true)
  }, 120_000)
})
