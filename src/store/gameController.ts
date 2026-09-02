import { applyAction, currentPot, setupHand } from '../core/hand'
import { legalActions } from '../core/betting'
import { applyHandResult, currentLevel, handsUntilLevelUp, nextHandInput, startTournament } from '../core/tournament'
import { mixSeed, mulberry32 } from '../core/rng'
import type { Action, HandState, LegalActions, TournamentConfig, TournamentState } from '../core/types'
import type { HandEvent } from '../core/events'
import { initialRange, observeAction, observeBoard, type ObservedAction } from '../analysis/inference'
import type { Range } from '../analysis/range'
import { decideAi, situationFor } from '../ai/decide'
import { OpponentModel } from './opponentModel'

// 引擎与 UI 之间的桥：驱动"人类行动 ↔ AI 行动"主循环，维护事件流与范围推断。
// 无时间概念、无 DOM 依赖——测试与 React UI 共用；UI 负责按节奏播放返回的事件。

export interface HandRecord {
  handNo: number
  events: HandEvent[]
  /** 每街开始时英雄胜率快照（HUD 算出后回填；无 UI 时为空） */
  equitySnapshots: { street: string; equity: number; exact: boolean }[]
  heroDelta: number
  wentToShowdown: boolean
}

export class GameController {
  ts: TournamentState
  hand: HandState | null = null
  handEvents: HandEvent[] = []
  /** 公共观察者视角的范围推断（HUD 展示时另行叠加英雄手牌做卡牌移除） */
  ranges = new Map<number, Range>()
  history: HandRecord[] = []
  /** 对手模型：公开行为统计 → AI/推断眼中的每个座位风格（人类为动态推导） */
  model: OpponentModel
  readonly humanSeat: number
  private actionCounter = 0

  constructor(config: TournamentConfig, humanSeat = 0) {
    this.ts = startTournament(config)
    this.humanSeat = humanSeat
    this.model = new OpponentModel(this.ts.players)
  }

  /** 从存档恢复（手与手之间保存的进度；范围推断是每手重建的，对手模型由历史重建） */
  static resume(ts: TournamentState, history: HandRecord[], humanSeat = 0): GameController {
    const gc = new GameController(ts.config, humanSeat)
    gc.ts = ts
    gc.history = history
    for (const h of history) gc.model.observeHand(h.events)
    return gc
  }

  get finished(): boolean {
    return this.ts.finished
  }

  styleIdOf(seat: number) {
    const p = this.ts.players.find((x) => x.seat === seat)
    if (!p) throw new Error(`座位 ${seat} 无玩家`)
    return p.style
  }

  /** 开始下一手。返回开局事件（盲注/发牌…可能直接打到摊牌——全员盲注 all-in）。 */
  startNextHand(): HandEvent[] {
    if (this.ts.finished) throw new Error('比赛已结束')
    const input = nextHandInput(this.ts)
    const { state, events } = setupHand(input)
    this.hand = state
    this.actionCounter = 0
    this.handEvents = [...events]
    this.ranges = new Map()
    for (const p of input.seats) this.ranges.set(p.seat, initialRange())
    // 开局即结束的极端情况（全员盲注 all-in 直接摊牌）
    for (const e of events) if (e.t === 'street') this.observeStreet(e.cards)
    if (state.street === 'done') this.finishHand()
    return events
  }

  isHumanTurn(): boolean {
    return this.hand !== null && this.hand.street !== 'done' && this.hand.actionOn === this.humanSeat
  }

  humanLegal(): LegalActions {
    if (!this.isHumanTurn()) throw new Error('当前不是人类回合')
    return legalActions(this.hand!)
  }

  /** 应用当前行动者的动作（人类或外部已算好的 AI 动作），更新推断并返回新事件 */
  act(action: Action): HandEvent[] {
    const state = this.hand
    if (!state || state.street === 'done' || state.actionOn < 0) throw new Error('当前不接受行动')
    const seat = state.actionOn
    const sit = situationFor(state, seat)
    const { state: next, events } = applyAction(state, action)
    this.hand = next

    // 贝叶斯观察（弃牌者直接移出展示，无需更新）
    const obs: ObservedAction | null =
      action.type === 'check' ? 'check' : action.type === 'call' ? 'call' : action.type === 'fold' ? null : 'raise'
    if (obs) {
      const r = this.ranges.get(seat)
      if (r) observeAction(r, this.model.styleFor(seat), sit, obs, state.board)
    }
    for (const e of events) if (e.t === 'street') this.observeStreet(e.cards)

    this.handEvents.push(...events)
    if (next.street === 'done') this.finishHand()
    return events
  }

  /** 若当前轮到 AI，计算其决策并应用；轮到人类或无行动时返回 null */
  stepAi(): HandEvent[] | null {
    const state = this.hand
    if (!state || state.street === 'done' || state.actionOn < 0 || this.isHumanTurn()) return null
    const seat = state.actionOn
    const style = this.model.styleFor(seat)
    const rng = mulberry32(mixSeed(state.seed, seat * 977 + this.actionCounter++))
    const action = decideAi({
      state,
      seat,
      style,
      ranges: this.ranges,
      rng,
      styleFor: (s) => this.model.styleFor(s),
      payouts: this.ts.config.payouts,
    })
    return this.act(action)
  }

  /** 一直推进 AI 直到轮到人类 / 本手结束（测试与"加速"模式用） */
  runAiUntilHuman(maxSteps = 200): void {
    for (let i = 0; i < maxSteps; i++) {
      if (this.stepAi() === null) return
    }
    throw new Error('AI 推进超过上限')
  }

  pot(): number {
    return this.hand ? currentPot(this.hand) : 0
  }

  level() {
    return currentLevel(this.ts)
  }

  handsUntilLevelUp() {
    return handsUntilLevelUp(this.ts)
  }

  private observeStreet(cards: readonly number[]): void {
    for (const r of this.ranges.values()) observeBoard(r, cards)
  }

  private finishHand(): void {
    const hand = this.hand!
    this.model.observeHand(this.handEvents)
    const heroStart = hand.seats[this.humanSeat]?.startStack ?? 0
    const heroEnd = hand.seats[this.humanSeat]?.stack ?? 0
    this.history.push({
      handNo: hand.handNo,
      events: this.handEvents.slice(),
      equitySnapshots: [],
      heroDelta: heroEnd - heroStart,
      wentToShowdown: this.handEvents.some((e) => e.t === 'showdown'),
    })
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200)
    this.ts = applyHandResult(this.ts, hand)
  }
}
