import type { Card } from './cards'

// —— 筹码全程整数，绝不使用浮点 ——

export interface BlindLevel {
  sb: number
  bb: number
  ante: number
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'done'

/** 统一 raise-to 语义：to = 加注"到"的总额度（本条街） */
export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; to: number }
  | { type: 'raise'; to: number }

export interface SeatState {
  seat: number
  playerId: string
  /** 本手开始时的筹码（淘汰并列名次判定、记录用） */
  startStack: number
  stack: number
  /** 本条街已投入 */
  committed: number
  /** 本手累计投入（边池分层依据，含 ante） */
  totalCommitted: number
  holeCards: [Card, Card] | null
  folded: boolean
  allIn: boolean
  /**
   * 本条街最后一次行动时面对的注额（行动后的 currentBet）。-1 = 本街尚未主动行动（盲注不算）。
   * 加注权判定（含多个不足额 all-in 的累计 reopen）：currentBet - actedAt >= lastFullRaiseSize 时可再加注。
   */
  actedAt: number
}

export interface HandSetupInput {
  handNo: number
  seed: number
  level: BlindLevel
  buttonSeat: number
  /** 小盲座位；null = dead SB（该位置玩家已淘汰，无人付小盲） */
  sbSeat: number | null
  bbSeat: number
  /** 存活玩家（按座位号升序不必强求，内部按 seat 索引） */
  seats: { seat: number; playerId: string; stack: number }[]
  /** 仅测试用：指定整副牌（跳过洗牌）。发牌顺序：按钮左起每人两张，之后翻牌3/转牌1/河牌1 */
  deckOverride?: number[]
}

export interface HandState {
  handNo: number
  seed: number
  level: BlindLevel
  buttonSeat: number
  sbSeat: number | null
  bbSeat: number
  /** 长度 9，null = 空座/已淘汰 */
  seats: (SeatState | null)[]
  /** 洗好的整副牌（回放需要），dealIdx 之前的已发出 */
  deck: Card[]
  dealIdx: number
  board: Card[]
  street: Street
  /** 当前行动座位，-1 = 无人行动（发牌/摊牌阶段） */
  actionOn: number
  /** 本条街需跟到的额度 */
  currentBet: number
  /** 上一次完整加注的增量（不完整加注判定与 minRaise 基数）；每街重置为 bb */
  lastFullRaiseSize: number
  /** 本条街最后一个主动下注/加注者（摊牌顺序用），-1 = 无 */
  lastAggressor: number
  /** 本条街的下注/加注次数（翻前 open=1、3bet=2…；线路推导用） */
  raisesThisStreet: number
  /** 整手牌中最近一次下注/加注者（主动权归属；-1 = 尚无人加注，如 limp 底池） */
  handAggressor: number
  /** 上一条街的最后进攻者（连续下注/barrel 判定），-1 = 上街无人下注或本街为翻前 */
  prevStreetAggressor: number
}

export interface LegalActions {
  canFold: boolean
  canCheck: boolean
  /** 需要补的跟注额（已按剩余筹码截断）；0 表示无需跟注 */
  callAmount: number
  /** 是否可下注/加注 */
  canRaise: boolean
  /** 是否为本街首注（bet）而非加注（raise） */
  isBet: boolean
  /** 最小加注"到"的额度（已按 all-in 截断） */
  minRaiseTo: number
  /** 最大加注"到"的额度 = committed + stack（all-in） */
  maxRaiseTo: number
}

export type AiStyleId =
  // 基础风格
  | 'tag'
  | 'lag'
  | 'rock'
  | 'station'
  | 'maniac'
  // 传奇选手（各自独立参数）
  | 'ivey'
  | 'dwan'
  | 'hellmuth'
  | 'negreanu'
  | 'brunson'
  | 'isildur'
  | 'chan'
  | 'ungar'

export interface TournamentConfig {
  seed: number
  startingStack: number
  handsPerLevel: number
  levels: BlindLevel[]
  /** 名次奖金（虚拟币），下标 0 = 冠军 */
  payouts: number[]
  /** 座位可选：不填按下标；6 人/单挑用稀疏座位以便牌桌布局均衡 */
  players: { id: string; name: string; style: AiStyleId | 'human'; seat?: number }[]
}

export interface TournamentPlayer {
  id: string
  name: string
  style: AiStyleId | 'human'
  seat: number
  stack: number
  /** null = 仍在比赛；1 = 冠军 */
  rank: number | null
  prize: number
}

export interface TournamentState {
  config: TournamentConfig
  /** 已完成的手数；下一手为 handNo+1 */
  handNo: number
  players: TournamentPlayer[]
  buttonSeat: number
  sbSeat: number | null
  bbSeat: number
  finished: boolean
}
