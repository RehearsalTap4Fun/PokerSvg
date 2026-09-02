import { describe, expect, it } from 'vitest'
import { policyForCombo, type PublicSituation } from '../src/ai/policy'
import { betFraction } from '../src/ai/decide'
import { STYLES } from '../src/ai/styles'
import { strToCards } from '../src/core/cards'
import { comboIndex } from '../src/core/handClass'
import { boardTexture } from '../src/analysis/texture'

// 翻后策略：位置/主动权/连贯性/尺度压力/SPR 的方向性；下注尺度与牌力解耦。

const board = strToCards('Kh 7d 2c')
const wetBoard = strToCards('Jh Th 8d')
const air = comboIndex(...(strToCards('5s 4d') as [number, number]))
const topPair = comboIndex(...(strToCards('Kd Qs') as [number, number]))
const weakPair = comboIndex(...(strToCards('7s 6s') as [number, number]))

const NO_BET: PublicSituation = {
  street: 'flop',
  position: 'button',
  line: 'noBet',
  toCallBB: 0,
  potBB: 6,
  effBB: 60,
  nActive: 2,
  board,
  raiseToBB: 0,
  aggressorPos: null,
  hasAnte: false,
  inPosition: true,
  isAggressor: true,
  barreling: false,
  spr: 10,
  wetness: boardTexture(board).wetness,
  paired: false,
}

const VS_BET: PublicSituation = { ...NO_BET, line: 'vsBet', toCallBB: 3, potBB: 9, aggressorPos: 'early', inPosition: true, isAggressor: false }

describe('翻后策略', () => {
  const tag = STYLES.tag
  it('有主动权的 c-bet 频率 > 无主动权 OOP 的 donk 频率', () => {
    const cbet = policyForCombo(tag, NO_BET, topPair).raise
    const donk = policyForCombo(tag, { ...NO_BET, isAggressor: false, inPosition: false }, topPair).raise
    expect(cbet).toBeGreaterThan(donk * 2)
  })

  it('连贯性：上街开火后转牌继续诈唬的概率显著高于独立采样；有主动权却过牌后放弃', () => {
    const turn: PublicSituation = { ...NO_BET, street: 'turn', board: strToCards('Kh 7d 2c 9s') }
    const barrel = policyForCombo(STYLES.maniac, { ...turn, barreling: true }, air).raise
    const gaveUp = policyForCombo(STYLES.maniac, { ...turn, barreling: false, isAggressor: true }, air).raise
    const fresh = policyForCombo(STYLES.maniac, { ...turn, barreling: false, isAggressor: false }, air).raise
    expect(barrel).toBeGreaterThan(fresh * 1.5)
    expect(gaveUp).toBeLessThan(fresh)
    // 三条街诈唬概率（疯鱼、IP、干面）应明显高于 5%
    const flop = policyForCombo(STYLES.maniac, NO_BET, air).raise
    const river = policyForCombo(STYLES.maniac, { ...turn, street: 'river', board: strToCards('Kh 7d 2c 9s 3d'), barreling: true }, air).raise
    expect(flop * barrel * river).toBeGreaterThan(0.05)
  })

  it('尺度压力：面对最小注的弃牌率明显低于面对满池注', () => {
    const minBet = policyForCombo(tag, { ...VS_BET, toCallBB: 1, potBB: 7 }, weakPair)
    const potBet = policyForCombo(tag, { ...VS_BET, toCallBB: 6, potBB: 12 }, weakPair)
    expect(minBet.fold).toBeLessThan(potBet.fold * 0.7)
    const minAir = policyForCombo(tag, { ...VS_BET, toCallBB: 1, potBB: 7 }, air)
    const potAir = policyForCombo(tag, { ...VS_BET, toCallBB: 6, potBB: 12 }, air)
    expect(minAir.fold).toBeLessThan(potAir.fold)
    // 面对小注更常用空气加注
    expect(minAir.raise).toBeGreaterThan(potAir.raise)
  })

  it('位置：无位置面对下注弃牌更多', () => {
    const ip = policyForCombo(tag, VS_BET, weakPair)
    const oop = policyForCombo(tag, { ...VS_BET, inPosition: false }, weakPair)
    expect(oop.fold).toBeGreaterThan(ip.fold)
  })

  it('SPR：低 SPR 顶对面对下注几乎不弃', () => {
    const deep = policyForCombo(tag, { ...VS_BET, spr: 8 }, topPair)
    const shallow = policyForCombo(tag, { ...VS_BET, spr: 1.5 }, topPair)
    expect(shallow.fold).toBeLessThan(deep.fold)
    expect(shallow.raise).toBeGreaterThan(deep.raise)
  })

  it('纹理：湿面价值下注更多、空气 c-bet 更少', () => {
    const wet: PublicSituation = { ...NO_BET, board: wetBoard, wetness: boardTexture(wetBoard).wetness }
    expect(wet.wetness).toBeGreaterThan(NO_BET.wetness)
    const kq = comboIndex(...(strToCards('Jd Ks') as [number, number])) // 湿面顶对
    const kkq = comboIndex(...(strToCards('Kd Qs') as [number, number])) // 干面顶对
    expect(policyForCombo(tag, wet, kq).raise).toBeGreaterThan(policyForCombo(tag, NO_BET, kkq).raise)
    expect(policyForCombo(tag, wet, air).raise).toBeLessThan(policyForCombo(tag, NO_BET, air).raise)
  })

  it('下注尺度只由局面决定：同局面下不同牌力尺度相同；湿面/后街更大；小球风格更小', () => {
    const f = betFraction(NO_BET, tag)
    expect(f).toBeGreaterThan(0.3)
    expect(f).toBeLessThan(0.6)
    const wet: PublicSituation = { ...NO_BET, wetness: 1 }
    expect(betFraction(wet, tag)).toBeGreaterThan(f)
    expect(betFraction({ ...NO_BET, street: 'river' }, tag)).toBeGreaterThan(f)
    expect(betFraction(NO_BET, STYLES.negreanu)).toBeLessThan(f)
    expect(betFraction(NO_BET, STYLES.dwan)).toBeGreaterThan(f)
  })
})
