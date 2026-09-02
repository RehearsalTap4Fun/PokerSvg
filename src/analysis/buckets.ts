import { rankOf, suitOf } from '../core/cards'
import { CAT_FLUSH, CAT_PAIR, CAT_STRAIGHT, CAT_TRIPS, CAT_TWO_PAIR, categoryOf, evaluateCards } from '../core/evaluator'
import { COMBO_CARDS, COMBO_COUNT, cardsToMask, comboBlocked } from '../core/handClass'

// 翻后手牌强度分桶：AI 策略与范围推断共用的"公开可计算"强度抽象。
// 对整个 1326 组合做一次 board pass（按牌面缓存），单组合 <2μs。

export const enum Bucket {
  Air = 0,
  WeakDraw = 1, // 卡顺 / 两高张
  StrongDraw = 2, // 同花听 / 两头顺听 / 组合听牌
  WeakPair = 3, // 中下对 / 低于顶对的口袋对
  TopPair = 4, // 顶对 / 超对
  Strong = 5, // 两对 / 三条(暗三/明三)
  Monster = 6, // 顺子及以上
}

export const BUCKET_NAMES_ZH = ['空气', '弱听牌', '强听牌', '弱对子', '顶对/超对', '两对/三条', '坚果级']

/** 5 连窗口（含 A-5 轮子），返回窗口掩码数组 */
const WINDOWS: number[] = []
{
  for (let high = 12; high >= 4; high--) WINDOWS.push(0b11111 << (high - 4))
  WINDOWS.push((1 << 12) | 0b1111) // A,2,3,4,5
}

function popcount13(m: number): number {
  let c = 0
  while (m) {
    m &= m - 1
    c++
  }
  return c
}

export function bucketOf(c1: number, c2: number, board: readonly number[]): Bucket {
  const cards = [c1, c2, ...board]
  const score = evaluateCards(cards)
  const cat = categoryOf(score)
  const r1 = rankOf(c1)
  const r2 = rankOf(c2)

  // 牌面信息
  let topBoard = -1
  let boardRankMask = 0
  for (const b of board) {
    const r = rankOf(b)
    if (r > topBoard) topBoard = r
    boardRankMask |= 1 << r
  }

  let made: Bucket = Bucket.Air
  if (cat >= CAT_STRAIGHT) {
    made = cat === CAT_STRAIGHT ? Bucket.Monster : Bucket.Monster // 顺子及以上统一坚果级
  } else if (cat === CAT_TRIPS || cat === CAT_TWO_PAIR) {
    // 需要至少一张手牌参与（板面两对/三条但手牌无关时不算成牌）
    const holeInvolved = (boardRankMask & (1 << r1) && cat >= CAT_TWO_PAIR) || r1 === r2 || (boardRankMask & (1 << r2)) !== 0 || (boardRankMask & (1 << r1)) !== 0
    made = holeInvolved ? Bucket.Strong : Bucket.Air
  } else if (cat === CAT_PAIR) {
    // 判断对子是否与手牌有关
    const pairRank = 31 - Math.clz32((score >> 13) & 0x1fff)
    const holePairInvolved = r1 === pairRank || r2 === pairRank
    if (r1 === r2) {
      // 口袋对：高于牌面最高张 = 超对
      made = r1 > topBoard ? Bucket.TopPair : Bucket.WeakPair
    } else if (holePairInvolved) {
      made = pairRank === topBoard ? Bucket.TopPair : Bucket.WeakPair
    } else {
      made = Bucket.Air // 板面对，手牌未参与
    }
  } else if (cat === CAT_FLUSH) {
    made = Bucket.Monster
  }

  if (made >= Bucket.WeakPair && made !== Bucket.WeakPair) return made
  if (board.length >= 5) return made // 河牌无听牌

  // 听牌检测（需手牌参与）
  let draw: Bucket = Bucket.Air
  const s1 = suitOf(c1)
  const s2 = suitOf(c2)
  const suitCount = [0, 0, 0, 0]
  for (const b of board) suitCount[suitOf(b)]++
  const holeSuited = s1 === s2
  // 同花听：手牌至少 1 张参与凑满 4 张同花
  if ((holeSuited && suitCount[s1] === 2) || (!holeSuited && (suitCount[s1] === 3 || suitCount[s2] === 3)) || (holeSuited && suitCount[s1] === 3)) {
    // 已成同花在上面处理过；这里是恰好 4 张
    const total1 = suitCount[s1] + (holeSuited ? 2 : 1)
    const total2 = s2 === s1 ? total1 : suitCount[s2] + 1
    if (total1 === 4 || total2 === 4) draw = Bucket.StrongDraw
  }
  // 顺子听：全掩码中 4/5 窗口且手牌参与
  if (draw < Bucket.StrongDraw) {
    const fullMask = boardRankMask | (1 << r1) | (1 << r2)
    const holeMask = (1 << r1) | (1 << r2)
    let fourWindows = 0
    let holeIn = false
    for (const w of WINDOWS) {
      if (popcount13(fullMask & w) >= 4 && popcount13(boardRankMask & w) < 4) {
        fourWindows++
        if (holeMask & w) holeIn = true
      }
    }
    if (holeIn) {
      if (fourWindows >= 2) draw = Bucket.StrongDraw // 两个窗口 ≈ 两头顺听
      else if (fourWindows === 1) draw = draw < Bucket.WeakDraw ? Bucket.WeakDraw : draw
    }
  }
  // 两高张（高于牌面）算弱听牌
  if (draw === Bucket.Air && made === Bucket.Air && r1 > topBoard && r2 > topBoard) draw = Bucket.WeakDraw

  return made > draw ? made : draw
}

// —— board pass 缓存：一次算好全部 1326 组合的桶 ——

const bucketCache = new Map<string, Uint8Array>()

export function bucketsForBoard(board: readonly number[]): Uint8Array {
  const key = board.join(',')
  const hit = bucketCache.get(key)
  if (hit) return hit
  const out = new Uint8Array(COMBO_COUNT)
  const { lo, hi } = cardsToMask(board)
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (comboBlocked(i, lo, hi)) continue
    out[i] = bucketOf(COMBO_CARDS[i * 2], COMBO_CARDS[i * 2 + 1], board)
  }
  if (bucketCache.size > 40) bucketCache.clear()
  bucketCache.set(key, out)
  return out
}
