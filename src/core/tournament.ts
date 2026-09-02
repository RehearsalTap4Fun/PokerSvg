import { mulberry32, mixSeed } from './rng'
import { SEAT_COUNT } from './hand'
import type { BlindLevel, HandSetupInput, HandState, TournamentConfig, TournamentState } from './types'

// 锦标赛层：盲注升级只在手与手之间生效；按钮移动采用 dead button 规则
// （BB 永远前移一位；SB 座位 = 上一手 BB 座位、按钮 = 上一手 SB 座位，允许指向空座/淘汰者）。

export function startTournament(config: TournamentConfig): TournamentState {
  if (config.players.length < 2 || config.players.length > SEAT_COUNT) {
    throw new Error(`玩家数需在 2-${SEAT_COUNT} 之间`)
  }
  const seatsUsed = new Set<number>()
  const players = config.players.map((p, i) => {
    const seat = p.seat ?? i
    if (seat < 0 || seat >= SEAT_COUNT || seatsUsed.has(seat)) throw new Error(`座位 ${seat} 非法或重复`)
    seatsUsed.add(seat)
    return {
    id: p.id,
    name: p.name,
    style: p.style,
    seat,
    stack: config.startingStack,
    rank: null as number | null,
    prize: 0,
  }
  })
  // 抽按钮（在实际占用的座位中抽）
  const rng = mulberry32(mixSeed(config.seed, 0xb001))
  const aliveSeats = players.map((p) => p.seat).sort((a, b) => a - b)
  const buttonSeat = aliveSeats[Math.floor(rng() * aliveSeats.length)]
  const sbSeat = nextIn(aliveSeats, buttonSeat)
  const bbSeat = nextIn(aliveSeats, sbSeat)
  return { config, handNo: 0, players, buttonSeat, sbSeat, bbSeat, finished: false }
}

function nextIn(sortedSeats: number[], from: number): number {
  for (let i = 1; i <= SEAT_COUNT; i++) {
    const seat = (from + i) % SEAT_COUNT
    if (sortedSeats.includes(seat)) return seat
  }
  throw new Error('无存活座位')
}

export function currentLevel(ts: TournamentState): BlindLevel {
  const idx = Math.min(Math.floor(ts.handNo / ts.config.handsPerLevel), ts.config.levels.length - 1)
  return ts.config.levels[idx]
}

/** 距离下次升盲还剩几手（0 = 本手结束后升盲）；已到最后一级返回 null */
export function handsUntilLevelUp(ts: TournamentState): number | null {
  const idx = Math.floor(ts.handNo / ts.config.handsPerLevel)
  if (idx >= ts.config.levels.length - 1) return null
  return ts.config.handsPerLevel - (ts.handNo % ts.config.handsPerLevel)
}

/** 生成下一手的 setup 输入（handNo 从 1 开始编号） */
export function nextHandInput(ts: TournamentState): HandSetupInput {
  if (ts.finished) throw new Error('比赛已结束')
  const alive = ts.players.filter((p) => p.rank === null)
  const sbAlive = ts.sbSeat !== null && alive.some((p) => p.seat === ts.sbSeat)
  return {
    handNo: ts.handNo + 1,
    seed: mixSeed(ts.config.seed, ts.handNo + 1),
    level: currentLevel(ts),
    buttonSeat: ts.buttonSeat,
    sbSeat: sbAlive ? ts.sbSeat : null,
    bbSeat: ts.bbSeat,
    seats: alive.map((p) => ({ seat: p.seat, playerId: p.id, stack: p.stack })),
  }
}

/**
 * 一手结束后回写筹码、结算淘汰名次、移动按钮/盲注。
 * 同一手多人淘汰：本手开始时筹码更少者名次更差；筹码相同按离按钮距离（先行动者更差）作确定性并列破除。
 */
export function applyHandResult(ts: TournamentState, hand: HandState): TournamentState {
  const next: TournamentState = {
    ...ts,
    players: ts.players.map((p) => ({ ...p })),
  }
  const aliveBefore = next.players.filter((p) => p.rank === null)

  const busted: { seat: number; startStack: number }[] = []
  for (const p of aliveBefore) {
    const seat = hand.seats[p.seat]
    if (!seat) throw new Error(`存活玩家座位 ${p.seat} 不在本手中`)
    p.stack = seat.stack
    if (seat.stack === 0) busted.push({ seat: p.seat, startStack: seat.startStack })
  }

  if (busted.length > 0) {
    // 名次从 aliveBefore.length 开始向前分配；startStack 小者名次更差
    busted.sort((a, b) => a.startStack - b.startStack || distanceFromButton(b.seat, ts.buttonSeat) - distanceFromButton(a.seat, ts.buttonSeat))
    let rank = aliveBefore.length
    for (const b of busted) {
      const p = next.players.find((x) => x.seat === b.seat)!
      p.rank = rank
      p.prize = next.config.payouts[rank - 1] ?? 0
      rank--
    }
  }

  next.handNo = ts.handNo + 1

  const alive = next.players.filter((p) => p.rank === null)
  if (alive.length === 1) {
    alive[0].rank = 1
    alive[0].prize = next.config.payouts[0] ?? 0
    next.finished = true
    return next
  }

  // 移动位置（dead button 规则）
  const aliveSeats = alive.map((p) => p.seat)
  const newBB = nextIn(aliveSeats, ts.bbSeat)
  if (alive.length === 2) {
    // heads-up：按钮 = 小盲 = 非 BB 的那个人
    const sb = aliveSeats.find((s) => s !== newBB)!
    next.bbSeat = newBB
    next.sbSeat = sb
    next.buttonSeat = sb
  } else {
    next.bbSeat = newBB
    next.sbSeat = ts.bbSeat // 该座位玩家若已淘汰则本手 dead SB（nextHandInput 里判定）
    next.buttonSeat = ts.sbSeat ?? ts.bbSeat
  }
  return next
}

/** seat 在 button 后的顺时针距离（1-9）；越小越先行动（位置越差） */
function distanceFromButton(seat: number, buttonSeat: number): number {
  return ((seat - buttonSeat + SEAT_COUNT - 1) % SEAT_COUNT) + 1
}
