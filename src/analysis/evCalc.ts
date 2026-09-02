// 底池赔率与简化 EV 计算（HUD 展示 + AI 决策共用）

/** 跟注所需胜率 = toCall / (pot + toCall)，pot 为当前底池（含对手本街已投入，不含本次跟注） */
export function requiredEquity(pot: number, toCall: number): number {
  if (toCall <= 0) return 0
  return toCall / (pot + toCall)
}

/** 跟注相对弃牌的 EV（以筹码计）：equity×(pot+toCall) − toCall */
export function callEV(equity: number, pot: number, toCall: number): number {
  return equity * (pot + toCall) - toCall
}

/** 纯诈唬加注的盈亏平衡弃牌率：risk / (risk + pot) */
export function bluffBreakeven(pot: number, risk: number): number {
  if (risk <= 0) return 0
  return risk / (risk + pot)
}

/** 底池赔率的展示形式 "3.5 : 1" */
export function potOddsText(pot: number, toCall: number): string {
  if (toCall <= 0) return '—'
  return `${(pot / toCall).toFixed(1)} : 1`
}
