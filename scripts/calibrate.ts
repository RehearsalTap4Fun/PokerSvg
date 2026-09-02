import { GameController } from '../src/store/gameController'
import { defaultConfig } from '../src/data/blindSchedule'
import { emptyCounters, ratesOf, type StatCounters } from '../src/analysis/playerStats'
import type { AiStyleId } from '../src/core/types'

// 校准脚本：全同风格桌自打若干场，输出该风格的实测行为统计（用于 ai/adapt.ts 的 REF 与风格调参）。
// 用法：npx vite-node scripts/calibrate.ts [styleId=tag] [games=6]

const styleId = (process.argv[2] ?? 'tag') as AiStyleId
const games = Number(process.argv[3] ?? 6)
const total = emptyCounters()
let hands = 0
for (let g = 0; g < games; g++) {
  const cfg = defaultConfig(
    9000 + g * 17,
    Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, name: `X${i}`, style: styleId })),
  )
  const gc = new GameController(cfg, -1)
  let guard = 0
  while (!gc.finished && guard < 200) {
    guard++
    gc.startNextHand()
    gc.runAiUntilHuman()
  }
  hands += gc.ts.handNo
  for (let s = 0; s < 9; s++) {
    const c = gc.model.counters(s)
    for (const k of Object.keys(total) as (keyof StatCounters)[]) total[k] += c[k]
  }
}
const r = ratesOf(total)
console.log(JSON.stringify({ styleId, games, hands, vpip: +r.vpip.toFixed(3), pfr: +r.pfr.toFixed(3), threeBet: +r.threeBet.toFixed(3), limp: +r.limp.toFixed(3), cbet: +r.cbet.toFixed(3), foldToCbet: +r.foldToCbet.toFixed(3), af: +r.af.toFixed(2), foldVsBet: +r.foldVsBet.toFixed(3), wtsd: +r.wtsd.toFixed(3), wsd: +r.wsd.toFixed(3) }))
