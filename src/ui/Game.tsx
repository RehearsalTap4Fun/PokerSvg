import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameController } from '../store/gameController'
import { buildView } from '../store/viewModel'
import { HudEquity, type EquityUpdate } from '../store/hudController'
import type { Prefs, SaveData } from '../store/storage'
import { rangesAtCursor } from '../store/replayEngine'
import { BUY_IN } from '../data/blindSchedule'
import type { Action } from '../core/types'
import type { HandEvent } from '../core/events'
import { classIdOfCards } from '../core/handClass'
import { positionOf } from '../ai/preflopCharts'
import { SoundManager } from '../store/sound'
import { analyzeTournament } from '../analysis/postmortem'
import { ratesOf } from '../analysis/playerStats'
import { describeProfile } from '../ai/adapt'
import { icmRequiredEquity } from '../analysis/icm'
import type { HudStatRow } from './Hud'
import { Table } from './Table'
import { ActionBar } from './ActionBar'
import { Hud } from './Hud'
import { PreflopChartModal } from './PreflopChartModal'
import { ResultModal } from './ResultModal'

// 牌局主界面：按节奏播放事件流（cursor 追赶 gc.handEvents），
// 追上后轮到 AI 则延迟决策、轮到人类则显示行动条。

function delayFor(e: HandEvent): number {
  switch (e.t) {
    case 'handStart':
      return 350
    case 'postAnte':
      return 60
    case 'postSB':
    case 'postBB':
      return 160
    case 'dealHole':
      return 55
    case 'action':
      return 550
    case 'street':
      return 850
    case 'showdown':
      return 950
    case 'potAward':
      return 850
    case 'handEnd':
      return 400
  }
}

export function Game({
  gc,
  save,
  onSave,
  prefs,
  onPrefs,
  onExit,
}: {
  gc: GameController
  save: SaveData
  onSave: (s: SaveData) => void
  prefs: Prefs
  onPrefs: (p: Prefs) => void
  onExit: () => void
}) {
  const [cursor, setCursor] = useState(0)
  const [, setTickCount] = useState(0)
  const [speed, setSpeed] = useState(1)
  // HUD：桌面默认展开；窄屏（手机）默认收起为底部抽屉
  const [hudOn, setHudOn] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 760))
  const [styleTags, setStyleTags] = useState(true)
  const [chartOpen, setChartOpen] = useState(false)
  const [equity, setEquity] = useState<EquityUpdate | null>(null)
  const [resultOpen, setResultOpen] = useState(false)

  const hudRef = useRef<HudEquity | null>(null)
  const soundRef = useRef<SoundManager | null>(null)
  if (!soundRef.current) soundRef.current = new SoundManager()
  const [soundOn, setSoundOn] = useState(() => soundRef.current!.enabled)
  const prevHumanTurnRef = useRef(false)
  const persistedHandRef = useRef(0)
  const snapshotsRef = useRef<{ handNo: number; list: { street: string; equity: number; exact: boolean }[] }>({ handNo: 0, list: [] })
  const lastSnapStreetRef = useRef('')

  const bump = useCallback(() => setTickCount((t) => t + 1), [])

  // HudEquity 的创建/销毁必须成对放在同一个 effect 里（StrictMode 双挂载安全）
  useEffect(() => {
    const hud = new HudEquity()
    hud.onUpdate((u) => setEquity(u))
    hudRef.current = hud
    return () => {
      hudRef.current = null
      hud.dispose()
    }
  }, [])

  const events = gc.handEvents
  const view = useMemo(() => buildView(events, cursor), [events, cursor, events.length])
  const caughtUp = cursor >= events.length
  const hand = gc.hand
  const done = !hand || hand.street === 'done'
  const humanTurn = caughtUp && gc.isHumanTurn()
  const hero = hand?.seats[gc.humanSeat] ?? null
  const heroCards = hero?.holeCards ?? null
  const heroAlive = !!hero && !hero.folded

  /** 手结束后的持久化（每手一次） */
  const persistAfterHand = useCallback(() => {
    if (!hand || hand.handNo === persistedHandRef.current) return
    persistedHandRef.current = hand.handNo
    const rec = gc.history.find((h) => h.handNo === snapshotsRef.current.handNo)
    if (rec) rec.equitySnapshots = snapshotsRef.current.list
    const next: SaveData = { ...save }
    if (gc.finished) {
      const me = gc.ts.players.find((p) => p.seat === gc.humanSeat)
      next.stats = {
        played: save.stats.played + 1,
        wins: save.stats.wins + (me?.rank === 1 ? 1 : 0),
        cashes: save.stats.cashes + (me?.rank !== null && me !== undefined && (me.rank ?? 99) <= gc.ts.config.payouts.length ? 1 : 0),
        totalPrize: save.stats.totalPrize + (me?.prize ?? 0),
        totalBuyin: save.stats.totalBuyin + BUY_IN,
      }
      next.ongoing = null
      next.archive = [...save.archive, { finishedAt: new Date().toISOString(), ts: gc.ts, history: gc.history }]
    } else {
      next.ongoing = { ts: gc.ts, history: gc.history }
    }
    onSave(next)
  }, [hand, gc, save, onSave])

  // 主动画循环
  useEffect(() => {
    if (resultOpen) return
    if (!hand) {
      if (!gc.finished) {
        gc.startNextHand()
        setCursor(0)
        bump()
      }
      return
    }
    if (!caughtUp) {
      const e = events[cursor]
      const t = setTimeout(() => {
        // 事件变为可见的时刻播放对应音效；加速模式只保留收池音
        if (speed === 1 || e.t === 'potAward') soundRef.current?.playForEvent(e)
        setCursor((c) => c + 1)
      }, delayFor(e) / speed)
      return () => clearTimeout(t)
    }
    if (done) {
      const t = setTimeout(() => {
        persistAfterHand()
        if (gc.finished) {
          setResultOpen(true)
        } else {
          gc.startNextHand()
          setCursor(0)
          snapshotsRef.current = { handNo: gc.hand!.handNo, list: [] }
          lastSnapStreetRef.current = ''
          bump()
        }
      }, 1700 / speed)
      return () => clearTimeout(t)
    }
    if (!gc.isHumanTurn()) {
      // AI 思考演出延迟（纯观感，与决策逻辑无关，可用非种子随机）
      const t = setTimeout(() => {
        gc.stepAi()
        bump()
      }, (300 + Math.random() * 700) / speed)
      return () => clearTimeout(t)
    }
    // 人类回合：等待输入
  }, [cursor, caughtUp, done, hand, events, speed, resultOpen, gc, bump, persistAfterHand])

  // 展示用范围：上帝视角 = 引擎内的推断（AI 真实策略）；诚实模式 = 只用可观察统计重算（AI 自身决策不受影响）
  const displayRanges = useMemo(
    () => (prefs.honest && events.length > 0 ? rangesAtCursor(events, events.length, (seat) => gc.model.honestStyleFor(seat)) : gc.ranges),
    [prefs.honest, events, events.length, gc],
  )

  // 胜率计算：每个新事件后（范围已更新）重新请求
  useEffect(() => {
    const h = gc.hand
    if (!h || h.street === 'done' || !heroCards || !heroAlive) {
      hudRef.current?.cancel()
      return
    }
    const opponents: Parameters<HudEquity['request']>[2] = []
    for (const s of h.seats) {
      if (s && !s.folded && s.seat !== gc.humanSeat) {
        const r = displayRanges.get(s.seat)
        if (r) opponents.push(r)
      }
    }
    if (opponents.length === 0) {
      hudRef.current?.cancel()
      return
    }
    hudRef.current?.request([heroCards[0], heroCards[1]], h.board, opponents)
  }, [events.length, gc, heroCards, heroAlive, hand?.street, displayRanges])

  // 每街胜率快照（记录该街的最新计算结果）
  useEffect(() => {
    const h = gc.hand
    if (!h || !equity || !heroAlive) return
    if (snapshotsRef.current.handNo !== h.handNo) snapshotsRef.current = { handNo: h.handNo, list: [] }
    const street = h.street
    if (street === 'done' || street === 'showdown') return
    const list = snapshotsRef.current.list
    if (lastSnapStreetRef.current !== street || list.length === 0) {
      list.push({ street, equity: equity.equity, exact: equity.exact })
      lastSnapStreetRef.current = street
    } else {
      list[list.length - 1] = { street, equity: equity.equity, exact: equity.exact }
    }
  }, [equity, gc, heroAlive])

  // 轮到你：轻提示音
  useEffect(() => {
    if (humanTurn && !prevHumanTurnRef.current) soundRef.current?.play('turn')
    prevHumanTurnRef.current = humanTurn
  }, [humanTurn])

  const onHumanAction = useCallback(
    (a: Action) => {
      if (!gc.isHumanTurn()) return
      try {
        gc.act(a)
        bump()
      } catch (err) {
        console.warn('非法动作', err)
      }
    },
    [gc, bump],
  )

  const onExitClick = useCallback(() => {
    if (!gc.finished && gc.hand && gc.hand.street === 'done') persistAfterHand()
    onExit()
  }, [gc, onExit, persistAfterHand])

  // HUD 数据
  const hudOpponents = useMemo(() => {
    const h = gc.hand
    if (!h) return []
    const out: { seat: number; player: (typeof gc.ts.players)[number]; range: NonNullable<ReturnType<typeof gc.ranges.get>> }[] = []
    for (const s of h.seats) {
      if (s && !s.folded && s.seat !== gc.humanSeat) {
        const r = displayRanges.get(s.seat)
        const p = gc.ts.players.find((x) => x.seat === s.seat)
        if (r && p) out.push({ seat: s.seat, player: p, range: r })
      }
    }
    return out
  }, [gc, events.length, displayRanges])

  // 行为统计与"AI 眼中的你"：只在手与手之间变化
  const statRows = useMemo<HudStatRow[]>(() => {
    const h = gc.hand
    return gc.ts.players
      .filter((p) => p.rank === null || h?.seats[p.seat])
      .map((p) => ({
        seat: p.seat,
        player: p,
        rates: ratesOf(gc.model.counters(p.seat)),
        active: !!h?.seats[p.seat] && !h.seats[p.seat]!.folded,
      }))
  }, [gc, gc.ts.handNo, events.length])
  const heroProfile = useMemo(
    () => (gc.humanSeat >= 0 ? describeProfile(gc.model.counters(gc.humanSeat), gc.model.styleFor(gc.humanSeat)) : null),
    [gc, gc.ts.handNo],
  )

  const pot = gc.hand ? gc.pot() : 0
  const toCall = humanTurn ? gc.humanLegal().callAmount : 0
  // ICM 口径所需胜率：只在跟注会让英雄面临淘汰风险（跟注额 ≥ 剩余筹码的 40%）时展示
  const icmNeeded = useMemo(() => {
    const h = gc.hand
    if (!h || !humanTurn || toCall <= 0 || !hero) return null
    if (toCall < hero.stack * 0.4) return null
    const r = icmRequiredEquity(h, gc.humanSeat, gc.ts.config.payouts)
    if (r === null) return null
    const chipNeeded = toCall / (pot + toCall)
    return r - chipNeeded > 0.01 ? r : null
  }, [gc, humanTurn, toCall, pot, hero])
  const level = gc.level()
  const untilUp = gc.handsUntilLevelUp()
  const heroClass = heroCards ? classIdOfCards(heroCards[0], heroCards[1]) : -1
  const heroPos = hand && hero ? positionOf(gc.humanSeat, hand.buttonSeat, hand.sbSeat, hand.bbSeat, hand.seats.filter(Boolean).map((s) => s!.seat)) : null
  const me = gc.ts.players.find((p) => p.seat === gc.humanSeat)
  const spectating = me?.rank !== null && me?.rank !== undefined
  const postmortem = useMemo(
    () => (resultOpen && gc.finished ? analyzeTournament(gc.history, gc.ts.players, gc.humanSeat, gc.ts.config.payouts) : null),
    [resultOpen, gc],
  )

  return (
    <div className="game-screen">
      <div className="top-bar">
        <div className="top-left">
          <span className="top-title">
            无限注德州 · {level.sb}/{level.bb}
            {level.ante > 0 ? ` (${level.ante})` : ''}
          </span>
          <span className="top-dim">
            {gc.ts.players.filter((p) => p.rank === null).length} 人 SNG · 第 {view.handNo || gc.ts.handNo + 1} 手 ·{' '}
            {untilUp !== null ? `${untilUp} 手后升盲` : '最高级别'}
          </span>
        </div>
        <div className="top-right">
          {spectating ? <span className="spectate-tag">你已获第 {me?.rank} 名 · 观战中</span> : null}
          <button className={`btn btn-top${speed > 1 ? ' active' : ''}`} onClick={() => setSpeed(speed > 1 ? 1 : 3)}>
            ⏩<span className="sm-hide">{speed > 1 ? ' 加速中' : ' 加速'}</span>
          </button>
          <button className={`btn btn-top${styleTags ? ' active' : ''}`} onClick={() => setStyleTags(!styleTags)}>
            🏷️<span className="sm-hide"> 风格标签</span>
          </button>
          <button className={`btn btn-top sm-none${hudOn ? ' active' : ''}`} onClick={() => setHudOn(!hudOn)}>
            {hudOn ? '隐藏辅助' : '显示辅助'}
          </button>
          <button
            className={`btn btn-top${soundOn ? ' active' : ''}`}
            title="音效开关"
            onClick={() => {
              const next = !soundOn
              soundRef.current?.setEnabled(next)
              setSoundOn(next)
              if (next) soundRef.current?.play('chip')
            }}
          >
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button className="btn btn-top" onClick={onExitClick}>
            🚪<span className="sm-hide"> 离开牌桌</span>
          </button>
        </div>
      </div>
      <div className="game-main">
        <div className="table-col">
          <Table
            view={view}
            players={gc.ts.players}
            humanSeat={gc.humanSeat}
            turnSeat={caughtUp && !done && hand ? hand.actionOn : -1}
            revealAll={false}
            showStyleTags={styleTags}
            levelText={`盲注 ${level.sb}/${level.bb}${level.ante > 0 ? ` · ante ${level.ante}` : ''}`}
            subText={`奖池 ${gc.ts.config.payouts.reduce((a, b) => a + b, 0)} · 冠军 ${gc.ts.config.payouts[0]}`}
          />
          <div className="action-area">
            {humanTurn && !done ? (
              <ActionBar legal={gc.humanLegal()} pot={pot} bb={level.bb} heroStack={hero?.stack ?? 0} onAction={onHumanAction} />
            ) : (
              <div className="action-placeholder">
                {done ? (view.done ? '本手结束' : '结算中…') : caughtUp ? (spectating ? '' : '等待对手行动…') : ''}
              </div>
            )}
          </div>
        </div>
        {hudOn ? (
          <Hud
            equity={heroAlive ? equity : null}
            heroCards={heroCards}
            board={gc.hand?.board ?? []}
            pot={pot}
            toCall={toCall}
            isHumanTurn={humanTurn}
            opponents={hudOpponents}
            stats={statRows}
            humanSeat={gc.humanSeat}
            heroProfile={heroProfile}
            icmNeeded={icmNeeded}
            heroStack={hero?.stack ?? 0}
            honest={prefs.honest}
            onToggleHonest={(h) => onPrefs({ ...prefs, honest: h })}
            onOpenChart={() => setChartOpen(true)}
          />
        ) : null}
      </div>
      <button className={`equity-fab${hudOn ? ' fab-open' : ''}`} onClick={() => setHudOn(!hudOn)}>
        {hudOn ? '✕ 收起' : heroAlive && equity ? `📊 ${(equity.equity * 100).toFixed(0)}%` : '📊 辅助'}
      </button>
      {chartOpen ? <PreflopChartModal heroClass={heroClass} currentPos={heroPos} onClose={() => setChartOpen(false)} /> : null}
      {resultOpen ? <ResultModal players={gc.ts.players} humanSeat={gc.humanSeat} postmortem={postmortem} onClose={onExitClick} /> : null}
    </div>
  )
}
