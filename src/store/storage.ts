import type { TournamentState } from '../core/types'
import type { HandRecord } from './gameController'

// localStorage 版本化存档：战绩汇总 + 未完赛进度 + 手牌历史（FIFO 上限）。
// 写入失败（配额/隐私模式）静默降级——游戏本体不依赖存档。

const KEY = 'poker-save-v1'
const MAX_HISTORY = 120

export interface CareerStats {
  played: number
  wins: number
  cashes: number // 前三名次数
  totalPrize: number
  totalBuyin: number
}

export interface SaveData {
  version: 1
  stats: CareerStats
  /** 未完成的锦标赛（手与手之间保存；无则为 null） */
  ongoing: { ts: TournamentState; history: HandRecord[] } | null
  /** 已完赛的手牌历史（最近若干手，复盘用），附带当场的玩家风格表 */
  archive: { finishedAt: string; ts: TournamentState; history: HandRecord[] }[]
}

export function emptySave(): SaveData {
  return {
    version: 1,
    stats: { played: 0, wins: 0, cashes: 0, totalPrize: 0, totalBuyin: 0 },
    ongoing: null,
    archive: [],
  }
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptySave()
    const data = JSON.parse(raw) as SaveData
    if (data.version !== 1) return emptySave() // 未来版本在此 migrate
    return data
  } catch {
    return emptySave()
  }
}

export function persistSave(data: SaveData): void {
  try {
    // 历史上限：先裁 archive 场次，再裁每场手数
    while (data.archive.length > 6) data.archive.shift()
    let totalHands = data.archive.reduce((s, a) => s + a.history.length, 0) + (data.ongoing?.history.length ?? 0)
    while (totalHands > MAX_HISTORY && data.archive.length > 0) {
      const oldest = data.archive[0]
      if (oldest.history.length > 0) {
        totalHands -= oldest.history.length
        data.archive.shift()
      } else {
        data.archive.shift()
      }
    }
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // 配额满/不可用：放弃本次写入
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
