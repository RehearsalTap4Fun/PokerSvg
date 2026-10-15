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

// —— 偏好（与存档分离，改动不影响进度） ——

const PREFS_KEY = 'poker-prefs-v1'

export interface Prefs {
  roster: 'legend' | 'classic'
  size: 9 | 6 | 2
  structure: 'standard' | 'turbo' | 'deep'
  /** 诚实推断：范围推断只用可观察统计，不用 AI 真实策略 */
  honest: boolean
  /** 观察员点评：每次出手后给出职业牌手视角的评价 */
  commentator: boolean
}

export const DEFAULT_PREFS: Prefs = { roster: 'legend', size: 9, structure: 'standard', honest: false, commentator: true }

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw) as Partial<Prefs>
    return {
      roster: p.roster === 'classic' ? 'classic' : 'legend',
      size: p.size === 6 || p.size === 2 ? p.size : 9,
      structure: p.structure === 'turbo' || p.structure === 'deep' ? p.structure : 'standard',
      honest: !!p.honest,
      commentator: p.commentator !== false,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function persistPrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
