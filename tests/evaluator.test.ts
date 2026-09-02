import { describe, expect, it } from 'vitest'
import { strToCards } from '../src/core/cards'
import {
  CAT_FLUSH,
  CAT_FULL_HOUSE,
  CAT_HIGH,
  CAT_PAIR,
  CAT_QUADS,
  CAT_STRAIGHT,
  CAT_STRAIGHT_FLUSH,
  CAT_TRIPS,
  CAT_TWO_PAIR,
  categoryOf,
  describeScore,
  evaluate7Naive,
  evaluateCards,
} from '../src/core/evaluator'
import { mulberry32, shuffleInPlace } from '../src/core/rng'
import { freshDeck } from '../src/core/cards'

const evalStr = (s: string) => evaluateCards(strToCards(s))

describe('evaluator known cases', () => {
  it('皇家同花顺', () => {
    const s = evalStr('As Ks Qs Js Ts 2d 3c')
    expect(categoryOf(s)).toBe(CAT_STRAIGHT_FLUSH)
    expect(describeScore(s)).toBe('皇家同花顺')
  })

  it('轮子同花顺 A2345', () => {
    const s = evalStr('Ah 2h 3h 4h 5h Kd Qc')
    expect(categoryOf(s)).toBe(CAT_STRAIGHT_FLUSH)
    // 5 高同花顺应小于 6 高同花顺
    const s6 = evalStr('2h 3h 4h 5h 6h Kd Qc')
    expect(s6).toBeGreaterThan(s)
  })

  it('轮子顺 A2345 且 A 只当小', () => {
    const s = evalStr('Ah 2d 3c 4s 5h Kd Kc')
    expect(categoryOf(s)).toBe(CAT_STRAIGHT)
    const s6 = evalStr('2d 3c 4s 5h 6d Kd Kc')
    expect(s6).toBeGreaterThan(s)
  })

  it('K 高同花 vs A 高顺子：同花赢', () => {
    const flush = evalStr('Kh 9h 7h 5h 2h As Kd')
    const straight = evalStr('As Kd Qc Js Th 2h 3h')
    expect(categoryOf(flush)).toBe(CAT_FLUSH)
    expect(categoryOf(straight)).toBe(CAT_STRAIGHT)
    expect(flush).toBeGreaterThan(straight)
  })

  it('葫芦：三条部分优先', () => {
    const small = evalStr('2h 2d 2c As Ad 9h 8h') // 222AA
    const big = evalStr('3h 3d 3c 2s 2d 9h 8h') // 33322
    expect(categoryOf(small)).toBe(CAT_FULL_HOUSE)
    expect(big).toBeGreaterThan(small)
  })

  it('7 张含双三条 → 大三条 + 小三条当对', () => {
    const s = evalStr('7h 7d 7c 5s 5d 5c Kh')
    expect(categoryOf(s)).toBe(CAT_FULL_HOUSE)
    expect(describeScore(s)).toBe('葫芦 7 带 5')
  })

  it('两对踢脚：第三对点数可作踢脚', () => {
    const a = evalStr('Ah Ad Kh Kd Qh Qd 2c') // AAKK + Q 踢
    const b = evalStr('Ah Ad Kh Kd Jh 3d 2c') // AAKK + J 踢
    expect(categoryOf(a)).toBe(CAT_TWO_PAIR)
    expect(a).toBeGreaterThan(b)
  })

  it('打板：最优五张全在公共牌，双方平分', () => {
    const board = 'As Ks Qs Js Tc'
    const a = evalStr(`2h 3d ${board}`)
    const b = evalStr(`7c 8c ${board}`)
    expect(a).toBe(b)
    expect(categoryOf(a)).toBe(CAT_STRAIGHT)
  })

  it('四条带踢脚', () => {
    const a = evalStr('9h 9d 9c 9s Ah 2d 3c')
    const b = evalStr('9h 9d 9c 9s Kh Qd Jc')
    expect(categoryOf(a)).toBe(CAT_QUADS)
    expect(a).toBeGreaterThan(b)
  })

  it('7 张中两花色各 4 张不可能，但 4+3 时取 5 张同花正确', () => {
    // 4 张红桃 + 3 张方块：无同花
    const s = evalStr('Ah Kh Qh Jh Ad Kd Qd')
    expect(categoryOf(s)).toBe(CAT_TWO_PAIR)
  })

  it('基本类别判定', () => {
    expect(categoryOf(evalStr('Ah Kd Qc Js 9h 2d 3c'))).toBe(CAT_HIGH)
    expect(categoryOf(evalStr('Ah Ad Qc Js 9h 2d 3c'))).toBe(CAT_PAIR)
    expect(categoryOf(evalStr('Ah Ad Ac Js 9h 2d 3c'))).toBe(CAT_TRIPS)
  })

  it('同花踢脚逐张比较', () => {
    const a = evalStr('Ah Kh Qh Jh 9h 2d 3c')
    const b = evalStr('Ah Kh Qh Jh 8h 2d 3c')
    expect(a).toBeGreaterThan(b)
  })
})

describe('evaluator cross-validation vs naive', () => {
  it('随机 20 万副 7 张与朴素实现一致', () => {
    const rng = mulberry32(20260827)
    const deck = freshDeck()
    for (let n = 0; n < 200_000; n++) {
      shuffleInPlace(deck, rng)
      const seven = deck.slice(0, 7)
      const fast = evaluateCards(seven)
      const naive = evaluate7Naive(seven)
      if (fast !== naive) {
        expect.fail(`不一致: ${seven.join(',')} fast=${fast} naive=${naive}`)
      }
    }
  })

  it('牌型分布与理论频率一致（±0.15pp）', () => {
    const rng = mulberry32(42)
    const deck = freshDeck()
    const counts = new Array(9).fill(0)
    const N = 500_000
    for (let n = 0; n < N; n++) {
      shuffleInPlace(deck, rng)
      counts[categoryOf(evaluateCards(deck.slice(0, 7)))]++
    }
    // 7 张牌理论频率（%）
    const expected = [17.4119, 43.8225, 23.4955, 4.8299, 4.6194, 3.0255, 2.5961, 0.168, 0.0311]
    for (let cat = 0; cat < 9; cat++) {
      const actual = (counts[cat] / N) * 100
      expect(Math.abs(actual - expected[cat]), `牌型 ${cat} 频率 ${actual.toFixed(4)}% vs ${expected[cat]}%`).toBeLessThan(0.15)
    }
  })

  it('性能：≥ 10 万次/秒（硬下限）', () => {
    const rng = mulberry32(7)
    const deck = freshDeck()
    // 预生成 1000 副牌避免洗牌时间掺入
    const hands: number[][] = []
    for (let i = 0; i < 1000; i++) {
      shuffleInPlace(deck, rng)
      hands.push(deck.slice(0, 7))
    }
    const N = 200_000
    const t0 = performance.now()
    let sink = 0
    for (let i = 0; i < N; i++) {
      const h = hands[i % 1000]
      sink ^= evaluateCards(h)
    }
    const ms = performance.now() - t0
    const perSec = (N / ms) * 1000
    expect(sink).not.toBe(-1)
    expect(perSec, `评估速度 ${Math.round(perSec)} 次/秒`).toBeGreaterThan(100_000)
  })
})
