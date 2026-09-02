import { CLASS_OF_COMBO } from '../core/handClass'
import type { Street } from '../core/types'
import { Bucket, bucketsForBoard } from '../analysis/buckets'
import { CALL_3BET_PCT, CALL_PCT, FOURBET_PCT, OPEN_PCT, PERCENTILE, THREEBET_PCT, type Position } from './preflopCharts'
import { callShovePct, pushPct } from './pushFold'
import type { AiStyle } from './styles'

// ★ 核心策略函数 π(action | style, 公开局面, 候选手牌)。
// 只依赖公开信息 + 候选组合，单组合评估 <2μs（翻前查表，翻后查 board pass 缓存的桶）。
// AI 决策（decide.ts）与范围推断（inference.ts）共用它——推断与行为的一致性由此保证。

export type PreflopLine = 'unopened' | 'vsLimp' | 'vsOpen' | 'vs3bet' | 'vsShove'
export type PostflopLine = 'noBet' | 'vsBet' | 'vsRaise'
export type Line = PreflopLine | PostflopLine

export interface PublicSituation {
  street: Street
  position: Position
  line: Line
  /** 面对的跟注额（BB 数），0 = 无需跟注 */
  toCallBB: number
  potBB: number
  effBB: number
  /** 未弃牌人数 */
  nActive: number
  board: readonly number[]
}

/** 行动分布。toCallBB=0 时 fold 恒为 0（无注可弃时的"弃牌"并入 check）。 */
export interface ActionDist {
  fold: number
  check: number
  call: number
  raise: number
}

/** 百分位阈值 → 概率的线性混合带（近阈值处混合策略，宽 0.025×2） */
function ramp(pct: number, threshold: number, width = 0.025): number {
  if (pct <= threshold - width) return 1
  if (pct >= threshold + width) return 0
  return (threshold + width - pct) / (2 * width)
}

function normalizeDist(d: ActionDist): ActionDist {
  const s = d.fold + d.check + d.call + d.raise
  if (s <= 0) return { fold: 0, check: 1, call: 0, raise: 0 }
  return { fold: d.fold / s, check: d.check / s, call: d.call / s, raise: d.raise / s }
}

function policyPreflop(style: AiStyle, sit: PublicSituation, classId: number): ActionDist {
  const pct = PERCENTILE[classId]
  const loose = style.looseness
  // 加注宽度与跟注宽度分离：被动风格（跟注站）范围宽但加注窄
  const raiseLoose = Math.min(2.6, loose * Math.pow(style.aggression, 1.2))

  // 短码 push/fold 域
  if (sit.effBB <= 10) {
    if (sit.line === 'vsShove' || sit.toCallBB >= sit.effBB * 0.6) {
      const callP = ramp(pct, callShovePct(pushPct('late', sit.effBB), sit.effBB) * (0.8 + style.callDown * 0.5))
      return normalizeDist({ fold: 1 - callP, check: 0, call: callP, raise: 0 })
    }
    const pushLoose = Math.sqrt(loose) * (0.75 + 0.3 * style.aggression)
    if (sit.line === 'unopened' || sit.line === 'vsLimp') {
      if (sit.position === 'bb' && sit.toCallBB === 0) {
        const raiseP = ramp(pct, pushPct('bb', sit.effBB) * pushLoose)
        return normalizeDist({ fold: 0, check: 1 - raiseP, call: 0, raise: raiseP })
      }
      const pushP = ramp(pct, pushPct(sit.position, sit.effBB) * pushLoose)
      return normalizeDist({ fold: 1 - pushP, check: 0, call: 0, raise: pushP })
    }
    // 短码面对 open：推或弃
    const pushP = ramp(pct, pushPct(sit.position, sit.effBB) * 0.7 * pushLoose)
    return normalizeDist({ fold: 1 - pushP, check: 0, call: 0, raise: pushP })
  }

  switch (sit.line) {
    case 'unopened': {
      if (sit.position === 'bb') {
        // 理论上不出现（BB 无人入池即 walk）；防御性返回
        return { fold: 0, check: 1, call: 0, raise: 0 }
      }
      const openTh = OPEN_PCT[sit.position] * raiseLoose
      const raiseP = ramp(pct, openTh)
      // 跟注站/疯鱼有 limp 倾向（limp 范围按 looseness 展开）
      const limpTendency = style.id === 'station' ? 0.6 : style.id === 'maniac' ? 0.15 : 0.03
      const limpP = (1 - raiseP) * ramp(pct, OPEN_PCT[sit.position] * loose * 2.2) * limpTendency
      return normalizeDist({ fold: 1 - raiseP - limpP, check: 0, call: limpP, raise: raiseP })
    }
    case 'vsLimp': {
      if (sit.position === 'bb' && sit.toCallBB === 0) {
        const isoP = ramp(pct, OPEN_PCT.late * raiseLoose * 0.7)
        return normalizeDist({ fold: 0, check: 1 - isoP, call: 0, raise: isoP })
      }
      const isoTh = OPEN_PCT[sit.position] * raiseLoose * 0.85
      const isoP = ramp(pct, isoTh)
      const overLimpP = (1 - isoP) * ramp(pct, isoTh * (1.8 + style.callDown * 1.5)) * 0.8
      return normalizeDist({ fold: 1 - isoP - overLimpP, check: 0, call: overLimpP, raise: isoP })
    }
    case 'vsOpen': {
      const threeTh = THREEBET_PCT * style.threeBet
      const raiseP = ramp(pct, threeTh)
      const callTh = CALL_PCT[sit.position] * loose * (0.8 + style.callDown * 0.8)
      const callP = (1 - raiseP) * ramp(pct, callTh)
      return normalizeDist({ fold: 1 - raiseP - callP, check: 0, call: callP, raise: raiseP })
    }
    case 'vs3bet': {
      const fourTh = FOURBET_PCT * style.threeBet
      const raiseP = ramp(pct, fourTh)
      const callTh = CALL_3BET_PCT * (0.6 + 0.4 * loose) * (0.7 + style.callDown * 0.9)
      const callP = (1 - raiseP) * ramp(pct, callTh)
      return normalizeDist({ fold: 1 - raiseP - callP, check: 0, call: callP, raise: raiseP })
    }
    case 'vsShove': {
      const callP = ramp(pct, callShovePct(0.3, Math.min(sit.effBB, 15)) * (0.8 + style.callDown * 0.5))
      return normalizeDist({ fold: 1 - callP, check: 0, call: callP, raise: 0 })
    }
    default:
      return { fold: 0, check: 1, call: 0, raise: 0 }
  }
}

// 翻后基准表：[fold, call, raise]（vsBet/vsRaise）与主动下注倾向（noBet）
const NO_BET_PROP: Record<Bucket, number> = {
  [Bucket.Air]: 0, // 由 bluffFreq 驱动
  [Bucket.WeakDraw]: 0.22,
  [Bucket.StrongDraw]: 0.55,
  [Bucket.WeakPair]: 0.25,
  [Bucket.TopPair]: 0.6,
  [Bucket.Strong]: 0.7,
  [Bucket.Monster]: 0.75,
}

const VS_BET: Record<Bucket, [number, number, number]> = {
  [Bucket.Air]: [0.82, 0.08, 0.1],
  [Bucket.WeakDraw]: [0.6, 0.32, 0.08],
  [Bucket.StrongDraw]: [0.2, 0.6, 0.2],
  [Bucket.WeakPair]: [0.5, 0.45, 0.05],
  [Bucket.TopPair]: [0.15, 0.7, 0.15],
  [Bucket.Strong]: [0.05, 0.6, 0.35],
  [Bucket.Monster]: [0.02, 0.38, 0.6],
}

const VS_RAISE: Record<Bucket, [number, number, number]> = {
  [Bucket.Air]: [0.93, 0.04, 0.03],
  [Bucket.WeakDraw]: [0.8, 0.18, 0.02],
  [Bucket.StrongDraw]: [0.35, 0.55, 0.1],
  [Bucket.WeakPair]: [0.75, 0.24, 0.01],
  [Bucket.TopPair]: [0.35, 0.6, 0.05],
  [Bucket.Strong]: [0.12, 0.68, 0.2],
  [Bucket.Monster]: [0.02, 0.48, 0.5],
}

function streetBluffFactor(street: Street): number {
  return street === 'flop' ? 1 : street === 'turn' ? 0.8 : 0.65
}

function policyPostflop(style: AiStyle, sit: PublicSituation, bucket: Bucket): ActionDist {
  const multiway = sit.nActive > 2 ? 0.45 : 1
  if (sit.line === 'noBet') {
    let betP = NO_BET_PROP[bucket] * style.aggression
    if (bucket === Bucket.Air) betP = style.bluffFreq * streetBluffFactor(sit.street) * multiway
    if (bucket === Bucket.WeakDraw || bucket === Bucket.StrongDraw) {
      betP = Math.min(0.85, betP + style.bluffFreq * 0.8 * multiway)
      if (sit.street === 'river') betP = bucket === Bucket.WeakDraw ? style.bluffFreq * 0.8 : style.bluffFreq // 河牌听牌落空转诈唬
    }
    betP = Math.min(0.9, betP)
    return normalizeDist({ fold: 0, check: 1 - betP, call: 0, raise: betP })
  }

  const base = sit.line === 'vsRaise' ? VS_RAISE[bucket] : VS_BET[bucket]
  // 下注大小压力：注额相对底池越大越倾向弃牌
  const sizeRatio = sit.potBB > 0 ? Math.min(1.5, Math.max(0.15, sit.toCallBB / sit.potBB)) : 0.75
  const sizePressure = 0.7 + sizeRatio * 0.55
  let fold = base[0] * (0.55 + style.foldToAgg * 0.85) * sizePressure * (sit.nActive > 2 ? 1.15 : 1)
  let call = base[1] * (0.55 + style.callDown * 0.95)
  let raise = base[2] * style.aggression
  if (bucket === Bucket.Air) raise = Math.min(0.25, raise * style.bluffFreq * 6 * streetBluffFactor(sit.street) * multiway)
  // 保底极小概率，防止推断权重清零后无法恢复
  fold = Math.max(fold, 0.001)
  call = Math.max(call, 0.001)
  return normalizeDist({ fold, check: 0, call, raise })
}

/** 对指定组合评估策略分布（推断用） */
export function policyForCombo(style: AiStyle, sit: PublicSituation, comboIdx: number): ActionDist {
  if (sit.street === 'preflop') return policyPreflop(style, sit, CLASS_OF_COMBO[comboIdx])
  const bucket = bucketsForBoard(sit.board)[comboIdx] as Bucket
  return policyPostflop(style, sit, bucket)
}

/** 对具体两张牌评估策略分布（AI 决策用） */
export function policyForCards(style: AiStyle, sit: PublicSituation, c1: number, c2: number): ActionDist {
  const hi = Math.max(c1, c2)
  const lo = Math.min(c1, c2)
  return policyForCombo(style, sit, (hi * (hi - 1)) / 2 + lo)
}
