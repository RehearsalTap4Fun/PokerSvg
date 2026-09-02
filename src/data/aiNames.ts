import type { AiStyleId } from '../core/types'

// AI 阵容：传奇桌（知名选手致敬版，各自独立风格参数）与风格桌（基础五风格）。

export interface AiSeatDef {
  id: string
  name: string
  style: AiStyleId
}

export type RosterKind = 'legend' | 'classic'

/** 风格桌：8 个基础风格 AI */
export const AI_ROSTER: AiSeatDef[] = [
  { id: 'ai-prof', name: '教授', style: 'tag' },
  { id: 'ai-wolf', name: '狼哥', style: 'lag' },
  { id: 'ai-rock', name: '石头', style: 'rock' },
  { id: 'ai-cow', name: '牛姐', style: 'station' },
  { id: 'ai-mad', name: '疯子李', style: 'maniac' },
  { id: 'ai-jing', name: '静静', style: 'tag' },
  { id: 'ai-hao', name: '阿豪', style: 'lag' },
  { id: 'ai-tie', name: '铁柱', style: 'rock' },
]

/** 传奇桌：扑克史上的知名选手（打法致敬版） */
export const PRO_ROSTER: AiSeatDef[] = [
  { id: 'pro-ivey', name: '艾维', style: 'ivey' },
  { id: 'pro-dwan', name: '毒王德万', style: 'dwan' },
  { id: 'pro-hellmuth', name: '赫尔穆斯', style: 'hellmuth' },
  { id: 'pro-negreanu', name: '丹牛', style: 'negreanu' },
  { id: 'pro-brunson', name: '布朗森', style: 'brunson' },
  { id: 'pro-isildur', name: 'Isildur', style: 'isildur' },
  { id: 'pro-chan', name: '陈强尼', style: 'chan' },
  { id: 'pro-ungar', name: '昂格尔', style: 'ungar' },
]

export function rosterFor(kind: RosterKind): AiSeatDef[] {
  return kind === 'legend' ? PRO_ROSTER : AI_ROSTER
}
