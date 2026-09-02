import { useMemo, useState } from 'react'
import type { HandRecord } from '../store/gameController'
import type { TournamentState } from '../core/types'
import { buildView } from '../store/viewModel'
import { analyzeTournament } from '../analysis/postmortem'
import { PostmortemView } from './PostmortemView'
import { rangesAtCursor } from '../store/replayEngine'
import { OpponentModel } from '../store/opponentModel'
import { exportHandHistory } from '../store/handHistoryExport'
import type { Prefs } from '../store/storage'
import { aggregateToClasses } from '../analysis/range'
import { className } from '../core/handClass'
import { STYLES } from '../ai/styles'
import { Table } from './Table'
import { RangeMatrix } from './RangeMatrix'

const STREET_ZH: Record<string, string> = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌', done: '结束' }

export function Replay({
  ts,
  history,
  humanSeat,
  prefs,
  onPrefs,
  onBack,
}: {
  ts: TournamentState
  history: HandRecord[]
  humanSeat: number
  prefs: Prefs
  onPrefs: (p: Prefs) => void
  onBack: () => void
}) {
  const [handIdx, setHandIdx] = useState(history.length - 1)
  const [cursor, setCursor] = useState(9999)
  const [godView, setGodView] = useState(false)
  const [showRange, setShowRange] = useState(true)
  const [selOpp, setSelOpp] = useState(-1)
  const [pmOpen, setPmOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const postmortem = useMemo(
    () => (pmOpen ? analyzeTournament(history, ts.players, humanSeat, ts.config.payouts) : null),
    [pmOpen, history, ts, humanSeat],
  )

  const rec = history[handIdx] ?? null
  const events = rec?.events ?? []
  const view = useMemo(() => buildView(events, cursor), [events, cursor])

  // 诚实模式：只用该手之前的历史统计建模（与当时实际能观察到的信息一致）
  const model = useMemo(() => {
    const m = new OpponentModel(ts.players)
    for (let i = 0; i < handIdx; i++) m.observeHand(history[i].events)
    return m
  }, [ts, history, handIdx])
  const styleFor = useMemo(() => (prefs.honest ? (seat: number) => model.honestStyleFor(seat) : (seat: number) => model.styleFor(seat)), [prefs.honest, model])

  const ranges = useMemo(() => (rec && showRange ? rangesAtCursor(events, cursor, styleFor) : null), [rec, events, cursor, styleFor, showRange])

  const activeOpps = useMemo(() => {
    if (!ranges) return []
    const out: { seat: number; name: string; emoji: string }[] = []
    for (const [seat] of ranges) {
      const sv = view.seats[seat]
      if (!sv || sv.folded || seat === humanSeat) continue
      const p = ts.players.find((x) => x.seat === seat)
      out.push({ seat, name: p?.name ?? `座位${seat}`, emoji: p && p.style !== 'human' ? STYLES[p.style].emoji : '' })
    }
    return out
  }, [ranges, view, ts, humanSeat])

  const opp = activeOpps.find((o) => o.seat === selOpp) ?? activeOpps[0] ?? null
  const agg = useMemo(() => {
    if (!ranges || !opp) return null
    const heroHole = view.seats[humanSeat]?.hole
    const dead = [...view.board, ...(heroHole ?? [])]
    const r = ranges.get(opp.seat)
    return r ? aggregateToClasses(r, dead) : null
  }, [ranges, opp, view, humanSeat])

  // 街跳转点
  const streetMarks = useMemo(() => {
    const marks: { label: string; idx: number }[] = [{ label: '开局', idx: events.findIndex((e) => e.t === 'dealHole') + 2 }]
    events.forEach((e, i) => {
      if (e.t === 'street') marks.push({ label: STREET_ZH[e.street] ?? e.street, idx: i + 1 })
      if (e.t === 'showdown' && marks[marks.length - 1].label !== '摊牌') marks.push({ label: '摊牌', idx: i + 1 })
    })
    marks.push({ label: '终局', idx: events.length })
    return marks
  }, [events])

  const snapshotText = useMemo(() => {
    if (!rec || rec.equitySnapshots.length === 0) return null
    const street = view.street
    const snap = rec.equitySnapshots.filter((s) => s.street === street).pop() ?? rec.equitySnapshots[rec.equitySnapshots.length - 1]
    if (!snap) return null
    return `当时你的胜率 ${(snap.equity * 100).toFixed(1)}%${snap.exact ? '（精确）' : ''}`
  }, [rec, view.street])

  const onExport = async () => {
    const text = exportHandHistory(history, ts, humanSeat, { godView })
    const name = `poker-hh-${ts.config.seed}${godView ? '-godview' : ''}.txt`
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setCopied(`已导出 ${name}`)
    } catch {
      try {
        await navigator.clipboard.writeText(text)
        setCopied('浏览器不允许下载，已复制到剪贴板')
      } catch {
        setCopied('导出失败')
      }
    }
    setTimeout(() => setCopied(null), 2500)
  }

  if (!rec) {
    return (
      <div className="replay-screen">
        <div className="top-bar">
          <span className="top-title">复盘</span>
          <button className="btn btn-top" onClick={onBack}>
            返回
          </button>
        </div>
        <div className="hud-empty">暂无手牌记录</div>
      </div>
    )
  }

  return (
    <div className="replay-screen">
      <div className="top-bar">
        <div className="top-left">
          <span className="top-title">复盘 · 第 {rec.handNo} 手</span>
          <span className="top-dim">{STREET_ZH[view.street] ?? ''}</span>
          {snapshotText ? <span className="snap-text">{snapshotText}</span> : null}
        </div>
        <div className="top-right">
          <button className={`btn btn-top${godView ? ' active' : ''}`} onClick={() => setGodView(!godView)}>
            上帝视角
          </button>
          <button className={`btn btn-top${showRange ? ' active' : ''}`} onClick={() => setShowRange(!showRange)}>
            范围推断
          </button>
          <button className={`btn btn-top${pmOpen ? ' active' : ''}`} onClick={() => setPmOpen(!pmOpen)}>
            📋 赛后分析
          </button>
          <button className="btn btn-top" title={godView ? '导出全部底牌（上帝视角）的手牌历史' : '导出标准手牌历史（仅你的底牌与摊牌亮出的牌）'} onClick={onExport}>
            ⬇<span className="sm-hide"> 导出手牌历史</span>
          </button>
          <button className="btn btn-top" onClick={onBack}>
            返回
          </button>
        </div>
      </div>
      {copied ? <div className="toast">{copied}</div> : null}
      {pmOpen && postmortem ? (
        <div className="modal-mask" onClick={() => setPmOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{ts.finished ? '赛后复盘分析' : '阶段性复盘分析（比赛未结束）'}</h3>
              <button className="btn" onClick={() => setPmOpen(false)}>
                关闭 ✕
              </button>
            </div>
            <PostmortemView data={postmortem} />
          </div>
        </div>
      ) : null}
      <div className="replay-main">
        <div className="replay-list">
          {history.map((h, i) => (
            <button
              key={h.handNo}
              className={`replay-item${i === handIdx ? ' active' : ''}`}
              onClick={() => {
                setHandIdx(i)
                setCursor(9999)
              }}
            >
              <span>#{h.handNo}</span>
              <span className={h.heroDelta > 0 ? 'delta-pos' : h.heroDelta < 0 ? 'delta-neg' : ''}>
                {h.heroDelta > 0 ? '+' : ''}
                {h.heroDelta}
              </span>
              <span className="top-dim">{h.wentToShowdown ? '摊牌' : ''}</span>
            </button>
          ))}
        </div>
        <div className="table-col">
          <Table
            view={view}
            players={ts.players}
            humanSeat={humanSeat}
            turnSeat={-1}
            revealAll={godView}
            showStyleTags={true}
            levelText={`第 ${rec.handNo} 手 · 盲注 ${view.level.sb}/${view.level.bb}${view.level.ante > 0 ? ` · ante ${view.level.ante}` : ''}`}
          />
          <div className="replay-controls">
            <button className="btn" onClick={() => setCursor(0)}>
              ⏮
            </button>
            <button className="btn" onClick={() => setCursor(Math.max(0, Math.min(cursor, events.length) - 1))}>
              ◀ 上一步
            </button>
            <button className="btn" onClick={() => setCursor(Math.min(events.length, cursor + 1))}>
              下一步 ▶
            </button>
            <button className="btn" onClick={() => setCursor(9999)}>
              ⏭
            </button>
            <div className="street-jumps">
              {streetMarks.map((m) => (
                <button key={m.label} className="btn btn-quick" onClick={() => setCursor(m.idx)}>
                  {m.label}
                </button>
              ))}
            </div>
            <span className="top-dim">
              {Math.min(cursor, events.length)}/{events.length}
            </span>
          </div>
        </div>
        {showRange ? (
          <div className="hud">
            <div className="hud-tabs">
              <span className="hud-static-title">范围推断（随回放实时重算）</span>
              <div className="mode-toggle" title="上帝视角借用 AI 的真实策略反推；诚实模式只用该手之前可观察到的行为统计">
                <button className={!prefs.honest ? 'active' : ''} onClick={() => onPrefs({ ...prefs, honest: false })}>
                  上帝
                </button>
                <button className={prefs.honest ? 'active' : ''} onClick={() => onPrefs({ ...prefs, honest: true })}>
                  诚实
                </button>
              </div>
            </div>
            <div className="hud-body">
              {opp && agg ? (
                <>
                  <div className="opp-select">
                    {activeOpps.map((o) => (
                      <button key={o.seat} className={o.seat === opp.seat ? 'active' : ''} onClick={() => setSelOpp(o.seat)}>
                        {o.emoji}
                        {o.name}
                      </button>
                    ))}
                  </div>
                  <RangeMatrix
                    intensity={agg.intensity}
                    tooltip={(cls) => `${className(cls)}：权重 ${(agg.weightSum[cls] * 100).toFixed(1)}%（可用组合 ${agg.availCount[cls]}）`}
                  />
                  <div className="hud-note">{prefs.honest ? '诚实模式：按该手之前的公开统计（以紧凶为先验）推断' : '上帝视角：按该 AI 的真实策略函数推断'}</div>
                </>
              ) : (
                <div className="hud-empty">无活跃对手</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
