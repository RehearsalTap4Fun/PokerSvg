import type { HandEvent } from '../core/events'
import type { Street } from '../core/types'

// 玩家行为统计：只从事件流的公开信息（动作/街/位置）提取，不看任何底牌——
// 这是 AI 对手建模的唯一信息源，保证 AI"读人"用的是真实牌桌也能获得的数据。
// 同一份统计同时驱动 HUD 数据页与 ai/adapt.ts 的动态风格推导。

export interface StatCounters {
  /** 发到牌的手数 */
  hands: number
  /** 翻前自愿入池（跟注/加注，盲注不算）手数 */
  vpip: number
  /** 翻前加注手数 */
  pfr: number
  /** 面对单次 open 的机会数 */
  threeBetOpp: number
  threeBet: number
  /** 无人加注时（非 BB）有机会 limp 的次数 */
  limpOpp: number
  limp: number
  /** 翻牌作为翻前进攻者、面对无下注的首次行动机会 */
  cbetOpp: number
  cbet: number
  /** 翻牌面对翻前进攻者 c-bet 的次数 */
  faceCbetOpp: number
  foldToCbet: number
  /** 翻后主动下注/加注次数 */
  postBets: number
  /** 翻后跟注次数 */
  postCalls: number
  /** 翻后面对下注/加注的次数 */
  postFaceBet: number
  postFolds: number
  /** 翻后 check-raise 次数 */
  checkRaise: number
  sawFlop: number
  /** 见翻牌后走到摊牌 */
  wtsd: number
  /** 摊牌赢 */
  wsd: number
  /** 翻前全下次数 */
  allInPre: number
}

export function emptyCounters(): StatCounters {
  return {
    hands: 0,
    vpip: 0,
    pfr: 0,
    threeBetOpp: 0,
    threeBet: 0,
    limpOpp: 0,
    limp: 0,
    cbetOpp: 0,
    cbet: 0,
    faceCbetOpp: 0,
    foldToCbet: 0,
    postBets: 0,
    postCalls: 0,
    postFaceBet: 0,
    postFolds: 0,
    checkRaise: 0,
    sawFlop: 0,
    wtsd: 0,
    wsd: 0,
    allInPre: 0,
  }
}

export function addCounters(into: StatCounters, from: StatCounters): void {
  for (const k of Object.keys(into) as (keyof StatCounters)[]) into[k] += from[k]
}

/** 由一手牌的事件流提取每个座位的统计增量（键 = 座位号） */
export function handStats(events: readonly HandEvent[]): Map<number, StatCounters> {
  const out = new Map<number, StatCounters>()
  const start = events[0]
  if (!start || start.t !== 'handStart') return out

  const bb = start.bbSeat
  for (const s of start.seats) {
    const c = emptyCounters()
    c.hands = 1
    out.set(s.seat, c)
  }
  const perHand = new Map<number, { vpip: boolean; pfr: boolean; sawFlop: boolean; showdown: boolean; won: boolean }>()
  for (const s of start.seats) perHand.set(s.seat, { vpip: false, pfr: false, sawFlop: false, showdown: false, won: false })

  let street: Street = 'preflop'
  let raisesThisStreet = 0
  let lastAggressor = -1
  let preflopAggressor = -1
  const folded = new Set<number>()
  const checkedThisStreet = new Set<number>()

  for (let i = 1; i < events.length; i++) {
    const e = events[i]
    switch (e.t) {
      case 'street': {
        if (street === 'preflop') preflopAggressor = lastAggressor
        street = e.street
        raisesThisStreet = 0
        lastAggressor = -1
        checkedThisStreet.clear()
        if (e.street === 'flop') {
          for (const s of start.seats) if (!folded.has(s.seat)) perHand.get(s.seat)!.sawFlop = true
        }
        break
      }
      case 'action': {
        const c = out.get(e.seat)
        const h = perHand.get(e.seat)
        if (!c || !h) break
        const a = e.action.type
        const aggressive = a === 'bet' || a === 'raise'
        if (street === 'preflop') {
          if (raisesThisStreet === 0) {
            if (e.seat !== bb) {
              c.limpOpp++
              if (a === 'call') c.limp++
            }
          } else if (raisesThisStreet === 1) {
            c.threeBetOpp++
            if (a === 'raise') c.threeBet++
          }
          if (a === 'call' || aggressive) h.vpip = true
          if (aggressive) h.pfr = true
          if (aggressive && e.allIn) c.allInPre++
        } else {
          if (raisesThisStreet === 0) {
            if (street === 'flop' && e.seat === preflopAggressor) {
              c.cbetOpp++
              if (a === 'bet') c.cbet++
            }
            if (a === 'check') checkedThisStreet.add(e.seat)
          } else {
            c.postFaceBet++
            if (a === 'fold') c.postFolds++
            if (street === 'flop' && raisesThisStreet === 1 && lastAggressor === preflopAggressor && e.seat !== preflopAggressor) {
              c.faceCbetOpp++
              if (a === 'fold') c.foldToCbet++
            }
            if (a === 'raise' && checkedThisStreet.has(e.seat)) c.checkRaise++
          }
          if (aggressive) c.postBets++
          if (a === 'call') c.postCalls++
        }
        if (aggressive) {
          raisesThisStreet++
          lastAggressor = e.seat
        }
        if (a === 'fold') folded.add(e.seat)
        break
      }
      case 'showdown': {
        const h = perHand.get(e.seat)
        if (h) h.showdown = true
        break
      }
      case 'potAward': {
        const h = perHand.get(e.seat)
        if (h && e.reason === 'win') h.won = true
        break
      }
      default:
        break
    }
  }

  for (const [seat, h] of perHand) {
    const c = out.get(seat)!
    if (h.vpip) c.vpip++
    if (h.pfr) c.pfr++
    if (h.sawFlop) c.sawFlop++
    if (h.sawFlop && h.showdown) c.wtsd++
    if (h.sawFlop && h.showdown && h.won) c.wsd++
  }
  return out
}

export interface StatRates {
  hands: number
  vpip: number
  pfr: number
  /** 3bet 频率（面对 open 时） */
  threeBet: number
  limp: number
  cbet: number
  foldToCbet: number
  /** 翻后进攻因子 (bet+raise)/call */
  af: number
  /** 翻后面对下注的弃牌率 */
  foldVsBet: number
  wtsd: number
  wsd: number
  /** 各分母（HUD 决定是否显示"—"） */
  n: { threeBet: number; limp: number; cbet: number; foldToCbet: number; af: number; foldVsBet: number; wtsd: number; wsd: number }
}

const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0)

export function ratesOf(c: StatCounters): StatRates {
  return {
    hands: c.hands,
    vpip: ratio(c.vpip, c.hands),
    pfr: ratio(c.pfr, c.hands),
    threeBet: ratio(c.threeBet, c.threeBetOpp),
    limp: ratio(c.limp, c.limpOpp),
    cbet: ratio(c.cbet, c.cbetOpp),
    foldToCbet: ratio(c.foldToCbet, c.faceCbetOpp),
    af: c.postCalls > 0 ? c.postBets / c.postCalls : c.postBets > 0 ? 4 : 0,
    foldVsBet: ratio(c.postFolds, c.postFaceBet),
    wtsd: ratio(c.wtsd, c.sawFlop),
    wsd: ratio(c.wsd, c.wtsd),
    n: {
      threeBet: c.threeBetOpp,
      limp: c.limpOpp,
      cbet: c.cbetOpp,
      foldToCbet: c.faceCbetOpp,
      af: c.postBets + c.postCalls,
      foldVsBet: c.postFaceBet,
      wtsd: c.sawFlop,
      wsd: c.wtsd,
    },
  }
}
