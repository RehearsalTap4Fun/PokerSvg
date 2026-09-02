// 牌的表示：0-51 整数。rank = c >> 2（0=2 … 8=T, 9=J, 10=Q, 11=K, 12=A），suit = c & 3（0=♣ 1=♦ 2=♥ 3=♠）
// 热路径（评牌/蒙特卡洛）零对象分配的基础。

export type Card = number

export const RANK_CHARS = '23456789TJQKA'
export const SUIT_CHARS = 'cdhs'
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠']

export const rankOf = (c: Card): number => c >> 2
export const suitOf = (c: Card): number => c & 3
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit

/** "As" / "Td" 形式（序列化用） */
export function cardToStr(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)]
}

/** "A♠" 形式（展示用） */
export function cardToText(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_SYMBOLS[suitOf(c)]
}

export function strToCard(s: string): Card {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase())
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase())
  if (r < 0 || su < 0) throw new Error(`非法牌面字符串: ${s}`)
  return makeCard(r, su)
}

/** "AsKh" 或 "As Kh Qd" → Card[] */
export function strToCards(s: string): Card[] {
  const compact = s.replace(/[\s,]/g, '')
  const out: Card[] = []
  for (let i = 0; i + 1 < compact.length; i += 2) out.push(strToCard(compact.slice(i, i + 2)))
  return out
}

export function freshDeck(): Card[] {
  const d: Card[] = new Array(52)
  for (let i = 0; i < 52; i++) d[i] = i
  return d
}
