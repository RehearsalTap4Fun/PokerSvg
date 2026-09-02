import { rankOf, suitOf } from '../core/cards'

// 牌面纹理：公开可计算的"湿/干"抽象，AI 策略与范围推断共用（按牌面缓存）。

export interface BoardTexture {
  /** 0 = 极干（彩虹、无连张），1 = 极湿（同花听/成花 + 多连张） */
  wetness: number
  /** 牌面有对 */
  paired: boolean
  /** 存在同花听（恰 2 张同花）或已可成花（≥3 张同花） */
  flushDraw: boolean
  flushPossible: boolean
  /** 牌面最高张 rank（0..12） */
  high: number
}

const WINDOWS: number[] = []
{
  for (let high = 12; high >= 4; high--) WINDOWS.push(0b11111 << (high - 4))
  WINDOWS.push((1 << 12) | 0b1111)
}

function popcount(m: number): number {
  let c = 0
  while (m) {
    m &= m - 1
    c++
  }
  return c
}

const cache = new Map<string, BoardTexture>()

export function boardTexture(board: readonly number[]): BoardTexture {
  const key = board.join(',')
  const hit = cache.get(key)
  if (hit) return hit
  const suitCount = [0, 0, 0, 0]
  let rankMask = 0
  let paired = false
  let high = -1
  for (const c of board) {
    suitCount[suitOf(c)]++
    const r = rankOf(c)
    if (rankMask & (1 << r)) paired = true
    rankMask |= 1 << r
    if (r > high) high = r
  }
  const maxSuit = Math.max(...suitCount)
  const flushPossible = maxSuit >= 3
  const flushDraw = maxSuit === 2 || flushPossible
  const flushComp = flushPossible ? 1 : maxSuit === 2 ? 0.5 : 0
  let windows3 = 0
  for (const w of WINDOWS) if (popcount(rankMask & w) >= 3) windows3++
  const straightComp = windows3 >= 3 ? 1 : windows3 === 2 ? 0.75 : windows3 === 1 ? 0.5 : 0
  const t: BoardTexture = {
    wetness: Math.min(1, 0.5 * flushComp + 0.5 * straightComp),
    paired,
    flushDraw,
    flushPossible,
    high,
  }
  if (cache.size > 200) cache.clear()
  cache.set(key, t)
  return t
}
