import type { Card } from './cards'
import type { Action, BlindLevel, Street } from './types'

// 事件溯源：HandEvent 流是复盘回放与 UI 动画的唯一事实源。
// 引擎同步产生事件，gameController 按节奏播放；Replay 界面逐事件重建视图。

export type HandEvent =
  | {
      t: 'handStart'
      handNo: number
      level: BlindLevel
      buttonSeat: number
      sbSeat: number | null
      bbSeat: number
      seats: { seat: number; playerId: string; stack: number }[]
      seed: number
    }
  | { t: 'postAnte'; seat: number; amount: number; allIn: boolean }
  | { t: 'postSB'; seat: number; amount: number; allIn: boolean }
  | { t: 'postBB'; seat: number; amount: number; allIn: boolean }
  | { t: 'dealHole'; seat: number; cards: [Card, Card] } // 单机版全记录（复盘上帝视角）
  | { t: 'action'; seat: number; action: Action; paid: number; allIn: boolean }
  | { t: 'street'; street: Street; cards: Card[] } // flop 3 张 / turn、river 1 张
  | { t: 'showdown'; seat: number; cards: [Card, Card]; reveal: boolean; score: number; desc: string }
  | { t: 'potAward'; potIndex: number; seat: number; amount: number; reason: 'win' | 'uncalled' | 'uncontested' }
  | { t: 'handEnd'; stacks: { seat: number; stack: number }[]; busted: number[] }
