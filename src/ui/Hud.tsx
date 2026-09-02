import { useMemo, useState } from 'react'
import type { EquityUpdate } from '../store/hudController'
import type { Range } from '../analysis/range'
import { aggregateToClasses } from '../analysis/range'
import { requiredEquity, callEV, potOddsText, bluffBreakeven } from '../analysis/evCalc'
import type { StatRates } from '../analysis/playerStats'
import type { ProfileLabel } from '../ai/adapt'
import { classIdOfCards, className } from '../core/handClass'
import type { TournamentPlayer } from '../core/types'
import { HUMAN_COLOR, STYLES } from '../ai/styles'
import { RangeMatrix } from './RangeMatrix'

export interface HudStatRow {
  seat: number
  player: TournamentPlayer
  rates: StatRates
  /** 本手仍在局中 */
  active: boolean
}

export interface HudProps {
  equity: EquityUpdate | null
  heroCards: [number, number] | null
  board: readonly number[]
  pot: number
  toCall: number
  isHumanTurn: boolean
  /** 活跃对手（未弃牌、非英雄）及其推断范围 */
  opponents: { seat: number; player: TournamentPlayer; range: Range }[]
  /** 全桌行为统计（含英雄），按座位 */
  stats: HudStatRow[]
  humanSeat: number
  /** AI 眼中的你 */
  heroProfile: ProfileLabel | null
  /** ICM：跟注所需胜率（奖金口径），null = 与筹码口径无显著差异 */
  icmNeeded: number | null
  /** 英雄可用于加注的最小尺度与筹码（诈唬盈亏平衡展示用） */
  heroStack: number
  /** 诚实推断模式（只用可观察统计） */
  honest: boolean
  onToggleHonest: (honest: boolean) => void
  onOpenChart: () => void
}

export function Hud({
  equity,
  heroCards,
  board,
  pot,
  toCall,
  isHumanTurn,
  opponents,
  stats,
  humanSeat,
  heroProfile,
  icmNeeded,
  heroStack,
  honest,
  onToggleHonest,
  onOpenChart,
}: HudProps) {
  const [tab, setTab] = useState<'equity' | 'range' | 'stats'>('equity')
  const [selOpp, setSelOpp] = useState<number>(-1)

  const opp = opponents.find((o) => o.seat === selOpp) ?? opponents[0] ?? null

  const agg = useMemo(() => {
    if (!opp) return null
    const dead = [...board, ...(heroCards ?? [])]
    return aggregateToClasses(opp.range, dead)
  }, [opp, board, heroCards])

  const needed = requiredEquity(pot, toCall)
  const eq = equity?.equity ?? null
  const ev = eq !== null && toCall > 0 ? callEV(eq, pot, toCall) : null
  // 以"加注到约 2.5 倍注额 / 或 2/3 池"的诈唬为例给出盈亏平衡弃牌率
  const bluffRisk = Math.min(heroStack, toCall > 0 ? toCall * 2.5 : Math.round(pot * 0.67))
  const bluffBE = bluffRisk > 0 ? bluffBreakeven(pot, bluffRisk) : null

  return (
    <div className="hud">
      <div className="hud-tabs">
        <button className={tab === 'equity' ? 'active' : ''} onClick={() => setTab('equity')}>
          胜率 & EV
        </button>
        <button className={tab === 'range' ? 'active' : ''} onClick={() => setTab('range')}>
          对手范围
        </button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          数据
        </button>
        <button onClick={onOpenChart} title="翻前范围表">
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
              <div className="equity-note">
                对 {opponents.length} 个未弃牌对手的推断范围{honest ? '（诚实模式：仅按可观察统计）' : ''}
              </div>
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
                  {icmNeeded !== null ? (
                    <div className="ev-row ev-icm" title="按奖金（ICM）口径：淘汰风险让所需胜率高于纯筹码口径">
                      <span>ICM 口径所需</span>
                      <b>{(icmNeeded * 100).toFixed(1)}%</b>
                    </div>
                  ) : null}
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
                  <div className="ev-hint">
                    {icmNeeded !== null && eq >= needed && eq < icmNeeded
                      ? '△ 筹码口径可跟，但按 ICM 口径胜率不足——泡沫期慎跟'
                      : eq >= needed
                        ? '✓ 胜率高于所需，跟注为正 EV'
                        : '✗ 胜率不足，纯赔率角度应弃牌'}
                  </div>
                </div>
              ) : null}
              {isHumanTurn && bluffBE !== null ? (
                <div className="ev-aux">
                  若在此{toCall > 0 ? '加注' : '下注'}约 {bluffRisk} 作纯诈唬，对手弃牌率需 ≥ {(bluffBE * 100).toFixed(0)}% 才盈亏平衡
                </div>
              ) : null}
            </>
          ) : (
            <div className="hud-empty">{heroCards ? '计算中…' : '等待发牌'}</div>
          )}
        </div>
      ) : tab === 'range' ? (
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
              <div className="mode-toggle" title="上帝视角借用 AI 的真实策略反推；诚实模式只用你在牌桌上能观察到的行为统计（以紧凶为先验）">
                <button className={!honest ? 'active' : ''} onClick={() => onToggleHonest(false)}>
                  上帝视角
                </button>
                <button className={honest ? 'active' : ''} onClick={() => onToggleHonest(true)}>
                  诚实模式
                </button>
              </div>
              <div className="hud-note">
                颜色越深 = 该手牌类在其推断范围中的权重越高（已按行动线贝叶斯收窄）。
                {honest ? '诚实模式下推断不知道 AI 的真实参数，只按其公开统计推——真实牌桌上你能做到的最好假设。' : '上帝视角借用了每个 AI 的真实策略函数。'}
              </div>
            </>
          ) : (
            <div className="hud-empty">无活跃对手</div>
          )}
        </div>
      ) : (
        <div className="hud-body">
          <StatsTable rows={stats} humanSeat={humanSeat} />
          {heroProfile ? (
            <div className="profile-box">
              <div className="profile-head">
                AI 眼中的你 <span className="profile-tag">{heroProfile.quadrant}</span>
              </div>
              <div className="profile-text">{heroProfile.text}</div>
            </div>
          ) : null}
          <div className="hud-note">
            VPIP 入池 · PFR 翻前加注 · 3B 面对开牌 3bet · AF 翻后进攻因子 · CB 翻牌持续下注 · F2B 翻后面对下注弃牌 · WTSD 见翻牌后摊牌。样本不足显示 —
          </div>
        </div>
      )}
      {heroCards ? (
        <div className="hud-footer">你的手牌类：{className(classIdOfCards(heroCards[0], heroCards[1]))}</div>
      ) : null}
    </div>
  )
}

function StatsTable({ rows, humanSeat }: { rows: HudStatRow[]; humanSeat: number }) {
  const pct = (v: number, n: number, min = 3) => (n >= min ? `${Math.round(v * 100)}` : '—')
  return (
    <div className="stats-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th className="stats-name">玩家</th>
            <th title="手数">手</th>
            <th title="入池率 %">VPIP</th>
            <th title="翻前加注率 %">PFR</th>
            <th title="面对开牌的 3bet 率 %">3B</th>
            <th title="翻后进攻因子 (下注+加注)/跟注">AF</th>
            <th title="翻牌持续下注率 %">CB</th>
            <th title="翻后面对下注弃牌率 %">F2B</th>
            <th title="见翻牌后走到摊牌 %">WTSD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = r.rates
            const color = r.player.style !== 'human' ? STYLES[r.player.style].color : HUMAN_COLOR
            return (
              <tr key={r.seat} className={`${r.seat === humanSeat ? 'me' : ''}${r.active ? '' : ' inactive'}`}>
                <td className="stats-name">
                  <i className="opp-dot" style={{ background: color }} />
                  {r.player.name}
                  {r.seat === humanSeat ? '（你）' : ''}
                </td>
                <td>{s.hands}</td>
                <td>{pct(s.vpip, s.hands, 1)}</td>
                <td>{pct(s.pfr, s.hands, 1)}</td>
                <td>{pct(s.threeBet, s.n.threeBet)}</td>
                <td>{s.n.af >= 4 ? s.af.toFixed(1) : '—'}</td>
                <td>{pct(s.cbet, s.n.cbet)}</td>
                <td>{pct(s.foldVsBet, s.n.foldVsBet)}</td>
                <td>{pct(s.wtsd, s.n.wtsd)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
