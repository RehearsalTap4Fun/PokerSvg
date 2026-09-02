import type { BlindLevel, TournamentConfig } from '../core/types'

// 经典 9 人 SNG 结构：1500 起始筹码，总筹码 13500，盲注按手数升级（单机确定性好）。

export const DEFAULT_LEVELS: BlindLevel[] = [
  { sb: 10, bb: 20, ante: 0 },
  { sb: 15, bb: 30, ante: 0 },
  { sb: 25, bb: 50, ante: 0 },
  { sb: 50, bb: 100, ante: 0 },
  { sb: 75, bb: 150, ante: 15 },
  { sb: 100, bb: 200, ante: 25 },
  { sb: 150, bb: 300, ante: 30 },
  { sb: 200, bb: 400, ante: 50 },
  { sb: 300, bb: 600, ante: 75 },
  { sb: 400, bb: 800, ante: 100 },
  { sb: 600, bb: 1200, ante: 150 },
  { sb: 800, bb: 1600, ante: 200 },
  { sb: 1000, bb: 2000, ante: 300 },
]

export const STARTING_STACK = 1500
export const HANDS_PER_LEVEL = 9
/** 买入 100，奖池 900，前三名 50/30/20 */
export const DEFAULT_PAYOUTS = [450, 270, 180]
export const BUY_IN = 100

export function defaultConfig(seed: number, players: TournamentConfig['players']): TournamentConfig {
  return {
    seed,
    startingStack: STARTING_STACK,
    handsPerLevel: HANDS_PER_LEVEL,
    levels: DEFAULT_LEVELS,
    payouts: DEFAULT_PAYOUTS,
    players,
  }
}

// —— 赛制预设：人数 × 结构 ——

export type TableSize = 9 | 6 | 2
export type StructureKind = 'standard' | 'turbo' | 'deep'

export interface TournamentPreset {
  size: TableSize
  structure: StructureKind
}

export const DEFAULT_PRESET: TournamentPreset = { size: 9, structure: 'standard' }

export const STRUCTURES: Record<StructureKind, { name: string; desc: string; startingStack: number; handsPerLevel: number }> = {
  standard: { name: '标准', desc: '1500 起始 · 每 9 手升盲', startingStack: 1500, handsPerLevel: 9 },
  turbo: { name: '快速', desc: '1500 起始 · 每 5 手升盲，很快进入推拉', startingStack: 1500, handsPerLevel: 5 },
  deep: { name: '深筹', desc: '3000 起始 · 每 12 手升盲，翻后空间更大', startingStack: 3000, handsPerLevel: 12 },
}

export const TABLE_SIZES: Record<TableSize, { name: string; desc: string }> = {
  9: { name: '9 人', desc: '满桌，前三名分奖 50/30/20' },
  6: { name: '6 人', desc: '短桌，前两名分奖 65/35，位置更浅、节奏更快' },
  2: { name: '单挑', desc: '一对一，赢者全拿，翻前范围极宽' },
}

/** 奖金结构：买入 100 × 人数 */
export function payoutsFor(size: TableSize, buyIn = BUY_IN): number[] {
  const pool = buyIn * size
  if (size === 9) return [Math.round(pool * 0.5), Math.round(pool * 0.3), Math.round(pool * 0.2)]
  if (size === 6) return [Math.round(pool * 0.65), Math.round(pool * 0.35)]
  return [pool]
}

/** 座位分配（人类固定 0；其余取牌桌布局上均衡的位置） */
export function seatsFor(size: TableSize): number[] {
  if (size === 9) return [0, 1, 2, 3, 4, 5, 6, 7, 8]
  if (size === 6) return [0, 1, 3, 5, 7, 8]
  return [0, 5]
}

export function presetConfig(seed: number, preset: TournamentPreset, players: { id: string; name: string; style: TournamentConfig['players'][number]['style'] }[]): TournamentConfig {
  const st = STRUCTURES[preset.structure]
  const seats = seatsFor(preset.size)
  if (players.length !== seats.length) throw new Error(`预设 ${preset.size} 人需要 ${seats.length} 名玩家，实际 ${players.length}`)
  return {
    seed,
    startingStack: st.startingStack,
    handsPerLevel: st.handsPerLevel,
    levels: DEFAULT_LEVELS,
    payouts: payoutsFor(preset.size),
    players: players.map((p, i) => ({ ...p, seat: seats[i] })),
  }
}
