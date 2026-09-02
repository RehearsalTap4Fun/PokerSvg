import { applyAction, currentPot, setupHand } from '../core/hand'
import { legalActions } from '../core/betting'
import { CLASS_OF_COMBO, comboIndex, className } from '../core/handClass'
import { fmtChips } from '../core/format'
import { mixSeed, mulberry32 } from '../core/rng'
import type { HandState, Street, TournamentPlayer } from '../core/types'
import type { HandEvent } from '../core/events'
import type { HandRecord } from '../store/gameController'
import { situationFor } from '../ai/decide'
import { PERCENTILE } from '../ai/preflopCharts'
import { shouldPush } from '../ai/pushFold'
import { policyForCombo } from '../ai/policy'
import { STYLES } from '../ai/styles'
import { equityAuto, equityMC, rangeOfCombo } from './equity'
import { uniformRange } from './range'
import { requiredEquity } from './evCalc'
import { Bucket, bucketOf } from './buckets'
import { icmRequiredEquity } from './icm'

// 赛后复盘分析：完全由对局记录以固定规则生成（确定性，无模型参与）。
// 通过重放事件流重建每个英雄决策点（街/底池/需跟注额/位置/筹码深度/手牌类），
// 胜率优先取当局 HUD 快照（对推断范围），缺失时用固定种子蒙特卡洛补算。
// 对局类型（诈唬/被诈唬/bad beat 等）利用记录中的全部底牌做"结果论"判定。

export type Severity = 'bad' | 'warn' | 'info' | 'good'

export interface Finding {
  rule: string
  severity: Severity
  text: string
  handNo?: number
}

export interface PlayTypeStats {
  /** 纯诈唬拿下底池（下注时无成牌无强听） */
  bluffWins: number
  /** 半诈唬拿下底池（强听牌下注） */
  semiBluffWins: number
  /** 河牌诈唬被跟注抓住 */
  bluffCaught: number
  /** 面对下注弃掉了实际领先的牌（按对手真实手牌结果论判定） */
  gotBluffed: number
  /** check-raise 次数 */
  checkRaises: number
  /** 河牌价值下注被支付并赢下摊牌 */
  valueBetsPaid: number
  /** 最后决策时胜率 ≥72% 仍被反超输掉 */
  badBeats: number
  /** 最后决策时胜率 ≤28% 却赢下 */
  suckouts: number
  /** 筹码口径可跟、但 ICM 口径胜率不足的重注跟注次数（泡沫期漏洞） */
  icmLeaks: number
}

export interface PostmortemStats extends PlayTypeStats {
  hands: number
  rank: number | null
  prize: number
  netDelta: number
  vpip: number
  pfr: number
  threeBets: number
  sawFlopRate: number
  wtsd: number
  wsd: number
  allIns: number
  preflopFoldRate: number
  biggestWin: { handNo: number; delta: number } | null
  biggestLoss: { handNo: number; delta: number } | null
  /** 面对下注的跟注/弃牌相对最优（按当时胜率）的合计筹码损失 */
  evLoss: number
  /** 翻前偏松：基准≥90%弃牌的手牌却入池 */
  looseDeviations: number
  /** 翻前偏紧：基准≤10%弃牌的手牌却弃掉 */
  tightDeviations: number
}

/** 红蓝线：累计盈亏拆分为摊牌盈亏（蓝）与非摊牌盈亏（红） */
export interface CurvePoint {
  handNo: number
  total: number
  showdown: number
  nonShowdown: number
}

export interface Postmortem {
  stats: PostmortemStats
  findings: Finding[]
  curve: CurvePoint[]
}

interface Decision {
  handNo: number
  street: Street
  action: HandEvent & { t: 'action' }
  pot: number
  toCall: number
  equity: number | null
  effBB: number
  classId: number
  position: string
  line: string
  raisesBeforeAction: number
  canRaise: boolean
  /** 跟注可能导致淘汰时（跟注额 ≥ 剩余筹码 40%）的 ICM 口径所需胜率 */
  icmNeeded: number | null
  /** 行动时剩余筹码 */
  stack: number
  /** 翻前：紧凶基准在该局面对该手牌的弃牌概率（用于松/紧偏离判定） */
  baselineFold: number | null
}

interface GotBluffedCase {
  handNo: number
  street: Street
  eq: number
  aggrBucket: Bucket
}

interface HandReplay {
  decisions: Decision[]
  heroFoldedPreflop: boolean
  sawFlop: boolean
  showdown: boolean
  wonShowdown: boolean
  heroRiverEquity: number | null
  delta: number
  // 类型标记
  bluffWin: boolean
  semiBluffWin: boolean
  bluffCaught: boolean
  gotBluffed: GotBluffedCase | null
  checkRaises: number
  valueBetPaid: boolean
  /** 最后一次英雄行动时（发牌未完）对对手真实手牌的胜率 */
  finalEq: number | null
  /** 本手面对下注决策的合计 EV 损失（筹码） */
  evLoss: number
}

const STREET_ZH: Record<string, string> = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌' }
const POSITION_HINT: Record<string, string> = { early: '前位', middle: '中位', late: '后位', button: '按钮', sb: '小盲', bb: '大盲' }
const streetIdxOf: Record<string, number> = { preflop: 0, flop: 1, turn: 2, river: 3 }

/** 重放一手牌，提取英雄的全部决策点、结果与对局类型标记 */
function replayHand(rec: HandRecord, heroSeat: number, payouts: readonly number[]): HandReplay | null {
  const start = rec.events[0]
  if (!start || start.t !== 'handStart') return null
  if (!start.seats.some((s) => s.seat === heroSeat)) return null

  let state: HandState = setupHand({
    handNo: start.handNo,
    seed: start.seed,
    level: start.level,
    buttonSeat: start.buttonSeat,
    sbSeat: start.sbSeat,
    bbSeat: start.bbSeat,
    seats: start.seats.map((s) => ({ seat: s.seat, playerId: s.playerId, stack: s.stack })),
  }).state

  const decisions: Decision[] = []
  const startStack = start.seats.find((x) => x.seat === heroSeat)?.stack ?? 0
  let endStack = startStack
  let heroFoldedPreflop = false
  let sawFlop = false
  let showdown = false
  let wonShowdown = false
  let uncontestedWin = false
  let heroRiverEquity: number | null = null
  let heroCheckedStreet: Street | null = null
  let checkRaises = 0
  let lastAggr: { street: Street; bucket: Bucket } | null = null
  let gotBluffed: GotBluffedCase | null = null
  let lastActionCtx: { board: number[]; opps: [number, number][] } | null = null

  const snapEquity = (street: Street): number | null => {
    const snap = rec.equitySnapshots.filter((s) => s.street === street).pop()
    return snap ? snap.equity : null
  }

  /** 对手真实手牌的确定性胜率（结果论判定用） */
  const actualEquity = (heroCards: [number, number], board: readonly number[], opps: [number, number][], salt: number): number => {
    return equityAuto(
      { hero: heroCards, board, opponents: opps.map(([a, b]) => rangeOfCombo(a, b)) },
      2000,
      mulberry32(mixSeed(state.seed, salt)),
    ).equity
  }

  /** 翻前重注跟注的胜率（ICM 评价用）：快照优先，缺失时对"前 30% 推牌范围"确定性补算 */
  const preflopShoveEquity = (st: HandState): number | null => {
    const hero = st.seats[heroSeat]
    if (!hero?.holeCards) return null
    const snap = snapEquity('preflop')
    if (snap !== null) return snap
    const shoveRange = uniformRange()
    for (let i = 0; i < shoveRange.length; i++) shoveRange[i] = PERCENTILE[CLASS_OF_COMBO[i]] <= 0.3 ? 1 : 0
    const opponents = st.seats.filter((s) => s && !s.folded && s.seat !== heroSeat).map(() => shoveRange)
    if (opponents.length === 0) return null
    return equityMC({ hero: [hero.holeCards[0], hero.holeCards[1]], board: [], opponents }, 1500, mulberry32(mixSeed(st.seed, 0x1c3))).equity
  }

  /** 快照缺失时的确定性补算：对未弃牌对手的均匀范围 */
  const fallbackEquity = (st: HandState, streetIdx: number): number | null => {
    const hero = st.seats[heroSeat]
    if (!hero?.holeCards || st.street === 'preflop') return null
    const opponents = st.seats.filter((s) => s && !s.folded && s.seat !== heroSeat).map(() => uniformRange())
    if (opponents.length === 0) return null
    return equityMC(
      { hero: [hero.holeCards[0], hero.holeCards[1]], board: st.board, opponents },
      1500,
      mulberry32(mixSeed(st.seed, 0x9e00 + streetIdx)),
    ).equity
  }

  for (let i = 1; i < rec.events.length; i++) {
    const e = rec.events[i]
    if (e.t === 'street') {
      heroCheckedStreet = null
      if (e.street === 'flop') {
        const hero = state.seats[heroSeat]
        if (hero && !hero.folded) sawFlop = true
      }
    }
    if (e.t === 'handEnd') {
      const row = e.stacks.find((x) => x.seat === heroSeat)
      if (row) endStack = row.stack
    }
    if (e.t === 'showdown' && e.seat === heroSeat) showdown = true
    if (e.t === 'potAward' && e.seat === heroSeat && e.reason === 'win' && showdown) wonShowdown = true
    if (e.t === 'potAward' && e.seat === heroSeat && e.reason === 'uncontested') uncontestedWin = true
    if (e.t !== 'action') continue
    if (state.street === 'done' || state.actionOn !== e.seat) break // 防御：与引擎失配即停

    if (e.seat === heroSeat) {
      const sit = situationFor(state, heroSeat)
      const legal = legalActions(state)
      const hero = state.seats[heroSeat]!
      const heroCards = hero.holeCards
      const street = state.street
      const heavyCall = legal.callAmount > 0 && legal.callAmount >= hero.stack * 0.4
      const eq =
        street === 'preflop'
          ? heavyCall
            ? preflopShoveEquity(state)
            : null
          : (snapEquity(street) ?? fallbackEquity(state, streetIdxOf[street] ?? 0))
      if (street === 'river' && eq !== null) heroRiverEquity = eq
      decisions.push({
        handNo: rec.handNo,
        street,
        action: e,
        pot: currentPot(state),
        toCall: legal.callAmount,
        equity: eq,
        effBB: sit.effBB,
        classId: heroCards ? CLASS_OF_COMBO[comboIndex(heroCards[0], heroCards[1])] : -1,
        position: sit.position,
        line: sit.line,
        raisesBeforeAction: state.raisesThisStreet,
        canRaise: legal.canRaise,
        icmNeeded: heavyCall ? icmRequiredEquity(state, heroSeat, payouts) : null,
        stack: hero.stack,
        baselineFold:
          street === 'preflop' && heroCards && sit.line !== 'vsShove' ? policyForCombo(STYLES.tag, sit, comboIndex(heroCards[0], heroCards[1])).fold : null,
      })

      const type = e.action.type
      if (street === 'preflop' && type === 'fold') heroFoldedPreflop = true

      if (street !== 'preflop' && heroCards) {
        if (type === 'check') heroCheckedStreet = street
        if (type === 'raise' && heroCheckedStreet === street) checkRaises++
        if (type === 'bet' || type === 'raise') {
          lastAggr = { street, bucket: bucketOf(heroCards[0], heroCards[1], state.board) as Bucket }
        }
        if (type === 'fold' && legal.callAmount > 0 && state.lastAggressor >= 0 && state.lastAggressor !== heroSeat) {
          const aggr = state.seats[state.lastAggressor]
          if (aggr?.holeCards) {
            const eqActual = actualEquity(heroCards, state.board, [[aggr.holeCards[0], aggr.holeCards[1]]], 0xf01d + i)
            if (eqActual >= 0.55 && (gotBluffed === null || eqActual > gotBluffed.eq)) {
              gotBluffed = {
                handNo: rec.handNo,
                street,
                eq: eqActual,
                aggrBucket: bucketOf(aggr.holeCards[0], aggr.holeCards[1], state.board) as Bucket,
              }
            }
          }
        }
        if (type !== 'fold') {
          const opps = state.seats
            .filter((s) => s && !s.folded && s.seat !== heroSeat && s.holeCards)
            .map((s) => [s!.holeCards![0], s!.holeCards![1]] as [number, number])
          lastActionCtx = { board: [...state.board], opps }
        }
      }
    }
    state = applyAction(state, e.action).state
  }

  // 终局类型判定
  const heroStart = start.seats.find((x) => x.seat === heroSeat)!
  void heroStart
  const bluffWin = uncontestedWin && lastAggr !== null && lastAggr.bucket <= Bucket.WeakDraw
  const semiBluffWin = uncontestedWin && lastAggr !== null && lastAggr.bucket === Bucket.StrongDraw
  const bluffCaught = showdown && !wonShowdown && lastAggr !== null && lastAggr.street === 'river' && lastAggr.bucket <= Bucket.WeakDraw
  const valueBetPaid = showdown && wonShowdown && lastAggr !== null && lastAggr.street === 'river' && lastAggr.bucket >= Bucket.TopPair

  let finalEq: number | null = null
  if (showdown && lastActionCtx && lastActionCtx.board.length < 5 && lastActionCtx.opps.length > 0) {
    const heroCards = start.seats.some(() => true) ? null : null
    void heroCards
    const holeEvent = rec.events.find((ev) => ev.t === 'dealHole' && ev.seat === heroSeat)
    if (holeEvent && holeEvent.t === 'dealHole') {
      finalEq = actualEquity(holeEvent.cards, lastActionCtx.board, lastActionCtx.opps, 0xbeef)
    }
  }

  // EV 损失：面对下注时（胜率已知）跟注 vs 弃牌相对最优的差；加注不评估
  let evLoss = 0
  for (const d of decisions) {
    if (d.toCall <= 0 || d.equity === null) continue
    const callEv = d.equity * (d.pot + d.toCall) - d.toCall
    if (d.action.action.type === 'call') evLoss += Math.max(0, -callEv)
    else if (d.action.action.type === 'fold') evLoss += Math.max(0, callEv)
  }

  return {
    decisions,
    evLoss,
    heroFoldedPreflop,
    sawFlop,
    showdown,
    wonShowdown,
    heroRiverEquity,
    delta: endStack - startStack,
    bluffWin,
    semiBluffWin,
    bluffCaught,
    gotBluffed,
    checkRaises,
    valueBetPaid,
    finalEq,
  }
}

export function analyzeTournament(
  history: readonly HandRecord[],
  players: readonly TournamentPlayer[],
  heroSeat: number,
  payouts: readonly number[] = [450, 270, 180],
): Postmortem {
  const me = players.find((p) => p.seat === heroSeat) ?? null
  const heroHands = history.filter((r) => {
    const s = r.events[0]
    return s?.t === 'handStart' && s.seats.some((x) => x.seat === heroSeat)
  })

  let vpipCount = 0
  let pfrCount = 0
  let threeBets = 0
  let sawFlopCount = 0
  let wtsdCount = 0
  let wsdCount = 0
  let allIns = 0
  let preflopFolds = 0
  const play: PlayTypeStats = {
    bluffWins: 0,
    semiBluffWins: 0,
    bluffCaught: 0,
    gotBluffed: 0,
    checkRaises: 0,
    valueBetsPaid: 0,
    badBeats: 0,
    suckouts: 0,
    icmLeaks: 0,
  }
  const allDecisions: Decision[] = []
  const curve: CurvePoint[] = []
  let cumSd = 0
  let cumNsd = 0
  const handEvLoss: { handNo: number; loss: number }[] = []
  const perHand: { handNo: number; riverEq: number | null }[] = []
  const deltas: { handNo: number; delta: number }[] = []
  const gotBluffedCases: GotBluffedCase[] = []
  const bluffCaughtHands: number[] = []
  const badBeatCases: { handNo: number; eq: number }[] = []
  const suckoutCases: { handNo: number; eq: number }[] = []

  for (const rec of heroHands) {
    const r = replayHand(rec, heroSeat, payouts)
    if (!r) continue
    allDecisions.push(...r.decisions)
    perHand.push({ handNo: rec.handNo, riverEq: r.heroRiverEquity })
    deltas.push({ handNo: rec.handNo, delta: r.delta })
    if (r.showdown) cumSd += r.delta
    else cumNsd += r.delta
    curve.push({ handNo: rec.handNo, total: cumSd + cumNsd, showdown: cumSd, nonShowdown: cumNsd })
    if (r.evLoss > 0) handEvLoss.push({ handNo: rec.handNo, loss: r.evLoss })
    const pre = r.decisions.filter((d) => d.street === 'preflop')
    if (pre.some((d) => d.action.action.type === 'call' || d.action.action.type === 'raise' || d.action.action.type === 'bet')) vpipCount++
    if (pre.some((d) => d.action.action.type === 'raise' || d.action.action.type === 'bet')) pfrCount++
    if (pre.some((d) => d.action.action.type === 'raise' && d.raisesBeforeAction >= 1)) threeBets++
    if (r.heroFoldedPreflop) preflopFolds++
    if (r.sawFlop) sawFlopCount++
    if (r.sawFlop && r.showdown) wtsdCount++
    if (r.sawFlop && r.showdown && r.wonShowdown) wsdCount++
    allIns += r.decisions.filter((d) => d.action.allIn).length

    if (r.bluffWin) play.bluffWins++
    if (r.semiBluffWin) play.semiBluffWins++
    if (r.bluffCaught) {
      play.bluffCaught++
      bluffCaughtHands.push(rec.handNo)
    }
    if (r.gotBluffed) {
      play.gotBluffed++
      gotBluffedCases.push(r.gotBluffed)
    }
    play.checkRaises += r.checkRaises
    if (r.valueBetPaid) play.valueBetsPaid++
    if (r.finalEq !== null && r.showdown) {
      if (!r.wonShowdown && r.finalEq >= 0.72) {
        play.badBeats++
        badBeatCases.push({ handNo: rec.handNo, eq: r.finalEq })
      }
      if (r.wonShowdown && r.finalEq <= 0.28) {
        play.suckouts++
        suckoutCases.push({ handNo: rec.handNo, eq: r.finalEq })
      }
    }
  }

  // ICM 漏洞：重注跟注（可能被淘汰）筹码口径可跟、奖金口径胜率不足
  const icmCalls = allDecisions
    .filter((d) => d.action.action.type === 'call' && d.icmNeeded !== null && d.equity !== null && d.toCall > 0)
    .map((d) => ({ d, chip: requiredEquity(d.pot, d.toCall), icm: d.icmNeeded as number, eq: d.equity as number }))
    .filter((x) => x.eq >= x.chip - 0.02 && x.eq < x.icm - 0.03)
    .sort((a, b) => b.icm - b.eq - (a.icm - a.eq))
  play.icmLeaks = icmCalls.length
  const heavyCalls = allDecisions.filter((d) => d.action.action.type === 'call' && d.icmNeeded !== null).length

  // 翻前相对紧凶基准的松/紧偏离（只看基准态度明确的手牌：弃牌率 ≥90% 却入池 / ≤10% 却弃）
  const looseDevs = allDecisions.filter(
    (d) => d.street === 'preflop' && d.baselineFold !== null && d.baselineFold >= 0.9 && (d.action.action.type === 'call' || d.action.action.type === 'raise' || d.action.action.type === 'bet'),
  )
  const tightDevs = allDecisions.filter((d) => d.street === 'preflop' && d.baselineFold !== null && d.baselineFold <= 0.1 && d.action.action.type === 'fold')
  const evLossTotal = handEvLoss.reduce((s, x) => s + x.loss, 0)

  const n = heroHands.length
  const wins = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta)
  const losses = deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta)

  const stats: PostmortemStats = {
    hands: n,
    rank: me?.rank ?? null,
    prize: me?.prize ?? 0,
    netDelta: deltas.reduce((s, d) => s + d.delta, 0),
    vpip: n > 0 ? vpipCount / n : 0,
    pfr: n > 0 ? pfrCount / n : 0,
    threeBets,
    sawFlopRate: n > 0 ? sawFlopCount / n : 0,
    wtsd: sawFlopCount > 0 ? wtsdCount / sawFlopCount : 0,
    wsd: wtsdCount > 0 ? wsdCount / wtsdCount : 0,
    allIns,
    preflopFoldRate: n > 0 ? preflopFolds / n : 0,
    biggestWin: wins[0] ?? null,
    biggestLoss: losses[0] ?? null,
    ...play,
    evLoss: Math.round(evLossTotal),
    looseDeviations: looseDevs.length,
    tightDeviations: tightDevs.length,
  }

  // —— 固定规则诊断 ——
  const findings: Finding[] = []

  // R1 负赔率跟注
  const badCalls = allDecisions
    .filter((d) => d.street !== 'preflop' && d.action.action.type === 'call' && d.equity !== null && d.toCall > 0)
    .map((d) => ({ d, needed: requiredEquity(d.pot, d.toCall), gap: requiredEquity(d.pot, d.toCall) - (d.equity as number) }))
    .filter((x) => x.gap > 0.05)
    .sort((a, b) => b.gap - a.gap)
  for (const x of badCalls.slice(0, 3)) {
    findings.push({
      rule: 'neg-ev-call',
      severity: 'bad',
      handNo: x.d.handNo,
      text: `第 ${x.d.handNo} 手${STREET_ZH[x.d.street]}：胜率约 ${((x.d.equity as number) * 100).toFixed(0)}%，低于跟注所需的 ${(x.needed * 100).toFixed(0)}%，仍跟注 ${fmtChips(x.d.toCall)}（负期望）`,
    })
  }
  if (badCalls.length > 3) {
    findings.push({ rule: 'neg-ev-call', severity: 'bad', text: `共 ${badCalls.length} 次负赔率跟注，以上仅列最严重的 3 次` })
  }
  if (badCalls.length === 0 && allDecisions.some((d) => d.street !== 'preflop' && d.action.action.type === 'call')) {
    findings.push({ rule: 'neg-ev-call', severity: 'good', text: '翻后所有跟注都符合底池赔率，赔率纪律良好' })
  }

  // R1a EV 损失：按当时胜率衡量的跟注/弃牌决策损失（筹码）
  const bbNow = history.length > 0 && history[history.length - 1].events[0]?.t === 'handStart' ? (history[history.length - 1].events[0] as { level: { bb: number } }).level.bb : 20
  const worst = [...handEvLoss].sort((a, b) => b.loss - a.loss)
  for (const x of worst.slice(0, 2)) {
    if (x.loss < bbNow * 0.5) break
    findings.push({
      rule: 'ev-loss',
      severity: x.loss >= bbNow * 2 ? 'bad' : 'warn',
      handNo: x.handNo,
      text: `第 ${x.handNo} 手：面对下注的跟注/弃牌选择合计偏离最优约 ${fmtChips(Math.round(x.loss))} 筹码（按当时对推断范围的胜率计算）`,
    })
  }
  if (evLossTotal > 0) {
    findings.push({
      rule: 'ev-loss',
      severity: evLossTotal >= bbNow * 6 ? 'warn' : 'info',
      text: `全场面对下注的跟注/弃牌决策合计损失约 ${fmtChips(Math.round(evLossTotal))} 筹码（≈ ${(evLossTotal / bbNow).toFixed(1)} 个当前大盲）`,
    })
  }

  // R1c 翻前偏离基准
  const devName = (d: Decision) => (d.classId >= 0 ? className(d.classId) : '?')
  if (looseDevs.length >= 3) {
    const ex = looseDevs.slice(0, 2).map((d) => `第 ${d.handNo} 手${POSITION_HINT[d.position] ?? ''}用 ${devName(d)} 入池`).join('；')
    findings.push({ rule: 'preflop-loose', severity: 'warn', handNo: looseDevs[0].handNo, text: `翻前 ${looseDevs.length} 次用基准明确应弃的牌入池（${ex}）——这些牌在该位置长期是亏的` })
  } else if (looseDevs.length > 0) {
    findings.push({ rule: 'preflop-loose', severity: 'info', handNo: looseDevs[0].handNo, text: `翻前 ${looseDevs.length} 次用基准应弃的牌入池（第 ${looseDevs[0].handNo} 手 ${devName(looseDevs[0])}）` })
  }
  if (tightDevs.length >= 3) {
    const ex = tightDevs.slice(0, 2).map((d) => `第 ${d.handNo} 手${POSITION_HINT[d.position] ?? ''}弃掉 ${devName(d)}`).join('；')
    findings.push({ rule: 'preflop-tight', severity: 'warn', handNo: tightDevs[0].handNo, text: `翻前 ${tightDevs.length} 次弃掉基准明确应打的牌（${ex}）——过紧会被盲注磨死，尤其后位` })
  } else if (tightDevs.length > 0) {
    findings.push({ rule: 'preflop-tight', severity: 'info', handNo: tightDevs[0].handNo, text: `翻前 ${tightDevs.length} 次弃掉基准应打的牌（第 ${tightDevs[0].handNo} 手 ${devName(tightDevs[0])}）` })
  }
  if (looseDevs.length === 0 && tightDevs.length === 0 && allDecisions.some((d) => d.street === 'preflop')) {
    findings.push({ rule: 'preflop-dev', severity: 'good', text: '翻前手牌选择与紧凶基准没有明确冲突' })
  }

  // R1b ICM：泡沫期/钱圈边缘的重注跟注要用奖金口径衡量
  for (const x of icmCalls.slice(0, 2)) {
    findings.push({
      rule: 'icm-call',
      severity: 'bad',
      handNo: x.d.handNo,
      text: `第 ${x.d.handNo} 手${STREET_ZH[x.d.street]}：跟注 ${fmtChips(x.d.toCall)}（剩余 ${fmtChips(x.d.stack)}）——筹码口径胜率约 ${(x.eq * 100).toFixed(0)}% ≥ 所需 ${(x.chip * 100).toFixed(0)}%，但按 ICM 需要 ${(x.icm * 100).toFixed(0)}%：淘汰风险让这类跟注亏奖金`,
    })
  }
  if (icmCalls.length > 2) {
    findings.push({ rule: 'icm-call', severity: 'bad', text: `共 ${icmCalls.length} 次"筹码正 EV、奖金负 EV"的重注跟注，以上仅列差距最大的 2 次` })
  }
  if (icmCalls.length === 0 && heavyCalls >= 2) {
    findings.push({ rule: 'icm-call', severity: 'good', text: `${heavyCalls} 次可能被淘汰的重注跟注都满足 ICM 口径，泡沫期判断到位` })
  }

  // R2 被诈唬 / 弃掉领先牌（结果论）
  const gbSorted = [...gotBluffedCases].sort((a, b) => b.eq - a.eq)
  for (const c of gbSorted.slice(0, 2)) {
    const label = c.aggrBucket <= Bucket.WeakDraw ? '对手是纯诈唬' : c.aggrBucket === Bucket.StrongDraw ? '对手只是半诈唬听牌' : '你其实领先对手的成牌'
    findings.push({
      rule: 'got-bluffed',
      severity: 'warn',
      handNo: c.handNo,
      text: `第 ${c.handNo} 手${STREET_ZH[c.street]}：面对下注弃牌，按对手实际手牌你当时约有 ${(c.eq * 100).toFixed(0)}% 胜率（${label}）——被打走了领先牌`,
    })
  }
  if (play.gotBluffed >= 3) {
    findings.push({ rule: 'got-bluffed', severity: 'warn', text: `本场共 ${play.gotBluffed} 次弃掉实际领先的牌——面对攻击让步过多（结果论统计，供参考）` })
  }

  // R3 诈唬结果
  if (play.bluffWins + play.semiBluffWins > 0) {
    findings.push({
      rule: 'bluff',
      severity: 'good',
      text: `诈唬拿下 ${play.bluffWins + play.semiBluffWins} 个底池（纯诈唬 ${play.bluffWins} 次、半诈唬 ${play.semiBluffWins} 次）`,
    })
  }
  for (const h of bluffCaughtHands.slice(0, 2)) {
    findings.push({ rule: 'bluff-caught', severity: 'warn', handNo: h, text: `第 ${h} 手：河牌诈唬被跟注抓住——注意该对手的跟注倾向` })
  }

  // R4 check-raise 与价值
  if (play.checkRaises > 0) {
    findings.push({ rule: 'check-raise', severity: 'info', text: `打出 ${play.checkRaises} 次 check-raise` })
  }
  if (play.valueBetsPaid > 0) {
    findings.push({ rule: 'value', severity: 'good', text: `${play.valueBetsPaid} 次河牌价值下注获得支付并赢下摊牌` })
  }

  // R5 bad beat / 逆转（结果论安慰与提醒）
  for (const c of badBeatCases.slice(0, 2)) {
    findings.push({
      rule: 'bad-beat',
      severity: 'info',
      handNo: c.handNo,
      text: `第 ${c.handNo} 手 bad beat：最后决策时你有约 ${(c.eq * 100).toFixed(0)}% 胜率仍被反超——决策没有问题，是方差`,
    })
  }
  for (const c of suckoutCases.slice(0, 2)) {
    findings.push({
      rule: 'suckout',
      severity: 'info',
      handNo: c.handNo,
      text: `第 ${c.handNo} 手逆转取胜：当时仅约 ${(c.eq * 100).toFixed(0)}% 胜率——赢的是运气，这种局面长期是亏的`,
    })
  }

  // R6 错失价值：河牌胜率 ≥75% 却过牌
  for (const d of allDecisions) {
    if (d.street === 'river' && d.action.action.type === 'check' && d.equity !== null && d.equity >= 0.75 && d.canRaise) {
      findings.push({
        rule: 'missed-value',
        severity: 'warn',
        handNo: d.handNo,
        text: `第 ${d.handNo} 手河牌：胜率约 ${(d.equity * 100).toFixed(0)}% 却选择过牌，错失价值下注`,
      })
    }
  }

  // R7 短码错过全下
  for (const d of allDecisions) {
    if (
      d.street === 'preflop' &&
      d.action.action.type === 'fold' &&
      d.effBB <= 8 &&
      (d.line === 'unopened' || d.line === 'vsLimp') &&
      d.classId >= 0 &&
      shouldPush(d.classId, d.position as never, d.effBB, 1.0)
    ) {
      findings.push({
        rule: 'missed-push',
        severity: 'warn',
        handNo: d.handNo,
        text: `第 ${d.handNo} 手：仅剩 ${d.effBB.toFixed(0)}bb 拿 ${className(d.classId)}（前 ${(PERCENTILE[d.classId] * 100).toFixed(0)}%）却弃牌——短码应直接全下抢盲`,
      })
    }
  }

  // R8 入池宽度 / 主动性 / 摊牌倾向
  if (n >= 15) {
    if (stats.vpip > 0.35) {
      findings.push({ rule: 'vpip', severity: 'warn', text: `入池率 ${(stats.vpip * 100).toFixed(0)}% 偏松（9 人桌参考 15%-30%），大量边缘牌翻前就在烧筹码` })
    } else if (stats.vpip < 0.12) {
      findings.push({ rule: 'vpip', severity: 'warn', text: `入池率 ${(stats.vpip * 100).toFixed(0)}% 偏紧（9 人桌参考 15%-30%），盲注被磨损且拿牌时难获支付` })
    } else {
      findings.push({ rule: 'vpip', severity: 'good', text: `入池率 ${(stats.vpip * 100).toFixed(0)}%，处于健康区间` })
    }
    if (stats.vpip > 0.15 && stats.pfr / Math.max(stats.vpip, 0.001) < 0.4) {
      findings.push({
        rule: 'passivity',
        severity: 'warn',
        text: `翻前加注率 ${(stats.pfr * 100).toFixed(0)}% 明显低于入池率 ${(stats.vpip * 100).toFixed(0)}%——跟注过多、主动权不足，好牌也应更多选择加注`,
      })
    }
    if (stats.wtsd > 0.45 && stats.wsd < 0.5) {
      findings.push({
        rule: 'station',
        severity: 'warn',
        text: `见翻牌后 ${(stats.wtsd * 100).toFixed(0)}% 走到摊牌但胜率仅 ${(stats.wsd * 100).toFixed(0)}%——带弱牌走得太远，跟注站倾向`,
      })
    } else if (stats.wtsd > 0 && stats.wsd >= 0.55) {
      findings.push({ rule: 'station', severity: 'good', text: `摊牌胜率 ${(stats.wsd * 100).toFixed(0)}%，走到摊牌的手牌质量不错` })
    }
  }

  // R9 最大亏损手回顾
  for (const loss of losses.slice(0, 2)) {
    const hand = perHand.find((h) => h.handNo === loss.handNo)
    const eqText = hand?.riverEq !== null && hand?.riverEq !== undefined ? `，河牌时你的胜率约 ${(hand.riverEq * 100).toFixed(0)}%` : ''
    findings.push({
      rule: 'big-loss',
      severity: 'warn',
      handNo: loss.handNo,
      text: `最大亏损：第 ${loss.handNo} 手输掉 ${fmtChips(-loss.delta)}${eqText}——建议去复盘逐街回看决策点`,
    })
  }

  const order: Record<Severity, number> = { bad: 0, warn: 1, info: 2, good: 3 }
  findings.sort((a, b) => order[a.severity] - order[b.severity])

  return { stats, findings, curve }
}
