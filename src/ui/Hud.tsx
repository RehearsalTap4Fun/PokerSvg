import { useMemo, useState } from 'react'
import type { EquityUpdate } from '../store/hudController'
import type { Range } from '../analysis/range'
import { aggregateToClasses, totalWeight } from '../analysis/range'
import { requiredEquity, callEV, potOddsText } from '../analysis/evCalc'
import { classIdOfCards, className } from '../core/handClass'
import type { TournamentPlayer } from '../core/types'
import { HUMAN_COLOR, STYLES } from '../ai/styles'
import { RangeMatrix } from './RangeMatrix'

export interface HudProps {
  equity: EquityUpdate | null
  heroCards: [number, number] | null
  board: readonly number[]
  pot: number
  toCall: number
  isHumanTurn: boolean
  /** 活跃对手（未弃牌、非英雄）及其推断范围 */
  opponents: { seat: number; player: TournamentPlayer; range: Range }[]
  onOpenChart: () => void
}

export function Hud({ equity, heroCards, board, pot, toCall, isHumanTurn, opponents, onOpenChart }: HudProps) {
  const [tab, setTab] = useState<'equity' | 'range'>('equity')
  const [selOpp, setSelOpp] = useState<number>(-1)

  const opp = opponents.find((o) => o.seat === selOpp) ?? opponents[0] ?? null

  const agg = useMemo(() => {
    if (!opp) return null
    const dead = [...board, ...(heroCards ?? [])]
    return aggregateToClasses(opp.range, dead)
  }, [opp, board, heroCards])

  const combosTotal = useMemo(() => (opp ? totalWeight(opp.range) : 0), [opp])
  void combosTotal

  const needed = requiredEquity(pot, toCall)
  const eq = equity?.equity ?? null
  const ev = eq !== null && toCall > 0 ? callEV(eq, pot, toCall) : null

  return (
    <div className="hud">
      <div className="hud-tabs">
        <button className={tab === 'equity' ? 'active' : ''} onClick={() => setTab('equity')}>
          胜率 & EV
        </button>
        <button className={tab === 'range' ? 'active' : ''} onClick={() => setTab('range')}>
          对手范围
        </button>
        <button onClick={onOpenChart} title="翻前标准范围表">
          范围表
        </button>
      </div>

      {tab === 'equity' ? (
        <div className="hud-body">
          {eq !== null && heroCards ? (
            <>
              <div className="equity-big">
                {(eq * 100).toFixed(1)}%
                {equity?.exact ? <span className="tag-exact">精确</span> : null}
              </div>
              <div className="equity-sub">
                平局率 {((equity?.tie ?? 0) * 100).toFixed(1)}%
                {!equity?.exact ? ` · ${Math.round((equity?.trials ?? 0) / 1000)}k 次模拟${equity?.done ? '' : '…'}` : ''}
              </div>
              <div className="equity-note">对 {opponents.length} 个未弃牌对手的推断范围</div>
              {toCall > 0 && isHumanTurn ? (
                <div className="ev-panel">
                  <div className="ev-row">
                    <span>底池赔率</span>
                    <b>{potOddsText(pot, toCall)}</b>
                  </div>
                  <div className="ev-row">
                    <span>跟注所需胜率</span>
                    <b>{(needed * 100).toFixed(1)}%</b>
                  </div>
                  <div className="ev-row">
                    <span>跟注 EV</span>
                    <b className={ev !== null && ev >= 0 ? 'ev-pos' : 'ev-neg'}>
                      {ev !== null ? (ev >= 0 ? '+' : '') + ev.toFixed(0) : '—'}
                    </b>
                  </div>
                  <div className="ev-bars">
                    <EvBar label="弃牌" value={0} range={Math.max(50, Math.abs(ev ?? 0) * 1.4)} />
                    <EvBar label="跟注" value={ev ?? 0} range={Math.max(50, Math.abs(ev ?? 0) * 1.4)} />
                  </div>
                  <div className="ev-hint">{eq >= needed ? '✓ 胜率高于所需，跟注为正 EV' : '✗ 胜率不足，纯赔率角度应弃牌'}</div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="hud-empty">{heroCards ? '计算中…' : '等待发牌'}</div>
          )}
        </div>
      ) : (
        <div className="hud-body">
          {opponents.length > 0 && opp ? (
            <>
              <div className="opp-select">
                {opponents.map((o) => (
                  <button key={o.seat} className={o.seat === opp.seat ? 'active' : ''} onClick={() => setSelOpp(o.seat)}>
                    <i
                      className="opp-dot"
                      style={{ background: o.player.style !== 'human' ? STYLES[o.player.style].color : HUMAN_COLOR }}
                    />
                    {o.player.name}
                  </button>
                ))}
              </div>
              {agg ? (
                <RangeMatrix
                  intensity={agg.intensity}
                  tooltip={(cls) =>
                    `${className(cls)}：权重 ${(agg.weightSum[cls] * 100).toFixed(1)}%（可用组合 ${agg.availCount[cls]}）`
                  }
                />
              ) : null}
              <div className="hud-note">颜色越深 = 该手牌类在其推断范围中的权重越高（已按行动线贝叶斯收窄）</div>
            </>
          ) : (
            <div className="hud-empty">无活跃对手</div>
          )}
        </div>
      )}
      {heroCards ? (
        <div className="hud-footer">你的手牌类：{className(classIdOfCards(heroCards[0], heroCards[1]))}</div>
      ) : null}
    </div>
  )
}

function EvBar({ label, value, range }: { label: string; value: number; range: number }) {
  const pct = Math.max(-1, Math.min(1, value / range))
  return (
    <div className="evbar">
      <span className="evbar-label">{label}</span>
      <div className="evbar-track">
        <div className="evbar-zero" />
        <div
          className={`evbar-fill ${value >= 0 ? 'pos' : 'neg'}`}
          style={value >= 0 ? { left: '50%', width: `${pct * 50}%` } : { right: '50%', width: `${-pct * 50}%` }}
        />
      </div>
      <span className="evbar-val">{value >= 0 ? '+' : ''}{value.toFixed(0)}</span>
    </div>
  )
}
