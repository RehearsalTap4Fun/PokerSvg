import { CLASS_COMBOS, classIdOfName } from '../core/handClass'

// 169 类翻前手牌强弱排序（现代锦标赛开牌顺序：兼顾对抗范围的 equity 与可玩性——
// 同花 A 小、同花连张排在同数值的不同花高牌之前）。取代 Chen 公式。
// 用途：百分位阈值（push/fold、范围展开/收窄的顺序）、复盘中的手牌强度分位。

const ORDER_TEXT = `
AA KK QQ AKs JJ AQs KQs AJs KJs AKo TT ATs QJs KTs QTs JTs 99 AQo A9s KQo
88 K9s T9s A8s Q9s J9s AJo A5s 77 A7s KJo ATo A4s A6s QJo A3s K8s T8s J8s 98s KTo
66 A2s QTo 55 JTo K7s 97s 87s Q8s 44 33 22 K6s A9o 76s T7s K5s 86s 65s Q7s
K4s J7s 96s 54s K3s A8o K2s Q6s 75s J9o T9o K9o A7o Q9o Q5s 64s 85s A5o Q4s J6s
A6o T6s A4o 98o Q3s 53s J5s A3o Q2s 74s 87o J8o T8o J4s A2o 43s K8o 95s 63s J3s
97o 76o J2s 84s T5s K7o T4s 52s 65o Q8o 86o 42s T3s 73s T2s K6o 54o 96o 75o 32s
K5o 94s J7o Q7o 62s 93s 85o K4o 64o 92s Q6o T7o K3o 83s 53o 74o 82s K2o 95o Q5o
J6o T6o 72s 43o 63o Q4o 84o J5o Q3o 52o T5o 73o J4o Q2o 94o 42o J3o T4o 93o 62o
J2o 83o 32o T3o 92o 82o T2o 72o
`

/** 强 → 弱 的 classId 顺序 */
export const HAND_ORDER: number[] = ORDER_TEXT.trim().split(/\s+/).map(classIdOfName)
{
  const seen = new Set(HAND_ORDER)
  if (HAND_ORDER.length !== 169 || seen.size !== 169) {
    const missing: number[] = []
    for (let c = 0; c < 169; c++) if (!seen.has(c)) missing.push(c)
    throw new Error(`手牌排序表不完整：${HAND_ORDER.length} 项 / ${seen.size} 唯一，缺 ${missing.join(',')}`)
  }
}

/** RANK_PCT[cls] = 该类在从强到弱累计组合数中的位置（区间中点，0 = 最强，1 = 最弱） */
export const RANK_PCT = new Float64Array(169)
{
  let cum = 0
  for (const cls of HAND_ORDER) {
    const n = CLASS_COMBOS[cls].length
    RANK_PCT[cls] = (cum + n / 2) / 1326
    cum += n
  }
}
