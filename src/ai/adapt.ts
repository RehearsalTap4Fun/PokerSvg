import type { StatCounters } from '../analysis/playerStats'
import { ratesOf } from '../analysis/playerStats'
import type { AiStyle } from './styles'

// 动态风格推导：把观察到的行为统计映射回 AiStyle 参数（贝叶斯收缩：样本少时贴近先验）。
// 用途：AI 对人类玩家（无真实风格）的建模——推断范围与决策都据此进行，于是
// 疯打的人会被 AI 更多地跟注/反击，被动的人会被更多地施压。
// 参考值 REF = 紧凶基准 AI 在 9 人 SNG 中的实际统计（scripts/calibrate.ts 测得，tests/adapt.test.ts 校验漂移）。
// 注：本 SNG 结构升盲快，多数摊牌来自翻前全下，故 WTSD 明显高于现金局常识值。

export const REF = {
  vpip: 0.23,
  pfr: 0.17,
  threeBet: 0.05,
  limp: 0.02,
  cbet: 0.35,
  foldToCbet: 0.35,
  af: 2.3,
  foldVsBet: 0.47,
  wtsd: 0.65,
}

/** 收缩权重：n 个样本相对于先验强度 k */
const shrink = (n: number, k: number): number => (n <= 0 ? 0 : n / (n + k))

/** 几何收缩：base × ratio^w，ratio 先夹在 [lo, hi] */
function blendMul(base: number, ratio: number, w: number, lo: number, hi: number, outLo: number, outHi: number): number {
  const r = Math.min(hi, Math.max(lo, ratio))
  return Math.min(outHi, Math.max(outLo, base * Math.pow(r, w)))
}

const ratioOf = (obs: number, ref: number, floor = 0.01): number => Math.max(floor, obs) / ref

export function adaptStyle(base: AiStyle, c: StatCounters): AiStyle {
  const r = ratesOf(c)
  const wHands = shrink(c.hands, 25)
  const w3 = shrink(c.threeBetOpp, 12)
  const wLimp = shrink(c.limpOpp, 15)
  const wCbet = shrink(c.cbetOpp, 8)
  const wFace = shrink(c.postFaceBet, 12)
  const wAf = shrink(c.postBets + c.postCalls, 15)
  const wWtsd = shrink(c.sawFlop, 12)

  const looseness = blendMul(base.looseness, ratioOf(r.vpip, REF.vpip), wHands, 0.3, 4, 0.4, 2.8)

  // 进攻性：翻前 PFR/VPIP 与翻后 AF 各占一半（AF 噪声大，指数减半）
  const pfrOverVpip = r.vpip > 0 ? r.pfr / r.vpip : 0
  const aggRatio = Math.sqrt(ratioOf(pfrOverVpip, REF.pfr / REF.vpip, 0.05) * Math.pow(ratioOf(r.af, REF.af, 0.2), 0.5))
  const aggression = blendMul(base.aggression, aggRatio, Math.min(wHands, Math.max(wHands * 0.5, wAf)), 0.3, 3, 0.4, 2.2)

  const threeBet = blendMul(base.threeBet, ratioOf(r.threeBet, REF.threeBet), w3, 0.2, 5, 0.2, 3)

  // 诈唬频率：c-bet 频率与 AF 共同指示（都高 = 空气也开火）
  const bluffRatio = Math.sqrt(ratioOf(r.cbet, REF.cbet, 0.05) * ratioOf(r.af, REF.af, 0.2))
  const bluffFreq = blendMul(base.bluffFreq, bluffRatio, Math.min(wCbet, wAf) * 0.8 + Math.max(wCbet, wAf) * 0.2, 0.3, 3, 0.02, 0.6)

  const foldToAgg = blendMul(base.foldToAgg, ratioOf(r.foldVsBet, REF.foldVsBet, 0.02), wFace, 0.2, 2.5, 0.1, 0.95)

  // 跟注站程度：走向摊牌率 与 面对下注的跟注率
  const callRate = c.postFaceBet > 0 ? c.postCalls / c.postFaceBet : 0
  const callRatio = Math.sqrt(ratioOf(r.wtsd, REF.wtsd, 0.02) * ratioOf(callRate, 1 - REF.foldVsBet, 0.02))
  const callDown = blendMul(base.callDown, callRatio, Math.min(wWtsd, wFace) * 0.7 + Math.max(wWtsd, wFace) * 0.3, 0.2, 3, 0.1, 1.0)

  const limpTendency = Math.min(0.9, Math.max(0, base.limpTendency + wLimp * (r.limp - base.limpTendency)))

  return { ...base, looseness, aggression, threeBet, bluffFreq, foldToAgg, callDown, limpTendency }
}

export interface ProfileLabel {
  /** 松紧 × 主动被动 的四象限标签 */
  quadrant: string
  /** 一句话画像 */
  text: string
}

/** 给 HUD 用的"AI 眼中的你"画像 */
export function describeProfile(c: StatCounters, style: AiStyle): ProfileLabel {
  const r = ratesOf(c)
  if (c.hands < 8) return { quadrant: '观察中', text: `样本 ${c.hands} 手，AI 暂按紧凶基准看待你` }
  const loose = r.vpip >= REF.vpip * 1.35 ? '松' : r.vpip <= REF.vpip * 0.7 ? '紧' : '中等'
  const pfrOverVpip = r.vpip > 0 ? r.pfr / r.vpip : 0
  const aggr = pfrOverVpip >= 0.6 && r.af >= REF.af * 0.9 ? '凶' : pfrOverVpip < 0.4 || r.af < REF.af * 0.5 ? '被动' : '均衡'
  const quadrant = `${loose}${aggr}`
  const bits: string[] = []
  bits.push(`入池 ${(r.vpip * 100).toFixed(0)}%`)
  bits.push(`加注 ${(r.pfr * 100).toFixed(0)}%`)
  if (r.n.af >= 6) bits.push(`AF ${r.af.toFixed(1)}`)
  if (r.n.foldVsBet >= 6) bits.push(`面对下注弃 ${(r.foldVsBet * 100).toFixed(0)}%`)
  const hint =
    style.bluffFreq > 0.18
      ? 'AI 会更多地跟注你的下注'
      : style.foldToAgg > 0.65
        ? 'AI 会更频繁地对你施压'
        : style.callDown > 0.6
          ? 'AI 会减少对你的诈唬、加大价值下注'
          : 'AI 按你的实际频率调整应对'
  return { quadrant, text: `${bits.join(' · ')}。${hint}` }
}
