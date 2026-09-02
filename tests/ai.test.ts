import { describe, expect, it } from 'vitest'
import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'
import type { AiStyleId, TournamentConfig } from '../src/core/types'
import { CLASS_OF_COMBO, comboIndex } from '../src/core/handClass'
import { aggregateToClasses } from '../src/analysis/range'

// M4 验收：AI 风格一致性、范围推断有效性、决策速度、全 AI 锦标赛稳定完赛。

function mkConfig(seed: number, styles: (AiStyleId | 'human')[]): TournamentConfig {
  const cfg = defaultConfig(
    seed,
    styles.map((s, i) => ({ id: `p${i}`, name: `P${i}`, style: s })),
  )
  return cfg
}

/** 全 AI 自打一场锦标赛，收集统计 */
function playTournament(seed: number, styles: AiStyleId[]) {
  const cfg = mkConfig(seed, styles)
  const gc = new GameController(cfg, -1) // humanSeat=-1：无人类，全 AI
  const stats = styles.map(() => ({ dealt: 0, vpip: 0, pfr: 0 }))
  let guard = 0
  while (!gc.finished) {
    if (++guard > 800) throw new Error('未在 800 手内结束')
    gc.startNextHand()
    const contributed = new Set<number>()
    const raised = new Set<number>()
    gc.runAiUntilHuman()
    for (const e of gc.handEvents) {
      if (e.t === 'action' && (e.action.type === 'call' || e.action.type === 'bet' || e.action.type === 'raise')) {
        // 只统计翻前自愿入池
        contributed.add(e.seat)
        if (e.action.type === 'raise' || e.action.type === 'bet') raised.add(e.seat)
      }
      if (e.t === 'street') break // 只看翻前
    }
    const startEvent = gc.handEvents[0]
    if (startEvent.t === 'handStart') {
      for (const s of startEvent.seats) {
        stats[s.seat].dealt++
        if (contributed.has(s.seat)) stats[s.seat].vpip++
        if (raised.has(s.seat)) stats[s.seat].pfr++
      }
    }
  }
  return { gc, stats }
}

describe('AI 与推断', () => {
  it('全 AI 锦标赛稳定完赛，名次完整', () => {
    for (let t = 0; t < 5; t++) {
      const { gc } = playTournament(4000 + t, ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station'])
      const ranks = gc.ts.players.map((p) => p.rank).sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  }, 120_000)

  it('风格一致性：VPIP 排序 岩石 < 紧凶 < 松凶 < 疯鱼，且数值在合理带内', () => {
    // 9 座位交替风格，跑多场取均值
    const agg: Record<string, { vpip: number; pfr: number; dealt: number }> = {
      tag: { vpip: 0, pfr: 0, dealt: 0 },
      lag: { vpip: 0, pfr: 0, dealt: 0 },
      rock: { vpip: 0, pfr: 0, dealt: 0 },
      station: { vpip: 0, pfr: 0, dealt: 0 },
      maniac: { vpip: 0, pfr: 0, dealt: 0 },
    }
    const styles: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']
    for (let t = 0; t < 12; t++) {
      const { stats } = playTournament(5000 + t * 13, styles)
      styles.forEach((s, i) => {
        agg[s].vpip += stats[i].vpip
        agg[s].pfr += stats[i].pfr
        agg[s].dealt += stats[i].dealt
      })
    }
    const rate = (s: AiStyleId) => ({ vpip: agg[s].vpip / agg[s].dealt, pfr: agg[s].pfr / agg[s].dealt })
    const r = { tag: rate('tag'), lag: rate('lag'), rock: rate('rock'), station: rate('station'), maniac: rate('maniac') }
    // 排序关系（允许锦标赛短码噪声，但方向必须对）
    expect(r.rock.vpip).toBeLessThan(r.tag.vpip)
    expect(r.tag.vpip).toBeLessThan(r.lag.vpip)
    expect(r.lag.vpip).toBeLessThan(r.maniac.vpip)
    expect(r.station.vpip).toBeGreaterThan(r.tag.vpip)
    // 跟注站极少主动加注
    expect(r.station.pfr).toBeLessThan(r.tag.pfr)
    // 合理带（锦标赛含短码推拉，整体会比现金局宽）
    expect(r.rock.vpip).toBeGreaterThan(0.05)
    expect(r.rock.vpip).toBeLessThan(0.3)
    expect(r.maniac.vpip).toBeGreaterThan(0.35)
  }, 240_000)

  it('推断有效性：摊牌者的真实手牌在推断范围中的强度分位显著优于均匀', () => {
    // 到摊牌时，用"posterior 中权重高于真实手牌类的组合占比"衡量：越小说明推断越指向真实手牌
    const styles: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']
    let quantileSum = 0
    let n = 0
    for (let t = 0; t < 6; t++) {
      const cfg = mkConfig(6000 + t * 7, styles)
      const gc = new GameController(cfg, -1)
      let guard = 0
      while (!gc.finished && n < 400) {
        if (++guard > 800) break
        gc.startNextHand()
        // 在 AI 行动完后（本手打完）检查摊牌者
        const preRanges = gc.ranges // 引用同一批对象：act 内实时更新
        gc.runAiUntilHuman()
        for (const e of gc.handEvents) {
          if (e.t !== 'showdown') continue
          const r = preRanges.get(e.seat)
          if (!r) continue
          const trueCombo = comboIndex(e.cards[0], e.cards[1])
          const trueClass = CLASS_OF_COMBO[trueCombo]
          const agg2 = aggregateToClasses(r)
          const trueW = agg2.intensity[trueClass]
          let above = 0
          let equal = 0
          let total = 0
          for (let c = 0; c < 169; c++) {
            if (agg2.availCount[c] === 0) continue
            total++
            if (agg2.intensity[c] > trueW) above++
            else if (agg2.intensity[c] === trueW) equal++
          }
          if (total > 0) {
            // mid-rank：均匀分布（全并列）时分位 ≈ 0.5
            quantileSum += (above + 0.5 * Math.max(0, equal - 1)) / total
            n++
          }
        }
      }
    }
    expect(n).toBeGreaterThan(50)
    const avgQuantile = quantileSum / n
    // 均匀分布下期望 ≈ 0.5（真实手牌类的热度排名随机）；推断有效应显著小于 0.45
    expect(avgQuantile, `平均分位 ${avgQuantile.toFixed(3)}（样本 ${n}）`).toBeLessThan(0.45)
  }, 240_000)

  it('决策速度：平均 < 50ms，最大 < 300ms', () => {
    const styles: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']
    const cfg = mkConfig(7100, styles)
    const gc = new GameController(cfg, -1)
    const times: number[] = []
    let guard = 0
    while (!gc.finished && times.length < 400) {
      if (++guard > 800) break
      gc.startNextHand()
      while (gc.hand && gc.hand.street !== 'done') {
        const t0 = performance.now()
        const r = gc.stepAi()
        times.push(performance.now() - t0)
        if (r === null) break
      }
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const max = Math.max(...times)
    expect(avg, `平均 ${avg.toFixed(1)}ms`).toBeLessThan(50)
    expect(max, `最大 ${max.toFixed(1)}ms`).toBeLessThan(300)
  }, 120_000)

  it('确定性：同一种子的锦标赛完全可复现', () => {
    const styles: AiStyleId[] = ['tag', 'lag', 'rock', 'station', 'maniac', 'tag', 'lag', 'rock', 'station']
    const play = () => {
      const gc = new GameController(mkConfig(8200, styles), -1)
      let guard = 0
      while (!gc.finished) {
        if (++guard > 800) throw new Error('未结束')
        gc.startNextHand()
        gc.runAiUntilHuman()
      }
      return gc.ts.players.map((p) => `${p.seat}:${p.rank}`).join(',')
    }
    expect(play()).toBe(play())
  }, 120_000)
})
