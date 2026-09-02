import { freshDeck, type Card } from './cards'
import { mulberry32, shuffleInPlace } from './rng'
import { evaluate7, describeScore } from './evaluator'
import { buildPots, splitPot, seatsClockwiseFrom } from './pots'
import { findNextActor, isPending, legalActions } from './betting'
import type { Action, HandSetupInput, HandState, SeatState, Street } from './types'
import type { HandEvent } from './events'

// 单手牌生命周期（纯 reducer）：setupHand 与 applyAction 均返回 { state, events }，
// 引擎无时间概念，动画节奏由 store/gameController 播放事件流实现。

export const SEAT_COUNT = 9

export function currentPot(state: HandState): number {
  let p = 0
  for (const s of state.seats) if (s) p += s.totalCommitted
  return p
}

function cloneSeat(s: SeatState | null): SeatState | null {
  return s ? { ...s, holeCards: s.holeCards ? [s.holeCards[0], s.holeCards[1]] : null } : null
}

export function cloneHand(state: HandState): HandState {
  return {
    ...state,
    seats: state.seats.map(cloneSeat),
    deck: state.deck.slice(),
    board: state.board.slice(),
  }
}

export function setupHand(input: HandSetupInput): { state: HandState; events: HandEvent[] } {
  const events: HandEvent[] = []
  const seats: (SeatState | null)[] = new Array(SEAT_COUNT).fill(null)
  for (const p of input.seats) {
    if (p.stack <= 0) throw new Error(`座位 ${p.seat} 筹码为 0，不应入局`)
    seats[p.seat] = {
      seat: p.seat,
      playerId: p.playerId,
      startStack: p.stack,
      stack: p.stack,
      committed: 0,
      totalCommitted: 0,
      holeCards: null,
      folded: false,
      allIn: false,
      actedAt: -1,
    }
  }

  const deck = input.deckOverride ? input.deckOverride.slice() : shuffleInPlace(freshDeck(), mulberry32(input.seed))

  const state: HandState = {
    handNo: input.handNo,
    seed: input.seed,
    level: input.level,
    buttonSeat: input.buttonSeat,
    sbSeat: input.sbSeat,
    bbSeat: input.bbSeat,
    seats,
    deck,
    dealIdx: 0,
    board: [],
    street: 'preflop',
    actionOn: -1,
    currentBet: input.level.bb,
    lastFullRaiseSize: input.level.bb,
    lastAggressor: -1,
    raisesThisStreet: 0,
    handAggressor: -1,
    prevStreetAggressor: -1,
  }

  events.push({
    t: 'handStart',
    handNo: input.handNo,
    level: input.level,
    buttonSeat: input.buttonSeat,
    sbSeat: input.sbSeat,
    bbSeat: input.bbSeat,
    seats: input.seats.map((p) => ({ seat: p.seat, playerId: p.playerId, stack: p.stack })),
    seed: input.seed,
  })

  // ante 先于盲注（按钮左起顺时针）
  if (input.level.ante > 0) {
    for (const seat of seatsClockwiseFrom(input.buttonSeat)) {
      const s = seats[seat]
      if (!s) continue
      const pay = Math.min(input.level.ante, s.stack)
      if (pay > 0) {
        s.stack -= pay
        s.totalCommitted += pay // ante 直接入池，不计入本街 committed
        if (s.stack === 0) s.allIn = true
        events.push({ t: 'postAnte', seat, amount: pay, allIn: s.allIn })
      }
    }
  }

  // 小盲（可能 dead：座位为空或玩家已淘汰）
  if (input.sbSeat !== null) {
    const s = seats[input.sbSeat]
    if (s) {
      const pay = Math.min(input.level.sb, s.stack)
      s.stack -= pay
      s.committed += pay
      s.totalCommitted += pay
      if (s.stack === 0) s.allIn = true
      events.push({ t: 'postSB', seat: input.sbSeat, amount: pay, allIn: s.allIn })
    }
  }

  // 大盲：即使短码付不齐，currentBet 仍为完整 BB，其他人需跟满
  {
    const s = seats[input.bbSeat]
    if (!s) throw new Error('BB 座位必须有存活玩家')
    const pay = Math.min(input.level.bb, s.stack)
    s.stack -= pay
    s.committed += pay
    s.totalCommitted += pay
    if (s.stack === 0) s.allIn = true
    events.push({ t: 'postBB', seat: input.bbSeat, amount: pay, allIn: s.allIn })
  }

  // 发底牌：按钮左起每人两张（一次发两张，顺序对公平性无影响且可复现）
  for (const seat of seatsClockwiseFrom(input.buttonSeat)) {
    const s = seats[seat]
    if (!s) continue
    const cards: [Card, Card] = [deck[state.dealIdx++], deck[state.dealIdx++]]
    s.holeCards = cards
    events.push({ t: 'dealHole', seat, cards })
  }

  // 翻前首个行动者：BB 左起第一个待行动者
  state.actionOn = findNextActor(state, input.bbSeat)
  if (state.actionOn === -1) {
    // 全员因盲注/ante all-in（或仅剩无需行动的玩家）：直接发完摊牌
    finishStreetAndAdvance(state, events)
  }
  return { state, events }
}

export function applyAction(prev: HandState, action: Action): { state: HandState; events: HandEvent[] } {
  if (prev.street === 'done' || prev.actionOn < 0) throw new Error('当前不接受行动')
  const state = cloneHand(prev)
  const events: HandEvent[] = []
  const actor = state.seats[state.actionOn]
  if (!actor) throw new Error('行动座位为空')
  const legal = legalActions(state)

  let paid = 0
  switch (action.type) {
    case 'fold': {
      if (!legal.canFold) throw new Error('不可弃牌')
      actor.folded = true
      break
    }
    case 'check': {
      if (!legal.canCheck) throw new Error(`面对 ${state.currentBet} 不可过牌`)
      actor.actedAt = state.currentBet
      break
    }
    case 'call': {
      if (legal.callAmount <= 0) throw new Error('无注可跟（应使用过牌）')
      paid = legal.callAmount
      actor.stack -= paid
      actor.committed += paid
      actor.totalCommitted += paid
      if (actor.stack === 0) actor.allIn = true
      actor.actedAt = state.currentBet
      break
    }
    case 'bet':
    case 'raise': {
      if (!legal.canRaise) throw new Error('当前不可下注/加注')
      if (action.type === 'bet' && !legal.isBet) throw new Error('本街已有下注，应使用 raise')
      if (action.type === 'raise' && legal.isBet) throw new Error('本街尚无下注，应使用 bet')
      const to = action.to
      if (!Number.isInteger(to)) throw new Error('注额必须为整数')
      if (to < legal.minRaiseTo || to > legal.maxRaiseTo) throw new Error(`注额 ${to} 超出范围 [${legal.minRaiseTo}, ${legal.maxRaiseTo}]`)
      const increment = to - state.currentBet
      if (increment < state.lastFullRaiseSize && to !== legal.maxRaiseTo) {
        throw new Error('不足最小加注的注额只能是 all-in')
      }
      if (increment >= state.lastFullRaiseSize) state.lastFullRaiseSize = increment
      paid = to - actor.committed
      if (paid > actor.stack) throw new Error('筹码不足')
      actor.stack -= paid
      actor.committed = to
      actor.totalCommitted += paid
      if (actor.stack === 0) actor.allIn = true
      state.currentBet = to
      state.lastAggressor = actor.seat
      state.handAggressor = actor.seat
      state.raisesThisStreet++
      actor.actedAt = to
      break
    }
  }
  events.push({ t: 'action', seat: actor.seat, action, paid, allIn: actor.allIn })

  // 只剩一个未弃牌者：无摊牌直接收池
  const contenders = state.seats.filter((s): s is SeatState => s !== null && !s.folded)
  if (contenders.length === 1) {
    awardUncontested(state, events, contenders[0])
    return { state, events }
  }

  const next = findNextActor(state, state.actionOn)
  if (next >= 0) {
    state.actionOn = next
  } else {
    finishStreetAndAdvance(state, events)
  }
  return { state, events }
}

const NEXT_STREET: Record<string, Street> = { preflop: 'flop', flop: 'turn', turn: 'river' }
const STREET_DEAL_COUNT: Record<string, number> = { flop: 3, turn: 1, river: 1 }

/** 本街结束：重置街内状态并推进（可能连续发完公共牌直到摊牌） */
function finishStreetAndAdvance(state: HandState, events: HandEvent[]): void {
  for (;;) {
    // 摊牌顺序需要的"河牌最后进攻者"在重置前捕获
    const riverAggressor = state.street === 'river' ? state.lastAggressor : -1

    for (const s of state.seats) {
      if (!s) continue
      s.committed = 0
      s.actedAt = -1
    }
    state.currentBet = 0
    state.lastFullRaiseSize = state.level.bb
    state.prevStreetAggressor = state.lastAggressor
    state.lastAggressor = -1
    state.raisesThisStreet = 0
    state.actionOn = -1

    if (state.street === 'river') {
      showdown(state, events, riverAggressor)
      return
    }

    const nextStreet = NEXT_STREET[state.street]
    const dealCount = STREET_DEAL_COUNT[nextStreet]
    const cards: Card[] = []
    for (let i = 0; i < dealCount; i++) cards.push(state.deck[state.dealIdx++])
    state.board.push(...cards)
    state.street = nextStreet
    events.push({ t: 'street', street: nextStreet, cards })

    const first = findNextActor(state, state.buttonSeat)
    if (first >= 0) {
      state.actionOn = first
      return
    }
    // 无人可行动（all-in runout）：继续发下一街
  }
}

function awardUncontested(state: HandState, events: HandEvent[], winner: SeatState): void {
  const pot = currentPot(state)
  winner.stack += pot
  events.push({ t: 'potAward', potIndex: 0, seat: winner.seat, amount: pot, reason: 'uncontested' })
  endHand(state, events)
}

function showdown(state: HandState, events: HandEvent[], riverAggressor: number): void {
  state.street = 'showdown'
  const contenders = state.seats.filter((s): s is SeatState => s !== null && !s.folded)
  const scores = new Map<number, number>()
  for (const s of contenders) {
    const h = s.holeCards!
    scores.set(s.seat, evaluate7(h[0], h[1], state.board[0], state.board[1], state.board[2], state.board[3], state.board[4]))
  }

  // 亮牌顺序：河牌有进攻者则其先亮，否则按钮左起
  const orderFrom = riverAggressor >= 0 ? riverAggressor : -1
  const orderedSeats: number[] = []
  if (orderFrom >= 0 && scores.has(orderFrom)) orderedSeats.push(orderFrom)
  for (const seat of seatsClockwiseFrom(orderFrom >= 0 ? orderFrom : state.buttonSeat)) {
    if (scores.has(seat) && !orderedSeats.includes(seat)) orderedSeats.push(seat)
  }

  const pots = buildPots(state.seats)
  // 亮牌/muck 判定：all-in 玩家必须亮牌；其余玩家只要在任一有资格的池中不输于已亮的牌就亮，否则 muck
  const bestRevealedPerPot: number[] = pots.map(() => -1)
  for (const seat of orderedSeats) {
    const s = state.seats[seat]!
    const score = scores.get(seat)!
    let reveal = s.allIn
    if (!reveal) {
      for (let i = 0; i < pots.length; i++) {
        if (!pots[i].eligible.includes(seat)) continue
        if (bestRevealedPerPot[i] < 0 || score >= bestRevealedPerPot[i]) {
          reveal = true
          break
        }
      }
    }
    if (reveal) {
      for (let i = 0; i < pots.length; i++) {
        if (pots[i].eligible.includes(seat) && score > bestRevealedPerPot[i]) bestRevealedPerPot[i] = score
      }
    }
    events.push({ t: 'showdown', seat, cards: s.holeCards!, reveal, score, desc: describeScore(score) })
  }

  // 分池：从最外层边池到主池；单一资格者的池 = 退还未被跟注部分
  const clockwise = seatsClockwiseFrom(state.buttonSeat)
  for (let i = pots.length - 1; i >= 0; i--) {
    const pot = pots[i]
    if (pot.eligible.length === 1) {
      const seat = pot.eligible[0]
      state.seats[seat]!.stack += pot.amount
      events.push({ t: 'potAward', potIndex: i, seat, amount: pot.amount, reason: 'uncalled' })
      continue
    }
    let best = -1
    for (const seat of pot.eligible) best = Math.max(best, scores.get(seat)!)
    const winners = clockwise.filter((seat) => pot.eligible.includes(seat) && scores.get(seat) === best)
    const shares = splitPot(pot.amount, winners)
    for (const [seat, amount] of shares) {
      state.seats[seat]!.stack += amount
      events.push({ t: 'potAward', potIndex: i, seat, amount, reason: 'win' })
    }
  }
  endHand(state, events)
}

function endHand(state: HandState, events: HandEvent[]): void {
  state.street = 'done'
  state.actionOn = -1
  // 底池已全部派发：清零投入，保持"Σ(stack+totalCommitted) = 本手总筹码"不变量在终局也成立
  for (const s of state.seats) {
    if (!s) continue
    s.committed = 0
    s.totalCommitted = 0
  }
  const stacks: { seat: number; stack: number }[] = []
  const busted: number[] = []
  for (const s of state.seats) {
    if (!s) continue
    stacks.push({ seat: s.seat, stack: s.stack })
    if (s.stack === 0) busted.push(s.seat)
  }
  events.push({ t: 'handEnd', stacks, busted })
}

export { legalActions, isPending }
