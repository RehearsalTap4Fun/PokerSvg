import { RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from '../core/cards'

export function CardView({ card, faceUp, size = 'md' }: { card: number | null; faceUp: boolean; size?: 'sm' | 'md' | 'lg' }) {
  // key 随 牌面/朝向 变化：发牌与摊牌翻面时强制重挂载，触发 CSS 入场动画
  if (card === null || !faceUp) {
    return <div key={card === null ? 'empty' : `b${card}`} className={`card card-${size} card-back${card === null ? ' card-empty' : ''}`} />
  }
  const suit = suitOf(card)
  const red = suit === 1 || suit === 2
  const rank = RANK_CHARS[rankOf(card)] === 'T' ? '10' : RANK_CHARS[rankOf(card)]
  return (
    <div key={`f${card}`} className={`card card-${size} ${red ? 'card-red' : 'card-black'}`}>
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{SUIT_SYMBOLS[suit]}</span>
    </div>
  )
}
