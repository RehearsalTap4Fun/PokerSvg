import { legalActions } from '../core/betting'
import { currentPot } from '../core/hand'
import { rankOf } from '../core/cards'
import type { Action, HandState } from '../core/types'
import type { Rng } from '../core/rng'
import { equityMC } from '../analysis/equity'
import { requiredEquity } from '../analysis/evCalc'
import { Bucket, bucketOf } from '../analysis/buckets'
import { boardTexture } from '../analysis/texture'
import { icmRequiredEquity, icmEquities } from '../analysis/icm'
import type { Range } from '../analysis/range'
import { policyForCards, type ActionDist, type Line, type PublicSituation } from './policy'
import { positionOf, type Position } from './preflopCharts'
import type { AiStyle } from './styles'

// AI 决策入口：policy 分布 + 一组有界精修（equity / 对手模型 / 踢脚 / ICM）+ 种子化采样 + sizing。
// equity 用主线程同步 MC（≤1500 trials，2-5ms），保证单次决策 <50ms。
// 下注尺度只由局面（街/纹理/SPR/风格）决定，不随牌力变化——避免尺度泄露牌力。

export interface DecideContext {
  state: HandState
  seat: number
  style: AiStyle
  /** 其他座位的推断范围（公共观察者视角） */
  ranges: ReadonlyMap<number, Range>
  rng: Rng
  /** 其他座位在本 AI 眼中的风格（对手模型；缺省 = 不做对手针对性调整） */
  styleFor?: (seat: number) => AiStyle
  /** 奖金结构（ICM 调整用；缺省 = 纯筹码 EV） */
  payouts?: readonly number[]
}

/** seat 在按钮后的顺时针距离（按钮本身 = 9，最晚行动） */
function clockwiseFromButton(seat: number, buttonSeat: number): number {
  const d = (seat - buttonSeat + 9) % 9
  return d === 0 ? 9 : d
}

/** 从（行动前的）牌局状态构造公开局面描述——decide 与 inference 观察共用 */
export function situationFor(state: HandState, seat: number): PublicSituation {
  const me = state.seats[seat]
  if (!me) throw new Error(`座位 ${seat} 为空`)
  const bb = state.level.bb
  const playersInHand = state.seats.filter((s) => s !== null).length
  const contenders = state.seats.filter((s) => s && !s.folded)
  const toCall = Math.max(0, state.currentBet - me.committed)

  // 有效筹码：我的全部 vs 未弃牌对手中的最大全部
  let maxOpp = 0
  for (const s of contenders) {
    if (s && s.seat !== seat) maxOpp = Math.max(maxOpp, s.stack + s.committed)
  }
  const eff = Math.min(me.stack + me.committed, maxOpp)

  let line: Line
  if (state.street === 'preflop') {
    if (state.raisesThisStreet === 0) {
      const hasLimper = contenders.some((s) => s && s.seat !== state.bbSeat && s.committed >= bb)
      line = hasLimper ? 'vsLimp' : 'unopened'
      // 面对短码盲注 all-in 也可能 toCall>0 但无 raise：仍视为 unopened/vsLimp
    } else if (toCall >= eff * 0.6 && toCall > 0) {
      line = 'vsShove'
    } else if (state.raisesThisStreet === 1) {
      line = 'vsOpen'
    } else {
      line = 'vs3bet'
    }
  } else {
    line = state.raisesThisStreet === 0 ? 'noBet' : state.raisesThisStreet === 1 ? 'vsBet' : 'vsRaise'
  }

  const posOf = (s: number): Position => positionOf(s, state.buttonSeat, state.sbSeat, state.bbSeat, playersInHand)
  const aggressorPos = state.lastAggressor >= 0 && state.seats[state.lastAggressor] ? posOf(state.lastAggressor) : null

  // 翻后位置：在所有仍可行动（未弃牌、未 all-in）的对手之后行动 = 有位置
  let inPosition = true
  if (state.street !== 'preflop') {
    const myDist = clockwiseFromButton(seat, state.buttonSeat)
    for (const s of contenders) {
      if (s && s.seat !== seat && !s.allIn && clockwiseFromButton(s.seat, state.buttonSeat) > myDist) {
        inPosition = false
        break
      }
    }
  } else {
    inPosition = false
  }

  const pot = currentPot(state)
  const tex = state.board.length >= 3 ? boardTexture(state.board) : null

  return {
    street: state.street,
    position: posOf(seat),
    line,
    toCallBB: toCall / bb,
    potBB: pot / bb,
    effBB: eff / bb,
    nActive: contenders.length,
    board: state.board,
    raiseToBB: state.currentBet / bb,
    aggressorPos,
    hasAnte: state.level.ante > 0,
    inPosition,
    isAggressor: state.handAggressor === seat,
    barreling: state.prevStreetAggressor === seat,
    spr: pot > 0 ? eff / pot : 20,
    wetness: tex ? tex.wetness : 0,
    paired: tex ? tex.paired : false,
  }
}

function shiftMass(dist: ActionDist, from: (keyof ActionDist)[], to: keyof ActionDist, fraction: number): void {
  for (const k of from) {
    const moved = dist[k] * fraction
    dist[k] -= moved
    dist[to] += moved
  }
}

/** 我方全下/推被最大对手跟注时的 ICM 风险溢价（所需胜率的奖金口径 − 筹码口径），≥0 */
function pushRiskPremium(state: HandState, seat: number, payouts: readonly number[]): number {
  const me = state.seats[seat]
  if (!me || payouts.length === 0) return 0
  const seats = state.seats.filter((s): s is NonNullable<typeof s> => s !== null)
  if (seats.length <= payouts.length) {
    // 已全员进钱圈：仍有名次差价，但风险溢价通常小；按同一公式计算
  }
  let villainIdx = -1
  let villainStack = -1
  seats.forEach((s, i) => {
    if (s.seat !== seat && !s.folded && s.stack + s.committed > villainStack) {
      villainStack = s.stack + s.committed
      villainIdx = i
    }
  })
  if (villainIdx < 0) return 0
  const myIdx = seats.findIndex((s) => s.seat === seat)
  const pot = currentPot(state)
  const mine = me.stack + me.committed
  const risk = Math.min(mine, villainStack)
  const base = seats.map((s) => s.stack + s.committed)
  // 赢：我拿到底池 + 对手的 risk；输：我剩 mine - risk；弃：维持（底池已含盲注，忽略）
  const win = base.slice()
  win[myIdx] = mine + (pot - me.committed - (seats[villainIdx].committed ?? 0)) + risk
  win[villainIdx] = villainStack - risk
  const lose = base.slice()
  lose[myIdx] = mine - risk
  lose[villainIdx] = villainStack + risk + (pot - me.committed - (seats[villainIdx].committed ?? 0))
  const fold = base.slice()
  fold[myIdx] = me.stack
  const eqWin = icmEquities(win, payouts)[myIdx]
  const eqLose = icmEquities(lose, payouts)[myIdx]
  const eqFold = icmEquities(fold, payouts)[myIdx]
  if (eqWin - eqLose <= 1e-9) return 0
  const needIcm = (eqFold - eqLose) / (eqWin - eqLose)
  const needChip = risk / (2 * risk + Math.max(0, pot - me.committed))
  return Math.max(0, needIcm - needChip)
}

export function decideAi(ctx: DecideContext): Action {
  const { state, seat, style, rng } = ctx
  const me = state.seats[seat]!
  const legal = legalActions(state)
  const sit = situationFor(state, seat)
  const [c1, c2] = me.holeCards!
  const dist: ActionDist = { ...policyForCards(style, sit, c1, c2) }
  const pot = currentPot(state)
  const toCall = legal.callAmount
  const bucket = state.street !== 'preflop' ? bucketOf(c1, c2, state.board) : null

  // —— equity 有界精修（面对下注时）——
  if (toCall > 0 && state.street !== 'preflop') {
    const opponents: Range[] = []
    for (const s of state.seats) {
      if (s && !s.folded && s.seat !== seat) {
        const r = ctx.ranges.get(s.seat)
        if (r) opponents.push(r)
      }
    }
    if (opponents.length > 0) {
      const eq = equityMC({ hero: [c1, c2], board: state.board, opponents }, 1200, rng).equity
      const needed = requiredEquity(pot, toCall)
      if (eq < needed - 0.04) {
        shiftMass(dist, ['call', 'raise'], 'fold', Math.min(0.3, (needed - eq) * 1.8))
      } else if (eq > needed + 0.15) {
        shiftMass(dist, ['fold'], 'call', Math.min(0.3, (eq - needed - 0.15) * 2))
        if (eq > 0.72) shiftMass(dist, ['call'], 'raise', 0.2)
      }
    }
  }

  // —— 桶内梯度：顶对弱踢脚更保守（policy 只看桶；AI 知道具体牌） ——
  if (bucket === Bucket.TopPair) {
    const r1 = rankOf(c1)
    const r2 = rankOf(c2)
    const overpair = r1 === r2
    const kicker = Math.min(r1, r2)
    if (!overpair && kicker < 8) {
      // 踢脚低于 T：面对下注少加注、略多弃牌；主动下注略减
      if (toCall > 0) {
        shiftMass(dist, ['raise'], 'call', 0.5)
        shiftMass(dist, ['call'], 'fold', 0.12)
      } else {
        shiftMass(dist, ['raise'], 'check', 0.15)
      }
    }
  }

  // —— 对手针对性精修（有界）：面对下注者的诈唬倾向决定抓诈/让步；面对高频 3bet 者少弃牌 ——
  if (ctx.styleFor && toCall > 0) {
    const aggrSeat = state.lastAggressor
    if (aggrSeat >= 0 && aggrSeat !== seat) {
      const villain = ctx.styleFor(aggrSeat)
      if (state.street !== 'preflop') {
        const bluffiness = villain.bluffFreq / 0.12 // 相对紧凶基准
        if (bucket === Bucket.WeakPair || bucket === Bucket.TopPair || bucket === Bucket.StrongDraw) {
          if (bluffiness > 1.15) shiftMass(dist, ['fold'], 'call', Math.min(0.25, (bluffiness - 1) * 0.12))
          else if (bluffiness < 0.8) shiftMass(dist, ['call'], 'fold', Math.min(0.2, (1 - bluffiness) * 0.3))
        }
      } else if (sit.line === 'vs3bet' && villain.threeBet > 1.4) {
        const k = Math.min(0.2, (villain.threeBet - 1) * 0.1)
        shiftMass(dist, ['fold'], 'call', k)
        shiftMass(dist, ['fold'], 'raise', k * 0.4)
      }
    }
  }

  // —— ICM 精修：面对可能被淘汰的跟注 / 自己的推全下，按奖金口径的风险溢价收紧 ——
  if (ctx.payouts && ctx.payouts.length > 0) {
    const payouts = ctx.payouts
    if (toCall > 0 && toCall >= me.stack * 0.4) {
      const needIcm = icmRequiredEquity(state, seat, payouts)
      if (needIcm !== null) {
        const premium = needIcm - requiredEquity(pot, toCall)
        if (premium > 0.02) shiftMass(dist, ['call', 'raise'], 'fold', Math.min(0.6, premium * 4))
      }
    } else if (toCall === 0 || toCall < me.stack * 0.4) {
      // 自己主动推（短码域的加注即全下，或翻后大注会让自己 commit）：按被最大对手跟注的风险溢价收紧
      const wouldCommit = state.street === 'preflop' ? sit.effBB <= 12 : pot * 0.7 > me.stack * 0.5
      if (wouldCommit && dist.raise > 0.02) {
        const premium = pushRiskPremium(state, seat, payouts)
        if (premium > 0.02) shiftMass(dist, ['raise'], toCall > 0 ? 'fold' : legal.canCheck ? 'check' : 'fold', Math.min(0.5, premium * 3))
      }
    }
  }

  // —— 合法性调整 ——
  if (!legal.canRaise) {
    dist.call += dist.raise
    dist.raise = 0
  }
  if (legal.canCheck) {
    // 免费看牌时不弃牌
    dist.check += dist.fold
    dist.fold = 0
    if (toCall === 0) {
      dist.check += dist.call
      dist.call = 0
    }
  } else if (dist.check > 0) {
    dist.call += dist.check
    dist.check = 0
  }
  // —— 采样 ——
  const total = dist.fold + dist.check + dist.call + dist.raise
  let roll = rng() * (total > 0 ? total : 1)
  let action: Action
  if (total <= 0) {
    action = legal.canCheck ? { type: 'check' } : { type: 'fold' }
  } else if ((roll -= dist.fold) < 0) {
    action = legal.canCheck ? { type: 'check' } : { type: 'fold' }
  } else if ((roll -= dist.check) < 0) {
    action = { type: 'check' }
  } else if ((roll -= dist.call) < 0) {
    action = toCall > 0 ? { type: 'call' } : { type: 'check' }
  } else {
    action = mkRaise(state, seat, style, sit, legal.isBet, legal.minRaiseTo, legal.maxRaiseTo, rng)
  }
  return action
}

/** 翻后下注占底池比例：只看街/纹理/人数/风格，不看牌力 */
export function betFraction(sit: PublicSituation, style: AiStyle): number {
  let f: number
  if (sit.street === 'flop') f = 0.38 + 0.34 * sit.wetness // 干 1/3 池 ~ 湿 2/3 池
  else if (sit.street === 'turn') f = 0.6 + 0.15 * sit.wetness
  else f = 0.7 // 河牌两极化尺度
  if (sit.nActive > 2) f *= 0.9
  if (sit.spr < 1.5) f = Math.max(f, 0.8) // 低 SPR 直接做大
  return Math.min(1.2, Math.max(0.3, f * style.betSizing))
}

function mkRaise(
  state: HandState,
  seat: number,
  style: AiStyle,
  sit: PublicSituation,
  isBet: boolean,
  minTo: number,
  maxTo: number,
  rng: Rng,
): Action {
  const me = state.seats[seat]!
  const bb = state.level.bb
  const pot = currentPot(state)
  const myTotal = me.stack + me.committed
  let to: number

  if (state.street === 'preflop') {
    if (sit.effBB <= 10) {
      to = maxTo // 短码域：加注即全下
    } else if (state.raisesThisStreet === 0) {
      const limpers = state.seats.filter((s) => s && !s.folded && s.seat !== state.bbSeat && s.committed >= bb).length
      to = Math.round(style.openSize * bb + limpers * bb)
    } else {
      const oop = sit.position === 'sb' || sit.position === 'bb' || sit.position === 'early'
      to = Math.round(state.currentBet * (state.raisesThisStreet === 1 ? (oop ? 3.6 : 3.0) : 2.4))
    }
  } else if (isBet) {
    to = Math.round(pot * betFraction(sit, style))
  } else {
    // 翻后加注：约 2.8 倍对手注 + 少量底池，风格尺度系数减半作用
    to = Math.round((state.currentBet * 2.8 + pot * 0.1) * Math.sqrt(style.betSizing))
  }
  // ±10% 噪声，取整到 sb 的倍数更自然
  to = Math.round(to * (0.92 + rng() * 0.18))
  const sbUnit = Math.max(1, state.level.sb)
  to = Math.round(to / sbUnit) * sbUnit
  if (to > 0.58 * myTotal) to = maxTo // 投入过半直接全下
  to = Math.max(minTo, Math.min(maxTo, to))
  return isBet ? { type: 'bet', to } : { type: 'raise', to }
}
