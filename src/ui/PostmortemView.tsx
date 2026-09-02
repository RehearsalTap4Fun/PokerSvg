import type { CurvePoint, Postmortem } from '../analysis/postmortem'
import { fmtChips } from '../core/format'

// 赛后复盘分析展示：统计条 + 固定规则生成的发现列表

export function PostmortemView({ data }: { data: Postmortem }) {
  const s = data.stats
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  return (
    <div className="pm">
      <div className="pm-stats">
        <StatCell label="手数" value={String(s.hands)} />
        <StatCell label="入池 VPIP" value={pct(s.vpip)} hint="参考 15-30%" />
        <StatCell label="翻前加注 PFR" value={pct(s.pfr)} />
        <StatCell label="3bet 次数" value={String(s.threeBets)} />
        <StatCell label="见翻牌" value={pct(s.sawFlopRate)} />
        <StatCell label="走向摊牌" value={s.wtsd > 0 ? pct(s.wtsd) : '—'} />
        <StatCell label="摊牌胜率" value={s.wtsd > 0 ? pct(s.wsd) : '—'} />
        <StatCell label="全下次数" value={String(s.allIns)} />
        {s.icmLeaks > 0 ? <StatCell label="ICM 漏洞" value={String(s.icmLeaks)} hint="奖金负 EV 跟注" /> : null}
        <StatCell label="决策损失" value={fmtChips(s.evLoss)} hint="面对下注的跟/弃 vs 最优" />
        {s.looseDeviations + s.tightDeviations > 0 ? (
          <StatCell label="翻前偏离" value={`松 ${s.looseDeviations} · 紧 ${s.tightDeviations}`} hint="相对紧凶基准" />
        ) : null}
        {s.biggestWin ? <StatCell label="最大单手盈利" value={`+${fmtChips(s.biggestWin.delta)}`} hint={`第 ${s.biggestWin.handNo} 手`} /> : null}
        {s.biggestLoss ? <StatCell label="最大单手亏损" value={fmtChips(s.biggestLoss.delta)} hint={`第 ${s.biggestLoss.handNo} 手`} /> : null}
      </div>
      {data.curve.length >= 3 ? <CurveChart points={data.curve} /> : null}
      <div className="pm-findings">
        {data.findings.length === 0 ? <div className="top-dim">样本不足，暂无可分析的发现</div> : null}
        {data.findings.map((f, i) => (
          <div key={i} className={`pm-finding pm-${f.severity}`}>
            <span className="pm-dot" />
            <span>{f.text}</span>
          </div>
        ))}
      </div>
      <div className="pm-note">以上由固定规则从对局记录自动生成；涉及手号的条目可在「复盘」中逐街回放核对。</div>
    </div>
  )
}

/** 红蓝线：累计盈亏（黑）拆成摊牌盈亏（蓝）与非摊牌盈亏（红） */
function CurveChart({ points }: { points: CurvePoint[] }) {
  const W = 600
  const H = 120
  const pad = 6
  let lo = 0
  let hi = 0
  for (const p of points) {
    lo = Math.min(lo, p.total, p.showdown, p.nonShowdown)
    hi = Math.max(hi, p.total, p.showdown, p.nonShowdown)
  }
  if (hi - lo < 1) hi = lo + 1
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (W - 2 * pad)
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad)
  const path = (pick: (p: CurvePoint) => number) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <div className="pm-curve">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="盈亏曲线">
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#c9ced4" strokeWidth={1} strokeDasharray="4 4" />
        <path d={path((p) => p.nonShowdown)} fill="none" stroke="#d92d20" strokeWidth={1.8} />
        <path d={path((p) => p.showdown)} fill="none" stroke="#2563eb" strokeWidth={1.8} />
        <path d={path((p) => p.total)} fill="none" stroke="#17191c" strokeWidth={2.2} />
      </svg>
      <div className="pm-curve-legend">
        <span>
          <i style={{ background: '#17191c' }} />
          累计 {last.total >= 0 ? '+' : ''}
          {fmtChips(last.total)}
        </span>
        <span>
          <i style={{ background: '#2563eb' }} />
          摊牌 {last.showdown >= 0 ? '+' : ''}
          {fmtChips(last.showdown)}
        </span>
        <span>
          <i style={{ background: '#d92d20' }} />
          非摊牌 {last.nonShowdown >= 0 ? '+' : ''}
          {fmtChips(last.nonShowdown)}
        </span>
      </div>
    </div>
  )
}

function StatCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="pm-cell">
      <div className="pm-cell-label">{label}</div>
      <div className="pm-cell-value">{value}</div>
      {hint ? <div className="pm-cell-hint">{hint}</div> : null}
    </div>
  )
}
