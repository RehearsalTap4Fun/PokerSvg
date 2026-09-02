import { CLASS_OF_COMBO } from '../core/handClass'
import type { Street } from '../core/types'
import { Bucket, bucketsForBoard } from '../analysis/buckets'
import { PERCENTILE, type Position } from './preflopCharts'
import {
  BB_DEFEND,
  CALL_3BET,
  CALL_VS_OPEN,
  FOURBET,
  OPENER_3BET_MULT,
  OPENER_CALL_MULT,
  POS_CALL_MULT,
  RFI,
  THREEBET,
  posGroup,
  sizeCallMult,
  widen,
} from './preflopRanges'
import { callShovePct, pushPct } from './pushFold'
import type { AiStyle } from './styles'

// ★ 核心策略函数 π(action | style, 公开局面, 候选手牌)。
// 只依赖公开信息 + 候选组合，单组合评估 <2μs（翻前查表，翻后查 board pass 缓存的桶）。
// AI 决策（decide.ts）与范围推断（inference.ts）共用它——推断与行为的一致性由此保证。
// 公开局面包含：位置、线路、开牌者位置与尺度、是否有位置、主动权/上街是否下注、SPR、牌面纹理。

export type PreflopLine = 'unopened' | 'vsLimp' | 'vsOpen' | 'vs3bet' | 'vsShove'
export type PostflopLine = 'noBet' | 'vsBet' | 'vsRaise'
export type Line = PreflopLine | PostflopLine

export interface PublicSituation {
  street: Street
  position: Position
  line: Line
  /** 面对的跟注额（BB 数），0 = 无需跟注 */
  toCallBB: number
  /** 当前底池（BB 数，含所有已投入） */
  potBB: number
  effBB: number
  /** 未弃牌人数 */
  nActive: number
  board: readonly number[]
  /** 本街当前注额（BB 数；翻前 = 开牌尺度），0 = 无人下注 */
  raiseToBB: number
  /** 本街最后进攻者的位置（翻前 = 开牌者/3bet 者），null = 无 */
  aggressorPos: Position | null
  /** 本手是否有 ante */
  hasAnte: boolean
  /** 翻后：我是否在所有可行动对手之后行动 */
  inPosition: boolean
  /** 我是否持有主动权（整手最近一次下注/加注是我） */
  isAggressor: boolean
  /** 上一条街是我最后下注（连续开火判定） */
  barreling: boolean
  /** 有效筹码 / 底池 */
  spr: number
  /** 牌面湿度 0..1 */
  wetness: number
  /** 牌面有对 */
  paired: boolean
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

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

function policyPreflop(style: AiStyle, sit: PublicSituation, classId: number): ActionDist {
  const pct = PERCENTILE[classId]
  const loose = style.looseness
  // 加注宽度与跟注宽度分离：被动风格（跟注站）范围宽但加注窄
  const raiseLoose = Math.min(2.6, loose * Math.pow(style.aggression, 1.2))
  const rfiPos = sit.position === 'bb' ? 'late' : sit.position

  // 短码 push/fold 域
  if (sit.effBB <= 10) {
    if (sit.line === 'vsShove' || sit.toCallBB >= sit.effBB * 0.6) {
      const callP = ramp(pct, callShovePct(pushPct('late', sit.effBB, sit.hasAnte), sit.effBB) * (0.8 + style.callDown * 0.5))
      return normalizeDist({ fold: 1 - callP, check: 0, call: callP, raise: 0 })
    }
    const pushLoose = Math.sqrt(loose) * (0.75 + 0.3 * style.aggression)
    if (sit.line === 'unopened' || sit.line === 'vsLimp') {
      if (sit.position === 'bb' && sit.toCallBB === 0) {
        const raiseP = ramp(pct, pushPct('bb', sit.effBB, sit.hasAnte) * pushLoose)
        return normalizeDist({ fold: 0, check: 1 - raiseP, call: 0, raise: raiseP })
      }
      const pushP = ramp(pct, pushPct(sit.position, sit.effBB, sit.hasAnte) * pushLoose)
      return normalizeDist({ fold: 1 - pushP, check: 0, call: 0, raise: pushP })
    }
    // 短码面对 open：推或弃
    const pushP = ramp(pct, pushPct(sit.position, sit.effBB, sit.hasAnte) * 0.7 * pushLoose)
    return normalizeDist({ fold: 1 - pushP, check: 0, call: 0, raise: pushP })
  }

  switch (sit.line) {
    case 'unopened': {
      if (sit.position === 'bb') {
        // 理论上不出现（BB 无人入池即 walk）；防御性返回
        return { fold: 0, check: 1, call: 0, raise: 0 }
      }
      // 单挑：小盲（=按钮）开牌极宽
      const hu = sit.nActive === 2 && sit.position === 'sb' ? 1.8 : 1
      const raiseP = widen(RFI[rfiPos], raiseLoose * hu)[classId]
      // limp：范围比开牌宽得多，频率由风格的 limpTendency 决定
      const limpP = (1 - raiseP) * widen(RFI[rfiPos], clamp(loose * 2.2, 1, 5))[classId] * style.limpTendency
      return normalizeDist({ fold: 1 - raiseP - limpP, check: 0, call: limpP, raise: raiseP })
    }
    case 'vsLimp': {
      if (sit.position === 'bb' && sit.toCallBB === 0) {
        const isoP = widen(RFI.late, raiseLoose * 0.7)[classId]
        return normalizeDist({ fold: 0, check: 1 - isoP, call: 0, raise: isoP })
      }
      const isoP = widen(RFI[rfiPos], raiseLoose * 0.85)[classId]
      const overLimpP = (1 - isoP) * widen(RFI[rfiPos], clamp(loose * (1.8 + style.callDown * 1.5), 1, 5))[classId] * 0.8
      return normalizeDist({ fold: 1 - isoP - overLimpP, check: 0, call: overLimpP, raise: isoP })
    }
    case 'vsOpen': {
      const og = posGroup(sit.aggressorPos ?? 'late')
      const threeP = widen(THREEBET, style.threeBet * OPENER_3BET_MULT[og])[classId]
      const callTable = sit.position === 'bb' ? BB_DEFEND : CALL_VS_OPEN
      const huDefend = sit.nActive === 2 && sit.position === 'bb' ? 1.35 : 1
      const callMult =
        POS_CALL_MULT[sit.position] * OPENER_CALL_MULT[og] * sizeCallMult(sit.raiseToBB) * Math.pow(loose, 0.8) * (0.8 + style.callDown * 0.5) * huDefend
      const callP = (1 - threeP) * widen(callTable, callMult)[classId]
      return normalizeDist({ fold: 1 - threeP - callP, check: 0, call: callP, raise: threeP })
    }
    case 'vs3bet': {
      const fourP = widen(FOURBET, style.threeBet)[classId]
      const callP = (1 - fourP) * widen(CALL_3BET, (0.6 + 0.4 * loose) * (0.7 + style.callDown * 0.9))[classId]
      return normalizeDist({ fold: 1 - fourP - callP, check: 0, call: callP, raise: fourP })
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
  const ip = sit.inPosition
  const dry = 1 - sit.wetness

  if (sit.line === 'noBet') {
    // 线路系数：有主动权 → c-bet（有位置更多）；无主动权且无位置 → donk 很少；对手过牌给我 → 顺势下注
    const lineMult = sit.isAggressor ? (ip ? 1.2 : 1.0) : ip ? 0.9 : 0.4
    let betP: number
    if (bucket === Bucket.Air) {
      // 空气：干燥面 c-bet 多、湿面少；连贯性——上街我下注则继续开火概率抬高，有主动权却过牌则多半放弃
      betP = style.bluffFreq * streetBluffFactor(sit.street) * multiway * (0.7 + 0.6 * dry)
      if (sit.street !== 'flop') betP *= sit.barreling ? 1.9 : sit.isAggressor ? 0.6 : 1
      if (sit.paired && sit.street === 'flop') betP *= 1.15 // 对子面对手更难有牌
    } else if (bucket === Bucket.WeakDraw || bucket === Bucket.StrongDraw) {
      betP = Math.min(0.85, NO_BET_PROP[bucket] * style.aggression + style.bluffFreq * 0.8 * multiway)
      if (sit.street === 'river') {
        // 河牌听牌落空 → 转诈唬，连贯开火者更常继续
        betP = (bucket === Bucket.WeakDraw ? 0.8 : 1) * style.bluffFreq * (sit.barreling ? 1.6 : 0.8)
      } else if (sit.street === 'turn') {
        betP *= 0.8 // 转牌只剩一张牌，半诈唬价值下降
      }
    } else {
      // 成牌：湿面更需要下注保护/收价值；持续价值下注保持连贯
      betP = NO_BET_PROP[bucket] * style.aggression * (0.85 + 0.3 * sit.wetness)
      if (sit.barreling && bucket >= Bucket.TopPair) betP = Math.max(betP, 0.62 * Math.min(1.3, style.aggression))
      if (bucket === Bucket.WeakPair && sit.street === 'river') betP *= 0.6 // 河牌弱对子少做薄价值
    }
    betP *= lineMult
    // 低 SPR 成牌直接做池
    if (sit.spr < 2 && bucket >= Bucket.TopPair) betP = Math.min(0.95, betP * 1.25)
    betP = Math.min(0.92, betP)
    return normalizeDist({ fold: 0, check: 1 - betP, call: 0, raise: betP })
  }

  const base = sit.line === 'vsRaise' ? VS_RAISE[bucket] : VS_BET[bucket]
  // 尺度压力：toCall / 当前底池（含对手下注）。1/3 池注 ≈ 0.25，满池注 = 0.5，超池 → 0.67+
  const sizeRatio = sit.potBB > 0 ? clamp(sit.toCallBB / sit.potBB, 0.08, 1) : 0.4
  const sizePressure = 0.2 + sizeRatio * 1.8 // 最小注 ≈ 0.43，半池 ≈ 0.8，满池 ≈ 1.1，两倍池 ≈ 1.4
  let fold = base[0] * (0.55 + style.foldToAgg * 0.85) * sizePressure * (sit.nActive > 2 ? 1.15 : 1) * (ip ? 0.9 : 1.1)
  let call = base[1] * (0.55 + style.callDown * 0.95) * (ip ? 1.1 : 0.95)
  let raise = base[2] * style.aggression
  if (bucket === Bucket.Air) {
    // 空气加注 = 诈唬：面对小注更常加注（便宜），面对大注少
    raise = Math.min(0.25, raise * style.bluffFreq * 6 * streetBluffFactor(sit.street) * multiway * clamp(1.4 - sizeRatio, 0.5, 1.3))
  }
  // SPR：低 SPR 成牌 commit（少弃多加注）；高 SPR 弱对子更谨慎
  if (sit.spr < 2.5 && bucket >= Bucket.TopPair) {
    fold *= 0.5
    raise *= 1.4
  }
  if (sit.spr > 6 && bucket === Bucket.WeakPair) fold *= 1.2
  // 湿面：听牌跟注更值（隐含赔率），成牌面对加注更谨慎
  if (bucket === Bucket.StrongDraw || bucket === Bucket.WeakDraw) call *= 0.85 + 0.3 * sit.wetness
  if (sit.line === 'vsRaise' && bucket === Bucket.TopPair) fold *= 0.85 + 0.3 * sit.wetness
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
