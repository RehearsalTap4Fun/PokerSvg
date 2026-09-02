import { legalActions } from '../core/betting'
import { currentPot } from '../core/hand'
import type { Action, HandState } from '../core/types'
import type { Rng } from '../core/rng'
import { equityMC } from '../analysis/equity'
import { requiredEquity } from '../analysis/evCalc'
import { Bucket, bucketOf } from '../analysis/buckets'
import type { Range } from '../analysis/range'
import { policyForCards, type ActionDist, type Line, type PublicSituation } from './policy'
import { positionOf } from './preflopCharts'
import type { AiStyle } from './styles'

// AI 决策入口：policy 分布 + 实时 equity 有界精修（±30% 封顶）+ 种子化采样 + sizing。
// equity 用主线程同步 MC（≤1500 trials，2-5ms），保证单次决策 <50ms。

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

  return {
    street: state.street,
    position: positionOf(seat, state.buttonSeat, state.sbSeat, state.bbSeat, playersInHand),
    line,
    toCallBB: toCall / bb,
    potBB: currentPot(state) / bb,
    effBB: eff / bb,
    nActive: contenders.length,
    board: state.board,
  }
}

function shiftMass(dist: ActionDist, from: (keyof ActionDist)[], to: keyof ActionDist, fraction: number): void {
  for (const k of from) {
    const moved = dist[k] * fraction
    dist[k] -= moved
    dist[to] += moved
  }
}

export function decideAi(ctx: DecideContext): Action {
  const { state, seat, style, rng } = ctx
  const me = state.seats[seat]!
  const legal = legalActions(state)
  const sit = situationFor(state, seat)
  const [c1, c2] = me.holeCards!
  const dist: ActionDist = { ...policyForCards(style, sit, c1, c2) }

  // —— equity 有界精修（面对下注时）——
  const pot = currentPot(state)
  const toCall = legal.callAmount
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

  // —— 对手针对性精修（有界）：面对下注者的诈唬倾向决定抓诈/让步；面对高频 3bet 者少弃牌 ——
  if (ctx.styleFor && toCall > 0) {
    const aggrSeat = state.lastAggressor
    if (aggrSeat >= 0 && aggrSeat !== seat) {
      const villain = ctx.styleFor(aggrSeat)
      if (state.street !== 'preflop') {
        const bucket = bucketOf(c1, c2, state.board)
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
    action = mkRaise(state, seat, style, sit, legal.isBet, legal.minRaiseTo, legal.maxRaiseTo, rng, c1, c2)
  }
  return action
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
  c1: number,
  c2: number,
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
  } else {
    const bucket = bucketOf(c1, c2, state.board)
    const potFactor = bucket >= Bucket.Strong ? 0.72 : bucket === Bucket.TopPair ? 0.6 : 0.65
    if (isBet) {
      to = Math.round(pot * potFactor)
    } else {
      to = Math.round(state.currentBet * 2.6 + pot * 0.15)
    }
  }
  // ±10% 噪声，取整到 sb 的倍数更自然
  to = Math.round(to * (0.92 + rng() * 0.18))
  const sbUnit = Math.max(1, state.level.sb)
  to = Math.round(to / sbUnit) * sbUnit
  if (to > 0.58 * myTotal) to = maxTo // 投入过半直接全下
  to = Math.max(minTo, Math.min(maxTo, to))
  return isBet ? { type: 'bet', to } : { type: 'raise', to }
}
