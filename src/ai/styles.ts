import type { AiStyleId } from '../core/types'

// 五种 AI 性格参数。范围推断读出的差异应当肉眼可辨：
// 岩石的矩阵集中在左上角，疯鱼铺满。

export interface AiStyle {
  id: AiStyleId
  name: string
  emoji: string
  /** 专属头像色（色环与浅底），需在深浅主题下都可读 */
  color: string
  desc: string
  /** 翻前范围宽度系数（乘在基准百分位上） */
  looseness: number
  /** 翻后主动下注/加注倾向系数 */
  aggression: number
  /** 基础诈唬频率（空气牌下注的倾向） */
  bluffFreq: number
  /** 面对攻击时无牌弃牌倾向（越高越容易被打走） */
  foldToAgg: number
  /** 跟注站程度（有一点牌就不弃） */
  callDown: number
  /** 开局加注 size（BB 倍数） */
  openSize: number
  /** 3bet 频率系数 */
  threeBet: number
}

export const STYLES: Record<AiStyleId, AiStyle> = {
  tag: {
    id: 'tag',
    name: '紧凶',
    emoji: '🦈',
    color: '#3b82f6',
    desc: '范围紧、下注凶，标准打法',
    looseness: 1.0,
    aggression: 1.0,
    bluffFreq: 0.12,
    foldToAgg: 0.55,
    callDown: 0.35,
    openSize: 2.5,
    threeBet: 1.0,
  },
  lag: {
    id: 'lag',
    name: '松凶',
    emoji: '🐺',
    color: '#f59e0b',
    desc: '范围宽、持续施压、诈唬多',
    looseness: 1.45,
    aggression: 1.3,
    bluffFreq: 0.22,
    foldToAgg: 0.45,
    callDown: 0.4,
    openSize: 2.8,
    threeBet: 1.6,
  },
  rock: {
    id: 'rock',
    name: '岩石',
    emoji: '🗿',
    color: '#8a8f98',
    desc: '只玩强牌，极少诈唬',
    looseness: 0.55,
    aggression: 0.8,
    bluffFreq: 0.04,
    foldToAgg: 0.75,
    callDown: 0.2,
    openSize: 2.2,
    threeBet: 0.6,
  },
  station: {
    id: 'station',
    name: '跟注站',
    emoji: '🐮',
    color: '#ec4899',
    desc: '什么都跟，很少主动加注',
    looseness: 1.7,
    aggression: 0.5,
    bluffFreq: 0.06,
    foldToAgg: 0.2,
    callDown: 0.85,
    openSize: 2.2,
    threeBet: 0.4,
  },
  maniac: {
    id: 'maniac',
    name: '疯鱼',
    emoji: '🐙',
    color: '#a855f7',
    desc: '范围极宽、疯狂加注施压',
    looseness: 2.2,
    aggression: 1.7,
    bluffFreq: 0.35,
    foldToAgg: 0.3,
    callDown: 0.55,
    openSize: 3.0,
    threeBet: 2.2,
  },

  // —— 传奇选手：以公开打法印象参数化的"致敬版"AI，各自独立倾向 ——
  ivey: {
    id: 'ivey',
    name: '全能',
    emoji: '🦁',
    color: '#d97706',
    desc: '菲尔·艾维：公认 GOAT，全面压制、读牌如 X 光，进攻与纪律兼备',
    looseness: 1.25,
    aggression: 1.35,
    bluffFreq: 0.2,
    foldToAgg: 0.42,
    callDown: 0.45,
    openSize: 2.5,
    threeBet: 1.5,
  },
  dwan: {
    id: 'dwan',
    name: '超凶',
    emoji: '🔥',
    color: '#ef4444',
    desc: '汤姆·德万 "durrrr"：毒王，超激进的深筹码诈唬艺术家，三条街开火不眨眼',
    looseness: 1.9,
    aggression: 1.55,
    bluffFreq: 0.32,
    foldToAgg: 0.3,
    callDown: 0.5,
    openSize: 2.8,
    threeBet: 2.0,
  },
  hellmuth: {
    id: 'hellmuth',
    name: '极紧',
    emoji: '👑',
    color: '#7c3aed',
    desc: '菲尔·赫尔穆斯：14 条 WSOP 金手链的"扑克顽童"，翻前极紧、靠白魔法躲炸弹',
    looseness: 0.7,
    aggression: 0.9,
    bluffFreq: 0.07,
    foldToAgg: 0.7,
    callDown: 0.3,
    openSize: 2.2,
    threeBet: 0.7,
  },
  negreanu: {
    id: 'negreanu',
    name: '小球',
    emoji: '🎯',
    color: '#14b8a6',
    desc: '丹尼尔·内格里诺 "丹牛"：小球战术大师，范围宽、小注控池、摊牌率高、读牌精准',
    looseness: 1.55,
    aggression: 0.9,
    bluffFreq: 0.14,
    foldToAgg: 0.35,
    callDown: 0.65,
    openSize: 2.2,
    threeBet: 0.9,
  },
  brunson: {
    id: 'brunson',
    name: '老派凶',
    emoji: '🤠',
    color: '#b45309',
    desc: '道尔·布朗森：德州教父，老派激进，10-2 是他两夺世界冠军的招牌牌',
    looseness: 1.35,
    aggression: 1.25,
    bluffFreq: 0.22,
    foldToAgg: 0.45,
    callDown: 0.4,
    openSize: 2.6,
    threeBet: 1.3,
  },
  isildur: {
    id: 'isildur',
    name: '疯狂',
    emoji: '⚡',
    color: '#0ea5e9',
    desc: '维克多·布洛姆 "Isildur1"：横空出世的网络疯人，极端变速，全下如喝水',
    looseness: 2.2,
    aggression: 1.75,
    bluffFreq: 0.36,
    foldToAgg: 0.28,
    callDown: 0.55,
    openSize: 3.0,
    threeBet: 2.3,
  },
  chan: {
    id: 'chan',
    name: '稳凶',
    emoji: '🐉',
    color: '#10b981',
    desc: '强尼·陈 "东方快车"：背靠背世界冠军，稳、准、狠，桌上永远摆着一只橙子',
    looseness: 1.0,
    aggression: 1.15,
    bluffFreq: 0.13,
    foldToAgg: 0.5,
    callDown: 0.35,
    openSize: 2.4,
    threeBet: 1.1,
  },
  ungar: {
    id: 'ungar',
    name: '天才凶',
    emoji: '☄️',
    color: '#e11d48',
    desc: '斯图·昂格尔：三夺世界冠军的悲情天才，攻击性与读牌天赋史上罕见',
    looseness: 1.7,
    aggression: 1.5,
    bluffFreq: 0.28,
    foldToAgg: 0.35,
    callDown: 0.45,
    openSize: 2.7,
    threeBet: 1.8,
  },
}

/** 人类玩家头像色 */
export const HUMAN_COLOR = '#64748b'

/** 人类玩家在 AI/推断眼中按紧凶模型处理 */
export function styleOf(id: AiStyleId | 'human'): AiStyle {
  return id === 'human' ? STYLES.tag : STYLES[id]
}
