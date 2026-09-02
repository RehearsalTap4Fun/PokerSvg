import { COMBO_COUNT, cardsToMask, comboBlocked } from '../core/handClass'
import { policyForCombo, type ActionDist, type PublicSituation } from '../ai/policy'
import type { AiStyle } from '../ai/styles'
import { type Range } from './range'

// 贝叶斯范围收窄：观察到某座位动作 a 后，w[h] *= max(ε, π(a | style, 局面, h))。
// 与 AI 决策共用同一个 policy —— 推断即真实条件分布（equity 精修引入的有界偏差除外）。

export const EPSILON = 0.02

export type ObservedAction = 'check' | 'call' | 'raise' // bet 并入 raise

export function actionDistValue(d: ActionDist, obs: ObservedAction): number {
  return obs === 'check' ? d.check : obs === 'call' ? d.call : d.raise
}

/** 初始范围：均匀（后续由翻前动作立即收窄） */
export function initialRange(): Range {
  return new Float64Array(COMBO_COUNT).fill(1 / COMBO_COUNT)
}

/**
 * 观察一次动作，原地更新范围。
 * deadCards：观察者视角的已知牌（公共牌；HUD 视角额外含英雄手牌）。
 */
export function observeAction(range: Range, style: AiStyle, sit: PublicSituation, obs: ObservedAction, deadCards: readonly number[]): void {
  const { lo, hi } = cardsToMask(deadCards)
  let total = 0
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (range[i] <= 0) continue
    if (comboBlocked(i, lo, hi)) {
      range[i] = 0
      continue
    }
    const p = actionDistValue(policyForCombo(style, sit, i), obs)
    range[i] *= Math.max(EPSILON, p)
    total += range[i]
  }
  if (total < 1e-12) {
    // 范围塌缩兜底：重置为未被阻断的均匀分布
    let n = 0
    for (let i = 0; i < COMBO_COUNT; i++) n += comboBlocked(i, lo, hi) ? 0 : 1
    for (let i = 0; i < COMBO_COUNT; i++) range[i] = comboBlocked(i, lo, hi) ? 0 : 1 / n
    return
  }
  for (let i = 0; i < COMBO_COUNT; i++) range[i] /= total
}

/** 新街发牌：只做卡牌移除并重新归一化 */
export function observeBoard(range: Range, newCards: readonly number[]): void {
  const { lo, hi } = cardsToMask(newCards)
  let total = 0
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (range[i] > 0 && comboBlocked(i, lo, hi)) range[i] = 0
    total += range[i]
  }
  if (total > 0) for (let i = 0; i < COMBO_COUNT; i++) range[i] /= total
}
