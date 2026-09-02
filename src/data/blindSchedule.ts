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
