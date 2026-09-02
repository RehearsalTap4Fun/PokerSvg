import { CLASS_COMBOS } from '../core/handClass'
import { HAND_ORDER, RANK_PCT } from './handRanking'
import { parseRange, tablePct } from './rangeNotation'
import type { Position } from './preflopCharts'

// 翻前基准范围（紧凶 = 系数 1.0）：按位置的 169 类频率表，手工转录的现代 9 人桌打法。
// 风格差异通过 widen(table, factor) 沿 HAND_ORDER 展开/收窄——展开加入排序上紧邻的手牌，
// 收窄去掉表内最弱的手牌，因此"A5s 开、A6o 不开"这类结构在任何松紧下都保留。
// 这份表同时是 AI 的策略、范围推断的似然、以及范围表弹窗的教学内容。

/** 无人入池时开牌加注（RFI） */
export const RFI: Record<Exclude<Position, 'bb'>, Float64Array> = {
  early: parseRange('22+, A9s+, A5s-A4s:0.5, KTs+, QTs+, JTs, T9s:0.5, AJo+, KQo:0.5'),
  middle: parseRange('22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s:0.5, ATo+, KJo+, QJo:0.5'),
  late: parseRange('22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s:0.5, A8o+, A5o:0.5, KTo+, QTo+, JTo, T9o:0.5'),
  button: parseRange(
    '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, 43s:0.5, A2o+, K8o+, K7o:0.5, Q9o+, Q8o:0.5, J9o+, J8o:0.5, T9o, T8o:0.5, 98o:0.5',
  ),
  sb: parseRange('22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o'),
}

/** 面对单次开牌的 3bet（价值 + 少量同花 A 小/连张诈唬；基准 = 有位置面对后位开牌） */
export const THREEBET = parseRange(
  'JJ+, AKs, AQs, AKo, TT:0.6, 99:0.3, AQo:0.6, AJs:0.5, KQs:0.5, A5s-A2s:0.5, KJs:0.3, QJs:0.25, JTs:0.2, T9s:0.2, 87s:0.2, 76s:0.2, 65s:0.2',
)

/** 面对单次开牌的冷跟注（有位置基准；无位置/前位由 POS_CALL_MULT 收窄） */
export const CALL_VS_OPEN = parseRange(
  '99-22, AJs-ATs, A9s-A2s:0.6, KQs-KTs, QJs-QTs, JTs, T9s, 98s, 87s, 76s, 65s, 54s:0.5, AQo:0.4, AJo, ATo:0.5, KQo, KJo:0.5, QJo:0.4',
)

/** 大盲防守跟注（基准 = 面对后位 2.5bb 开牌；面对前位/大尺度由系数收窄） */
export const BB_DEFEND = parseRange(
  'TT-22, AJs-A2s, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, 53s:0.5, AJo-A7o, A6o-A2o:0.5, KTo+, K9o:0.6, QTo+, Q9o:0.5, JTo, J9o:0.5, T9o, 98o:0.5',
)

/** 面对 3bet 的 4bet */
export const FOURBET = parseRange('AA, KK, QQ:0.6, AKs, AKo:0.7, JJ:0.3, AQs:0.2, A5s:0.4, A4s:0.3')

/** 面对 3bet 的跟注 */
export const CALL_3BET = parseRange('QQ-88, 77-55:0.5, AQs, AJs, ATs:0.5, KQs, KJs:0.5, QJs:0.5, JTs:0.5, T9s:0.4, 98s:0.3, AQo:0.5, AKo:0.3')

/** 响应者位置 → 冷跟注宽度系数（前位冷跟要窄，SB 无位置也窄） */
export const POS_CALL_MULT: Record<Position, number> = { early: 0.55, middle: 0.7, late: 0.9, button: 1.0, sb: 0.5, bb: 1.0 }

export type PosGroup = 'early' | 'middle' | 'late'
export function posGroup(p: Position): PosGroup {
  return p === 'early' ? 'early' : p === 'middle' ? 'middle' : 'late'
}
/** 开牌者位置组 → 响应者跟注/3bet 宽度系数（面对前位开牌要更尊重） */
export const OPENER_CALL_MULT: Record<PosGroup, number> = { early: 0.6, middle: 0.8, late: 1.0 }
export const OPENER_3BET_MULT: Record<PosGroup, number> = { early: 0.7, middle: 0.85, late: 1.0 }

/** 开牌尺度 → 跟注宽度系数（基准 2.5bb；越大越窄） */
export function sizeCallMult(raiseToBB: number): number {
  if (!(raiseToBB > 0)) return 1
  return Math.min(1.25, Math.max(0.45, Math.pow(2.5 / Math.max(2, raiseToBB), 0.8)))
}

// —— 展开/收窄 ——

const widenCache = new Map<Float64Array, Map<number, Float64Array>>()
const SOFT = 0.02 // 边界软化带（组合占比）

/**
 * 沿 HAND_ORDER 把表展开（factor>1：加入排序上紧邻的手牌直到覆盖 pct×factor）
 * 或收窄（factor<1：去掉表内最弱的手牌直到覆盖 pct×factor）。factor≈1 原表返回。
 */
export function widen(table: Float64Array, factor: number): Float64Array {
  const f = Math.round(Math.min(6, Math.max(0.05, factor)) * 100) / 100
  if (Math.abs(f - 1) < 0.005) return table
  let inner = widenCache.get(table)
  if (!inner) {
    inner = new Map()
    widenCache.set(table, inner)
  }
  const hit = inner.get(f)
  if (hit) return hit

  const basePct = tablePct(table)
  const target = Math.min(1, basePct * f)
  const out = new Float64Array(169)
  if (f > 1) {
    // 排序上覆盖到 target 的手牌全频率加入；带内线性过渡
    for (let cls = 0; cls < 169; cls++) {
      const p = RANK_PCT[cls]
      const add = p <= target - SOFT ? 1 : p >= target + SOFT ? 0 : (target + SOFT - p) / (2 * SOFT)
      out[cls] = Math.max(table[cls], add)
    }
  } else {
    // 按排序累计表内质量，超过 target 的尾部去掉（带内线性衰减）
    let cum = 0
    for (const cls of HAND_ORDER) {
      const mass = (table[cls] * CLASS_COMBOS[cls].length) / 1326
      if (mass <= 0) continue
      const before = cum
      cum += mass
      if (cum <= target) out[cls] = table[cls]
      else if (before >= target + SOFT) out[cls] = 0
      else {
        const keep = Math.max(0, Math.min(1, (target + SOFT - before) / (mass + SOFT)))
        out[cls] = table[cls] * keep
      }
    }
  }
  if (inner.size > 400) inner.clear()
  inner.set(f, out)
  return out
}

export { tablePct }
