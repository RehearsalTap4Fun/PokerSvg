import { useMemo, useState } from 'react'
import type { HandRecord } from '../store/gameController'
import type { AiStyleId, TournamentState } from '../core/types'
import { buildView } from '../store/viewModel'
import { analyzeTournament } from '../analysis/postmortem'
import { PostmortemView } from './PostmortemView'
import { rangesAtCursor } from '../store/replayEngine'
import { aggregateToClasses } from '../analysis/range'
import { className } from '../core/handClass'
import { STYLES } from '../ai/styles'
import { Table } from './Table'
import { RangeMatrix } from './RangeMatrix'

const STREET_ZH: Record<string, string> = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌', done: '结束' }

export function Replay({ ts, history, humanSeat, onBack }: { ts: TournamentState; history: HandRecord[]; humanSeat: number; onBack: () => void }) {
  const [handIdx, setHandIdx] = useState(history.length - 1)
  const [cursor, setCursor] = useState(9999)
  const [godView, setGodView] = useState(false)
  const [showRange, setShowRange] = useState(true)
  const [selOpp, setSelOpp] = useState(-1)
  const [pmOpen, setPmOpen] = useState(false)
  const postmortem = useMemo(() => (pmOpen ? analyzeTournament(history, ts.players, humanSeat) : null), [pmOpen, history, ts, humanSeat])

  const rec = history[handIdx] ?? null
  const events = rec?.events ?? []
  const view = useMemo(() => buildView(events, cursor), [events, cursor])

  const styleBySeat = useMemo(() => {
    const m = new Map<number, AiStyleId | 'human'>()
    for (const p of ts.players) m.set(p.seat, p.style)
    return m
  }, [ts])

  const ranges = useMemo(() => (rec && showRange ? rangesAtCursor(events, cursor, styleBySeat) : null), [rec, events, cursor, styleBySeat, showRange])

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
          <button className="btn btn-top" onClick={onBack}>
            返回
          </button>
        </div>
      </div>
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
