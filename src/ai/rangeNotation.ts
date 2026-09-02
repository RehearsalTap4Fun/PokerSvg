import { RANK_CHARS } from '../core/cards'
import { CLASS_COMBOS, classIdOfName } from '../core/handClass'

// 标准范围记法 → 169 类频率表（Float64Array，0..1）。
// 支持：AA / TT+ / 88-55 / AKs / AKo / AK（双色）/ A2s+ / K9s+ / A9s-A2s / T9s-54s（同间隔连张系列）/ 频率后缀 :0.5
// 例："22+, A2s+, KTs+, AJo+, KQo:0.5"。重叠时取较大频率。

const RANK_IDX = (ch: string): number => {
  const i = RANK_CHARS.indexOf(ch.toUpperCase())
  if (i < 0) throw new Error(`非法牌面: ${ch}`)
  return i
}

function addClass(out: Float64Array, name: string, freq: number): void {
  const cls = classIdOfName(name)
  if (freq > out[cls]) out[cls] = freq
}

function addTwo(out: Float64Array, hi: number, lo: number, suit: 's' | 'o' | '', freq: number): void {
  if (hi === lo) {
    addClass(out, RANK_CHARS[hi] + RANK_CHARS[lo], freq)
    return
  }
  const h = RANK_CHARS[Math.max(hi, lo)]
  const l = RANK_CHARS[Math.min(hi, lo)]
  if (suit === 's' || suit === '') addClass(out, h + l + 's', freq)
  if (suit === 'o' || suit === '') addClass(out, h + l + 'o', freq)
}

function parseToken(out: Float64Array, tokRaw: string): void {
  let tok = tokRaw.trim()
  if (!tok) return
  let freq = 1
  const colon = tok.indexOf(':')
  if (colon >= 0) {
    freq = Number(tok.slice(colon + 1))
    if (!(freq >= 0 && freq <= 1)) throw new Error(`非法频率: ${tokRaw}`)
    tok = tok.slice(0, colon).trim()
  }
  const plus = tok.endsWith('+')
  if (plus) tok = tok.slice(0, -1)

  const dash = tok.indexOf('-')
  if (dash > 0) {
    const a = tok.slice(0, dash).trim()
    const b = tok.slice(dash + 1).trim()
    const a1 = RANK_IDX(a[0])
    const a2 = RANK_IDX(a[1])
    const b1 = RANK_IDX(b[0])
    const b2 = RANK_IDX(b[1])
    const suitA = (a[2]?.toLowerCase() ?? '') as 's' | 'o' | ''
    if (a1 === a2 && b1 === b2) {
      // 对子区间
      for (let r = Math.min(a1, b1); r <= Math.max(a1, b1); r++) addTwo(out, r, r, '', freq)
      return
    }
    const hiA = Math.max(a1, a2)
    const loA = Math.min(a1, a2)
    const hiB = Math.max(b1, b2)
    const loB = Math.min(b1, b2)
    if (hiA === hiB) {
      // 同高张：低张区间
      for (let l = Math.min(loA, loB); l <= Math.max(loA, loB); l++) addTwo(out, hiA, l, suitA, freq)
      return
    }
    if (hiA - loA === hiB - loB) {
      // 同间隔系列（连张/隔张）
      const gap = hiA - loA
      for (let h = Math.min(hiA, hiB); h <= Math.max(hiA, hiB); h++) addTwo(out, h, h - gap, suitA, freq)
      return
    }
    throw new Error(`无法解析区间: ${tokRaw}`)
  }

  const r1 = RANK_IDX(tok[0])
  const r2 = RANK_IDX(tok[1])
  const suit = (tok[2]?.toLowerCase() ?? '') as 's' | 'o' | ''
  if (suit !== 's' && suit !== 'o' && suit !== '') throw new Error(`非法后缀: ${tokRaw}`)
  if (r1 === r2) {
    if (plus) for (let r = r1; r <= 12; r++) addTwo(out, r, r, '', freq)
    else addTwo(out, r1, r1, '', freq)
    return
  }
  const hi = Math.max(r1, r2)
  const lo = Math.min(r1, r2)
  if (plus) {
    for (let l = lo; l < hi; l++) addTwo(out, hi, l, suit, freq)
  } else {
    addTwo(out, hi, lo, suit, freq)
  }
}

/** 解析范围字符串为 169 类频率表 */
export function parseRange(text: string): Float64Array {
  const out = new Float64Array(169)
  for (const tok of text.split(',')) parseToken(out, tok)
  return out
}

/** 频率表覆盖的组合占比（0..1） */
export function tablePct(table: Float64Array): number {
  let combos = 0
  for (let cls = 0; cls < 169; cls++) combos += table[cls] * CLASS_COMBOS[cls].length
  return combos / 1326
}
