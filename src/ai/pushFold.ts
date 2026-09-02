import { PERCENTILE, type Position } from './preflopCharts'

// 短码（≤10bb）push/fold 近似表：以百分位阈值表达的 Nash 推/弃近似，
// 随 bb 变浅范围变宽；按风格 looseness 微调。

/** 无人入池时的全下（推）百分位 */
export function pushPct(position: Position, effBB: number): number {
  const base: Record<Position, number> = {
    early: 0.12,
    middle: 0.17,
    late: 0.25,
    button: 0.4,
    sb: 0.55,
    bb: 0.35, // BB 面对 SB limp/极短码时的反推
  }
  const depthMult = effBB <= 4 ? 1.9 : effBB <= 6 ? 1.5 : effBB <= 8 ? 1.2 : 1.0
  return Math.min(0.85, base[position] * depthMult)
}

/** 面对全下的跟注百分位（近似：比推的范围明显更紧） */
export function callShovePct(pusherPct: number, effBB: number): number {
  const depthMult = effBB <= 5 ? 1.25 : 1.0
  return Math.min(0.6, pusherPct * 0.5 * depthMult)
}

export function shouldPush(classId: number, position: Position, effBB: number, looseness: number): boolean {
  return PERCENTILE[classId] <= pushPct(position, effBB) * Math.sqrt(looseness)
}

export function shouldCallShove(classId: number, pusherPct: number, effBB: number, callDown: number): boolean {
  return PERCENTILE[classId] <= callShovePct(pusherPct, effBB) * (0.8 + callDown * 0.5)
}
