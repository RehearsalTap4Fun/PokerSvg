import type { Postmortem } from '../analysis/postmortem'
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
        {s.biggestWin ? <StatCell label="最大单手盈利" value={`+${fmtChips(s.biggestWin.delta)}`} hint={`第 ${s.biggestWin.handNo} 手`} /> : null}
        {s.biggestLoss ? <StatCell label="最大单手亏损" value={fmtChips(s.biggestLoss.delta)} hint={`第 ${s.biggestLoss.handNo} 手`} /> : null}
      </div>
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

function StatCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="pm-cell">
      <div className="pm-cell-label">{label}</div>
      <div className="pm-cell-value">{value}</div>
      {hint ? <div className="pm-cell-hint">{hint}</div> : null}
    </div>
  )
}
