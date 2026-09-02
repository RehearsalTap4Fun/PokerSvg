import { describe, expect, it } from 'vitest'
import { STYLES } from '../src/ai/styles'
import { PRO_ROSTER, AI_ROSTER } from '../src/data/aiNames'
import { policyForCombo, type PublicSituation } from '../src/ai/policy'
import { classIdOfName, CLASS_COMBOS } from '../src/core/handClass'
import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'

// 传奇选手 AI：注册完整性、策略分布有效性、松紧关系、整场稳定性。

const SIT_UNOPENED: PublicSituation = {
  street: 'preflop',
  position: 'button',
  line: 'unopened',
  toCallBB: 1,
  potBB: 1.5,
  effBB: 75,
  nActive: 9,
  board: [],
}

function openProb(styleId: keyof typeof STYLES, hand: string): number {
  const combo = CLASS_COMBOS[classIdOfName(hand)][0]
  return policyForCombo(STYLES[styleId], SIT_UNOPENED, combo).raise
}

describe('传奇选手 AI', () => {
  it('阵容中的每个风格都已注册且参数有效', () => {
    for (const seat of [...PRO_ROSTER, ...AI_ROSTER]) {
      const st = STYLES[seat.style]
      expect(st, `${seat.name} 的风格 ${seat.style}`).toBeDefined()
      expect(st.looseness).toBeGreaterThan(0)
      expect(st.aggression).toBeGreaterThan(0)
      expect(st.bluffFreq).toBeGreaterThanOrEqual(0)
      expect(st.bluffFreq).toBeLessThan(1)
      expect(st.openSize).toBeGreaterThanOrEqual(2)
      expect(st.desc.length).toBeGreaterThan(4)
    }
    // 传奇桌 8 人风格互不相同
    expect(new Set(PRO_ROSTER.map((p) => p.style)).size).toBe(8)
  })

  it('策略分布归一且合法', () => {
    const hands = ['AA', 'A5s', 'K9o', '76s', '72o']
    for (const seat of PRO_ROSTER) {
      for (const h of hands) {
        const d = policyForCombo(STYLES[seat.style], SIT_UNOPENED, CLASS_COMBOS[classIdOfName(h)][0])
        const sum = d.fold + d.check + d.call + d.raise
        expect(Math.abs(sum - 1), `${seat.style} ${h}`).toBeLessThan(1e-9)
        expect(Math.min(d.fold, d.check, d.call, d.raise)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('松紧关系符合人设：赫尔穆斯 < 陈强尼 ≤ 艾维 < 德万 ≤ Isildur（按钮开牌 K9o/76s）', () => {
    for (const hand of ['K9o', '76s']) {
      const hellmuth = openProb('hellmuth', hand)
      const chan = openProb('chan', hand)
      const ivey = openProb('ivey', hand)
      const dwan = openProb('dwan', hand)
      const isildur = openProb('isildur', hand)
      expect(hellmuth, `${hand} hellmuth<=chan`).toBeLessThanOrEqual(chan)
      expect(chan, `${hand} chan<=ivey`).toBeLessThanOrEqual(ivey)
      expect(ivey, `${hand} ivey<=dwan`).toBeLessThanOrEqual(dwan)
      expect(dwan, `${hand} dwan<=isildur`).toBeLessThanOrEqual(isildur)
    }
    // AA 人人都打
    for (const seat of PRO_ROSTER) expect(openProb(seat.style, 'AA')).toBeGreaterThan(0.9)
  })

  it('传奇桌全 AI 锦标赛稳定完赛', () => {
    for (let t = 0; t < 3; t++) {
      const cfg = defaultConfig(
        9100 + t,
        [{ id: 'human-as-ai', name: 'H', style: 'tag' as const }, ...PRO_ROSTER.map((p) => ({ id: p.id, name: p.name, style: p.style }))],
      )
      const gc = new GameController(cfg, -1)
      let guard = 0
      while (!gc.finished) {
        if (++guard > 800) throw new Error('未在 800 手内结束')
        gc.startNextHand()
        gc.runAiUntilHuman()
      }
      const ranks = gc.ts.players.map((p) => p.rank).sort((a, b) => (a ?? 0) - (b ?? 0))
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  }, 120_000)
})
