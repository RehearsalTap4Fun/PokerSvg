import { legalActions } from '../core/betting'
import { currentPot } from '../core/hand'
import { rankOf, suitOf } from '../core/cards'
import { classIdOfCards, className } from '../core/handClass'
import { CAT_TWO_PAIR, categoryOf, describeScore, evaluateCards } from '../core/evaluator'
import { fmtChips } from '../core/format'
import { mixSeed, mulberry32 } from '../core/rng'
import type { Action, HandState, LegalActions, Street } from '../core/types'
import { situationFor } from '../ai/decide'
import { policyForCards, type ActionDist, type PublicSituation } from '../ai/policy'
import { PERCENTILE, POSITION_ZH } from '../ai/preflopCharts'
import { STYLES, type AiStyle } from '../ai/styles'
import { Bucket, bucketOf } from './buckets'
import { boardTexture } from './texture'
import { equityMC } from './equity'
import type { Range } from './range'
import { bluffBreakeven, requiredEquity } from './evCalc'
import { icmRequiredEquity } from './icm'

// 观察员点评：英雄每次行动后，以职业牌手观战的口吻给出一句评价（固定规则、确定性，无模型参与）。
// 依据：紧凶基准 policy 对该手牌在该局面的行动频率、对推断范围的胜率 vs 底池赔率、ICM、
// 牌力桶 × 牌面纹理、下注尺度、对手风格。只用行动当时观察者可知的信息，不看对手真实底牌（不做结果论）。
// 评级借用棋类注解符号：!! 妙手 / ! 好棋 / !? 趣着 / 本手 / ?! 疑问手 / ? 恶手 / ?? 败着。

export type Mark = '!!' | '!' | '!?' | '' | '?!' | '?' | '??'

export const MARK_LABEL: Record<Mark, string> = {
  '!!': '妙手',
  '!': '好棋',
  '!?': '趣着',
  '': '本手',
  '?!': '疑问手',
  '?': '恶手',
  '??': '败着',
}

const MARK_SCORE: Record<Mark, number> = { '!!': 3, '!': 2, '!?': 1, '': 0, '?!': -1, '?': -2, '??': -3 }

export interface HandComment {
  /** 该行动事件在本手事件流中的下标（复盘按游标定位） */
  eventIdx: number
  handNo: number
  street: Street
  mark: Mark
  /** 行动摘要，如 "翻牌 · 下注 120（半池）" */
  head: string
  text: string
}

export interface CommentContext {
  /** 行动前的牌局状态 */
  state: HandState
  seat: number
  action: Action
  /** 其他座位的推断范围（公共观察者视角） */
  ranges: ReadonlyMap<number, Range>
  payouts: readonly number[]
  eventIdx: number
  styleFor?: (seat: number) => AiStyle
  nameOf?: (seat: number) => string
}

interface Note {
  mark: Mark
  text: string
}

type Kind = 'fold' | 'check' | 'call' | 'bet' | 'raise'

interface Facts {
  state: HandState
  seat: number
  sit: PublicSituation
  legal: LegalActions
  street: Street
  bb: number
  pot: number
  toCall: number
  /** 行动前身后筹码 */
  stack: number
  kind: Kind
  allIn: boolean
  /** 下注/加注"到"的额度 */
  to: number
  /** 本次行动新投入的筹码 */
  added: number
  hand: string
  pct: number
  pos: string
  /** 紧凶基准在该局面对该手牌选择此类行动的频率（已做合法性归并） */
  freq: number
  base: ActionDist
  eq: number | null
  needed: number
  icmNeeded: number | null
  bucket: Bucket | null
  wet: number
  nOpp: number
  villain: AiStyle | null
  villainName: string
  pick: (options: string[], salt?: number) => string
}

const STREET_ZH: Record<string, string> = { preflop: '翻前', flop: '翻牌', turn: '转牌', river: '河牌' }

const pctTxt = (x: number): string => `${Math.round(x * 100)}%`
const bbTxt = (x: number): string => {
  const r = Math.round(x * 10) / 10
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}bb`
}
const topTxt = (pct: number): string => `前 ${Math.max(1, Math.round(pct * 100))}%`

function sizeTxt(frac: number): string {
  if (frac <= 0.28) return '1/4 池'
  if (frac <= 0.4) return '1/3 池'
  if (frac <= 0.58) return '半池'
  if (frac <= 0.8) return '2/3 池'
  if (frac <= 1.1) return '满池'
  return `${frac.toFixed(1)} 倍超池`
}

function kindOf(a: Action): Kind {
  return a.type
}

function chosenFreq(base: ActionDist, legal: LegalActions, toCall: number, kind: Kind): number {
  const d = { ...base }
  if (!legal.canRaise) {
    d.call += d.raise
    d.raise = 0
  }
  if (legal.canCheck) {
    d.check += d.fold
    d.fold = 0
    if (toCall === 0) {
      d.check += d.call
      d.call = 0
    }
  } else if (d.check > 0) {
    d.call += d.check
    d.check = 0
  }
  const key: keyof ActionDist = kind === 'bet' || kind === 'raise' ? 'raise' : kind
  return d[key]
}

function buildFacts(ctx: CommentContext): Facts | null {
  const { state, seat, action } = ctx
  const me = state.seats[seat]
  if (!me || !me.holeCards || state.street === 'done' || state.street === 'showdown') return null
  const [c1, c2] = me.holeCards
  const sit = situationFor(state, seat)
  const legal = legalActions(state)
  const pot = currentPot(state)
  const toCall = legal.callAmount
  const kind = kindOf(action)
  const to = action.type === 'bet' || action.type === 'raise' ? action.to : 0
  const added = kind === 'call' ? Math.min(toCall, me.stack) : kind === 'bet' || kind === 'raise' ? to - me.committed : 0
  const allIn = (kind === 'call' && toCall >= me.stack) || ((kind === 'bet' || kind === 'raise') && to >= me.committed + me.stack)
  const classId = classIdOfCards(c1, c2)
  const base = policyForCards(STYLES.tag, sit, c1, c2)

  const opponents: Range[] = []
  for (const s of state.seats) {
    if (s && !s.folded && s.seat !== seat) {
      const r = ctx.ranges.get(s.seat)
      if (r) opponents.push(r)
    }
  }
  const nOpp = state.seats.filter((s) => s && !s.folded && s.seat !== seat).length

  // 翻前只在面对下注时算胜率（开池/弃牌看基准表即可）；翻后始终算
  let eq: number | null = null
  if (opponents.length > 0 && (state.street !== 'preflop' || toCall > 0)) {
    const r = equityMC({ hero: [c1, c2], board: state.board, opponents }, 1500, mulberry32(mixSeed(state.seed, 0xc0ffee + ctx.eventIdx)))
    if (r.trials > 0) eq = r.equity
  }

  const heavy = toCall > 0 && toCall >= me.stack * 0.4
  const icmNeeded = heavy ? icmRequiredEquity(state, seat, ctx.payouts) : null

  // 对手：面对下注时是最后进攻者；否则单挑时是唯一对手
  let villainSeat = -1
  if (toCall > 0 && state.lastAggressor >= 0 && state.lastAggressor !== seat) villainSeat = state.lastAggressor
  else if (nOpp === 1) villainSeat = state.seats.find((s) => s && !s.folded && s.seat !== seat)!.seat
  const villain = villainSeat >= 0 && ctx.styleFor ? ctx.styleFor(villainSeat) : null
  const villainName = villainSeat >= 0 ? (ctx.nameOf?.(villainSeat) ?? '对手') : '对手们'

  const pickRng = (salt: number) => mixSeed(mixSeed(state.seed, ctx.eventIdx * 131 + 7), salt)

  return {
    state,
    seat,
    sit,
    legal,
    street: state.street,
    bb: state.level.bb,
    pot,
    toCall,
    stack: me.stack,
    kind,
    allIn,
    to,
    added,
    hand: className(classId),
    pct: PERCENTILE[classId],
    pos: POSITION_ZH[sit.position],
    freq: chosenFreq(base, legal, toCall, kind),
    base,
    eq,
    needed: requiredEquity(pot, Math.min(toCall, me.stack)),
    icmNeeded,
    bucket: state.street !== 'preflop' ? effectiveBucket(c1, c2, state.board) : null,
    wet: state.board.length >= 3 ? boardTexture(state.board).wetness : 0,
    nOpp,
    villain,
    villainName,
    pick: (options, salt = 0) => options[pickRng(salt) % options.length],
  }
}

function headOf(f: Facts): string {
  const st = STREET_ZH[f.street] ?? ''
  let act: string
  switch (f.kind) {
    case 'fold':
      act = '弃牌'
      break
    case 'check':
      act = '过牌'
      break
    case 'call':
      act = `跟注 ${fmtChips(f.added)}${f.allIn ? '（全下）' : ''}`
      break
    case 'bet':
      act = f.allIn ? `全下 ${fmtChips(f.to)}` : `下注 ${fmtChips(f.to)}（${sizeTxt(f.added / Math.max(1, f.pot))}）`
      break
    case 'raise':
      act = f.allIn ? `全下 ${fmtChips(f.to)}` : f.street === 'preflop' ? `加注到 ${bbTxt(f.to / f.bb)}` : `加注到 ${fmtChips(f.to)}`
      break
  }
  return `${st} · ${act}`
}

// —— 通用：面对下注时的赔率判断（跟注/弃牌） ——

function priceNote(f: Facts): Note | null {
  if (f.eq === null || f.toCall <= 0) return null
  const call = Math.min(f.toCall, f.stack)
  const gap = f.eq - f.needed
  const ev = f.eq * (f.pot + call) - call
  const eq = pctTxt(f.eq)
  const need = pctTxt(f.needed)
  const odds = `${(f.pot / call).toFixed(1)}:1`
  const vs = f.villainName === '对手们' ? '桌上剩余范围' : `${f.villainName}的范围`
  const icm = f.icmNeeded

  if (f.kind === 'fold') {
    if (icm !== null && f.eq >= f.needed - 0.01 && f.eq < icm - 0.015) {
      return {
        mark: '!',
        text: `筹码口径约 ${eq} 对所需 ${need}，看起来能跟；但这一跟输了就出局，按 ICM 要 ${pctTxt(icm)}。懂得在奖金结构下让一步，成熟的弃牌。`,
      }
    }
    if (gap > 0.06 && ev > f.bb * 0.5) {
      return {
        mark: gap > 0.2 && ev > f.bb * 3 ? '??' : '?',
        text: `底池给到 ${odds}，只需 ${need} 胜率，对${vs}你还有约 ${eq}——这一弃放掉了约 ${fmtChips(Math.round(ev))} 筹码的期望。`,
      }
    }
    if (gap < -0.03) {
      return {
        mark: '',
        text: f.pick([`需要 ${need}，对${vs}只有约 ${eq}，赔率不够，放掉没问题。`, `约 ${eq} 的胜率撑不起 ${need} 的价格，弃得对。`], 1),
      }
    }
    return { mark: '', text: `胜率约 ${eq}，和所需的 ${need} 几乎持平，跟或弃都在误差之内。` }
  }

  if (f.kind === 'call') {
    if (icm !== null && f.eq >= f.needed - 0.02 && f.eq < icm - 0.03) {
      return {
        mark: '?!',
        text: `筹码上勉强够（${eq} 对 ${need}），但跟输即出局，ICM 口径需要 ${pctTxt(icm)}——泡沫附近这种跟注亏的是奖金。`,
      }
    }
    if (gap >= 0.12) return { mark: '', text: `对${vs}约有 ${eq}，远高于所需的 ${need}，跟注稳稳正期望。` }
    if (gap >= -0.03) return { mark: '', text: f.pick([`${eq} 对 ${need}，赔率支持跟注。`, `价格合适：需要 ${need}，手里大约 ${eq}。`], 2) }
    const behind = f.stack - call
    if ((f.street === 'flop' || f.street === 'turn') && f.bucket === Bucket.StrongDraw && gap >= -0.12 && behind > call * 3) {
      return { mark: '', text: `直接赔率差一点（${eq} 对 ${need}），但身后还有筹码，听中后能多赢，隐含赔率补得上。` }
    }
    const mark: Mark = gap <= -0.15 && call >= f.stack * 0.3 ? '??' : gap <= -0.06 ? '?' : '?!'
    return {
      mark,
      text: `跟注需要 ${need}，对${vs}只有约 ${eq}，长期看每次这样跟大约亏 ${fmtChips(Math.max(1, Math.round(-ev)))}。`,
    }
  }
  return null
}

// —— 翻前 ——

function preflopNotes(f: Facts): Note[] {
  const { sit, kind, pos, hand, freq } = f
  const top = topTxt(f.pct)
  const premium = f.pct <= 0.03
  const strong = f.pct <= 0.08
  const late = sit.position === 'late' || sit.position === 'button' || sit.position === 'sb'
  const n: Note[] = []

  if (sit.line === 'vsShove') {
    const p = priceNote(f)
    if (p) n.push(p)
    else n.push({ mark: '', text: kind === 'fold' ? `${hand} 面对全下放弃，稳妥。` : `${hand} 跟注全下。` })
    return n
  }

  // 短码 push/fold 域
  const bbFree = sit.position === 'bb' && f.toCall === 0
  if (sit.effBB <= 10 && !(bbFree && kind === 'check') && sit.line !== 'vs3bet') {
    const pushF = f.base.raise
    const depth = bbTxt(sit.effBB)
    if (kind === 'raise') {
      if (!f.allIn && f.added < f.stack * 0.9) {
        n.push({ mark: '?!', text: `只剩 ${depth} 却只加注不全下——被反推时赔率逼着你跟，这个深度直接推才能把弃牌率吃满。` })
      } else if (pushF >= 0.5) {
        n.push({
          mark: '!',
          text: f.pick(
            [`${depth} 的短码，${pos}拿 ${hand} 直接推，教科书式的 push/fold。`, `${hand} 在这个深度就是推牌，弃牌率加上被跟时的胜率，两头都赚。`],
            3,
          ),
        })
      } else if (pushF >= 0.15) {
        n.push({ mark: '', text: `${hand} 在${pos}处于 ${depth} 推牌范围的边缘，推下去可以接受。` })
      } else {
        n.push({
          mark: pushF < 0.03 ? '?' : '?!',
          text: `${hand}（${top}）在${pos}推得太宽了，身后有人醒来跟注时，你常常只剩两三成胜率。`,
        })
      }
    } else if (kind === 'fold') {
      if (pushF >= 0.75) n.push({ mark: '?', text: `只剩 ${depth}，${hand} 在${pos}是该直接推的牌。再等下去，盲注会把你吃到连推都没有弃牌率。` })
      else if (pushF >= 0.35) n.push({ mark: '?!', text: `${depth} 的 ${hand} 在${pos}偏向推牌，弃掉略显保守。` })
      else n.push({ mark: '', text: `${hand} 不在 ${depth} 的推牌范围里，耐心等更好的牌或位置。` })
    } else if (kind === 'call') {
      const p = f.toCall >= sit.effBB * f.bb * 0.3 ? priceNote(f) : null
      n.push(p ?? { mark: '?!', text: `${depth} 的深度还平跟——翻牌后 SPR 极低又没主动权，短码该做的是推或弃。` })
    } else {
      n.push({ mark: '', text: `${hand} 过牌看翻牌。` })
    }
    return n
  }

  switch (sit.line) {
    case 'unopened': {
      if (kind === 'raise') {
        const openBB = f.to / f.bb
        if (f.allIn && sit.effBB > 15) {
          n.push(
            premium
              ? { mark: '?', text: `${hand} 深筹码直接推，把所有会犯错的弱牌都吓跑了——这手牌要的是把底池慢慢做大。` }
              : { mark: '?!', text: `${bbTxt(sit.effBB)} 深度 open 全下，只为赢 1.5bb 盲注：弱牌全弃，只有更好的牌会跟，风险收益很不对称。` },
          )
          break
        }
        if (freq >= 0.5) {
          n.push({
            mark: '',
            text: premium
              ? f.pick([`${hand}，开池没有任何犹豫的理由。`, `拿到 ${hand}，标准加注把底池做大。`], 4)
              : f.pick([`${pos}拿 ${hand}（${top}）开池，在标准开局范围内。`, `${hand} 在${pos}正常开池，挑不出毛病。`], 4),
          })
        } else if (freq >= 0.15) {
          n.push({ mark: '', text: late ? `${hand} 在${pos}属于范围边缘，后位偷盲很合理。` : `${hand} 在${pos}是混合频率的边缘牌，开也说得过去。` })
        } else if (late) {
          n.push({ mark: '!?', text: `${hand} 在${pos}超出常规范围，算是一次偷盲。盲注位防守紧的话能赚，被 3bet 就要果断放弃。` })
        } else {
          n.push({
            mark: freq < 0.04 && f.pct > 0.35 ? '?' : '?!',
            text: `${pos}用 ${hand}（${top}）开池偏松——身后还有一圈人没说话，翻牌后还常常没位置。`,
          })
        }
        if (!f.allIn && openBB > 4.2) {
          n.push({ mark: '?!', text: `开到 ${bbTxt(openBB)} 偏大：同样的弃牌率要多冒风险，而且只拿好牌开大会被读出来。` })
        } else if (!f.allIn && sit.effBB <= 15 && f.added > f.stack * 0.33) {
          n.push({ mark: '?!', text: `这个筹码深度开池已经投入三分之一，被 3bet 只能硬跟——不如直接推。` })
        }
      } else if (kind === 'call') {
        if (sit.position === 'sb' && freq >= 0.2) {
          n.push({ mark: '', text: `小盲补齐，用半个大盲的价格看翻牌，可以。` })
        } else if (premium) {
          n.push({ mark: '!?', text: `拿 ${hand} 平跟设陷阱——有人加注就能再加，但多人底池会稀释 ${hand} 的优势。` })
        } else if (freq < 0.1) {
          n.push({
            mark: '?!',
            text: f.pick(
              [`平跟入池：没主动权、也没有弃牌率，现代打法里基本已经淘汰。${hand} 要么加注要么弃。`, `${pos} limp ${hand}，把主动权白白送人，加注或弃牌都比这个好。`],
              5,
            ),
          })
        } else {
          n.push({ mark: '', text: `${hand} 平跟进池，投机牌靠隐含赔率。` })
        }
      } else if (kind === 'fold') {
        if (freq >= 0.6) {
          n.push({ mark: '', text: f.pick([`${hand} 在${pos}不在开局范围，弃牌。`, `${pos}的 ${hand}，弃得干净。`, `${hand}，没什么可说的，弃掉是纪律。`], 6) })
        } else if (freq >= 0.25) {
          n.push({ mark: '', text: `${hand} 在${pos}是边缘牌，弃掉也说得过去。` })
        } else if (strong) {
          n.push({ mark: '??', text: `弃掉 ${hand}？这是所有起手牌里的${top}，任何位置都该开池。` })
        } else if (late) {
          n.push({ mark: '?', text: `${hand} 在${pos}是标准开局牌——后位不偷盲，会被盲注一点点磨死。` })
        } else {
          n.push({ mark: '?!', text: `${hand} 在${pos}应该开池，这一弃偏紧。` })
        }
      }
      break
    }

    case 'vsLimp': {
      if (kind === 'check') {
        n.push(
          f.base.raise >= 0.6
            ? { mark: '?!', text: `大盲拿 ${hand} 面对平跟，应该加注惩罚 limp——免费让他们看翻牌，浪费了牌力优势。` }
            : { mark: '', text: `大盲免费看翻牌。` },
        )
      } else if (kind === 'raise') {
        if (freq >= 0.3) n.push({ mark: late && freq >= 0.5 ? '!' : '', text: `加注孤立平跟者，拿到主动权${late ? '，翻牌后还有位置' : ''}——这才是对付 limp 的正确方式。` })
        else if (freq >= 0.1) n.push({ mark: '', text: `${hand} 孤立平跟者，边缘但可以。` })
        else n.push({ mark: '?!', text: `${hand} 加注孤立有点勉强，被反加或多人跟进时很难打。` })
      } else if (kind === 'call') {
        if (freq >= 0.3) n.push({ mark: '', text: `跟进多人底池，${hand} 这类牌靠隐含赔率。` })
        else n.push({ mark: '?!', text: `跟着 limp，主动权在别人手里——${hand} 更好的选择是加注孤立或者直接弃。` })
      } else {
        n.push(freq >= 0.4 ? { mark: '', text: `${hand}，不值得跟进，弃。` } : { mark: '?!', text: `面对平跟弃掉 ${hand} 太紧，这是加注孤立的好机会。` })
      }
      break
    }

    case 'vsOpen': {
      const opener = f.villainName
      const loose = f.villain ? f.villain.looseness >= 1.4 : false
      if (kind === 'raise') {
        const ratio = f.to / Math.max(1, f.state.currentBet)
        if (freq >= 0.4) {
          n.push(premium ? { mark: '!', text: `${hand} 价值 3bet，就该趁现在把底池做大。` } : { mark: '', text: `${hand} 在 3bet 范围内，对 ${opener} 施压。` })
        } else if (freq >= 0.1) {
          n.push({ mark: f.pct > 0.1 ? '!?' : '', text: `轻 3bet：${hand} 有阻断和可玩性，适合作为诈唬 3bet 的那部分范围。` })
        } else if (loose) {
          n.push({ mark: '!?', text: `${hand} 3bet 偏轻，但 ${opener} 开池很宽，用 3bet 反压是有道理的。` })
        } else {
          n.push({ mark: '?!', text: `${hand} 3bet 太轻：被 4bet 只能弃，被跟注后翻牌又很难打。` })
        }
        if (!f.allIn && ratio < 2.3) n.push({ mark: '?!', text: `3bet 只加到 ${ratio.toFixed(1)} 倍，给了开池者极好的跟注价格。` })
      } else if (kind === 'call') {
        if (premium && f.base.raise >= 0.6) {
          n.push({ mark: '!?', text: `${hand} 平跟慢打，隐藏了牌力，但也放走了 3bet 做大底池的机会，还让后面的人便宜进池。` })
        } else if (freq >= 0.3) {
          n.push({ mark: '', text: sit.position === 'bb' ? `大盲已经投了 1bb，价格好，${hand} 防守合理。` : `${hand} 跟注 ${opener} 的开池，在范围内。` })
        } else if (freq >= 0.1) {
          n.push({ mark: '', text: `${hand} 跟注偏宽，但还能接受。` })
        } else if (f.base.fold < 0.25) {
          n.push({ mark: '', text: `${hand} 更常见的打法是 3bet，平跟也不算错。` })
        } else if (sit.position === 'sb' || sit.position === 'early') {
          n.push({ mark: '?', text: `${pos}平跟开池：没位置、范围又被夹在中间，最容易亏筹码的打法之一。` })
        } else {
          n.push({ mark: '?!', text: `${hand} 跟注 ${opener} 的开池偏松，翻牌后经常被压制。` })
        }
      } else if (kind === 'fold') {
        if (freq >= 0.5) {
          n.push({ mark: '', text: f.pick([`面对 ${opener} 开池，${hand} 弃掉合理。`, `${hand} 打不过开池范围，弃。`], 7) })
        } else if (strong) {
          n.push({ mark: '?', text: `${hand} 面对开池直接弃，太紧了——这是 3bet 或至少跟注的牌。` })
        } else if (sit.position === 'bb') {
          n.push({ mark: '?!', text: `大盲面对这个尺度只需要很少的胜率，${hand} 应该防守。` })
        } else {
          n.push({ mark: freq < 0.2 ? '?!' : '', text: `${hand} 面对开池弃牌偏紧，但也不算大问题。` })
        }
      }
      break
    }

    case 'vs3bet': {
      if (kind === 'raise') {
        if (premium) n.push({ mark: '!', text: `${hand} 价值 4bet，对方的 3bet 范围里能继续的牌都会付钱。` })
        else if (freq >= 0.1) n.push({ mark: '', text: `${hand} 4bet，在范围内。` })
        else n.push({ mark: '!?', text: `${hand} 4bet 诈唬，胆子很大——需要对手的 3bet 范围里有足够多会放弃的牌。` })
      } else if (kind === 'call') {
        if (premium && f.base.raise >= 0.5) n.push({ mark: '!?', text: `面对 3bet 只跟 ${hand}，慢打。隐蔽，但给了对手翻牌后赶上的机会。` })
        else if (freq >= 0.3) n.push({ mark: '', text: `${hand} 跟注 3bet，范围内。` })
        else if (f.base.fold < 0.25) n.push({ mark: '', text: `${hand} 面对 3bet 更常见的是 4bet，跟注也是可行的选择。` })
        else n.push({ mark: '?!', text: `${hand} 跟 3bet 偏勉强，翻牌后会经常被对手的价值范围压制。` })
      } else if (kind === 'fold') {
        if (freq >= 0.5) n.push({ mark: '', text: `${hand} 面对 3bet 放弃，不跟被压制的牌，合理。` })
        else if (strong) n.push({ mark: '?', text: `${hand} 面对 3bet 直接弃，太怂了，这牌至少要跟。` })
        else n.push({ mark: '?!', text: `${hand} 面对 3bet 弃牌略紧。` })
      }
      break
    }
  }
  return n
}

// —— 翻后 ——

/**
 * 点评用的牌力：公对牌面上"两对"的一对来自牌面时，按手牌实际贡献降级
 * （Q88 上的 44 本质是弱对子，不是两对）。两张手牌都配上牌面时按顶对处理。
 */
function effectiveBucket(c1: number, c2: number, board: readonly number[]): Bucket {
  const b = bucketOf(c1, c2, board)
  if (b !== Bucket.Strong || categoryOf(evaluateCards([c1, c2, ...board])) !== CAT_TWO_PAIR) return b
  const count = new Array<number>(13).fill(0)
  let top = -1
  for (const c of board) {
    count[rankOf(c)]++
    top = Math.max(top, rankOf(c))
  }
  if (!count.some((x) => x >= 2)) return b
  const r1 = rankOf(c1)
  const r2 = rankOf(c2)
  if (r1 !== r2 && count[r1] > 0 && count[r2] > 0) return Bucket.TopPair
  const heroPair = r1 === r2 ? r1 : count[r1] > 0 ? r1 : count[r2] > 0 ? r2 : -1
  if (heroPair < 0) return b
  return heroPair >= top ? Bucket.TopPair : Bucket.WeakPair
}

/** 中文与字母/数字之间补空格（"两对 8 和 4下注" → "两对 8 和 4 下注"） */
function spaceCjk(s: string): string {
  return s.replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9%])([\u4e00-\u9fff])/g, '$1 $2')
}

function handDescOf(f: Facts): string {
  const me = f.state.seats[f.seat]!
  const [c1, c2] = me.holeCards!
  const b = f.bucket!
  if (b >= Bucket.WeakPair) return describeScore(evaluateCards([c1, c2, ...f.state.board]))
  if (b === Bucket.StrongDraw) {
    const suitCount = [0, 0, 0, 0]
    for (const c of [c1, c2, ...f.state.board]) suitCount[suitOf(c)]++
    const flushDraw = suitCount.some((n, s) => n === 4 && (suitOf(c1) === s || suitOf(c2) === s))
    return flushDraw ? '同花听牌' : '两头顺听牌'
  }
  if (b === Bucket.WeakDraw) return f.state.board.length >= 5 ? '高牌' : '卡顺/两张高牌'
  return '空气'
}

function textureDesc(f: Facts): string {
  const t = boardTexture(f.state.board)
  if (t.wetness >= 0.5) return '湿润的牌面'
  if (t.paired) return '公对牌面'
  if (t.wetness <= 0.25) return '干燥的牌面'
  return '这个牌面'
}

function postflopNotes(f: Facts): Note[] {
  const n: Note[] = []
  const b = f.bucket!
  const hd = handDescOf(f)
  const tex = textureDesc(f)
  const me = f.state.seats[f.seat]!
  const vn = f.villainName
  const bluffy = f.villain ? f.villain.bluffFreq >= 0.18 : false
  const honest = f.villain ? f.villain.bluffFreq <= 0.07 : false
  const station = f.villain ? f.villain.callDown >= 0.6 : false
  const river = f.street === 'river'
  const eq = f.eq

  if (f.kind === 'fold' && f.legal.canCheck) {
    return [{ mark: '??', text: '明明可以免费过牌却弃掉了——任何牌都有免费看下一张的价值，这是纯粹的失误。' }]
  }

  if (f.toCall > 0) {
    if (f.kind === 'fold') {
      if (b >= Bucket.Strong && eq !== null && eq < f.needed - 0.08) {
        n.push({ mark: '!!', text: `拿着${hd}放下！对手这条线的范围里你确实已经落后（约 ${pctTxt(eq)}），能读到这一步的人不多。` })
      } else {
        const p = priceNote(f)
        if (p) n.push(p)
        if (p && p.mark === '' && b >= Bucket.TopPair && eq !== null && eq < f.needed) {
          n[n.length - 1] = { mark: '!', text: `${hd}也肯放下——${p.text}` }
        }
      }
      if ((b === Bucket.WeakPair || b === Bucket.TopPair) && bluffy) n.push({ mark: '', text: `不过 ${vn} 诈唬频率很高，这类牌对他可以多抓一点。` })
    } else if (f.kind === 'call') {
      const p = priceNote(f)
      if (river && b <= Bucket.WeakPair && eq !== null && eq >= f.needed + 0.1) {
        n.push({ mark: '!', text: `河牌用${hd}抓诈，${vn}这条线里诈唬占比足够高，漂亮的跟注。` })
      } else if (p) {
        n.push(p)
      }
      if (b >= Bucket.Strong && f.wet >= 0.5 && !river && eq !== null && eq > f.needed + 0.15) {
        n.push({ mark: '!?', text: `${tex}上拿${hd}只跟不加，给了听牌便宜的价格——慢打是要付保护费的。` })
      }
      if (honest && b <= Bucket.WeakPair && p && MARK_SCORE[p.mark] < 0) n.push({ mark: '', text: `${vn} 很少诈唬，对他抓诈的前提本身就不成立。` })
    } else if (f.kind === 'raise') {
      const label = me.actedAt === 0 ? '过牌加注' : '加注'
      const be = bluffBreakeven(f.pot, f.added)
      if (b >= Bucket.Strong || (eq ?? 0) >= 0.7) {
        n.push({
          mark: '!',
          text: f.wet >= 0.5 ? `${hd}在${tex}上${label}，既收价值又不给听牌便宜价格。` : `${hd}${label}，正是把底池做大的时候。`,
        })
      } else if (b === Bucket.StrongDraw && !river) {
        n.push({
          mark: f.nOpp > 1 ? '!?' : '!',
          text: `${hd}半诈唬${label}：对手弃牌直接拿下，被跟注还有大量补牌，两条路都能赢。`,
        })
      } else if (b <= Bucket.WeakDraw) {
        if (f.nOpp > 1) n.push({ mark: '?!', text: `多人底池里用${hd}诈唬${label}，至少有一个人有牌的概率太高。` })
        else if (station) n.push({ mark: '?', text: `对 ${vn} 这种跟注站诈唬${label}，他的弃牌率很难达到 ${pctTxt(be)}。` })
        else n.push({ mark: '!?', text: `纯诈唬${label}，需要对手 ${pctTxt(be)} 以上的弃牌率才回本${river ? '——河牌加注诈唬是难度最高的动作之一' : ''}。` })
      } else if (f.sit.spr < 2.5) {
        n.push({ mark: '', text: `低 SPR 下${hd}直接打进去，没问题。` })
      } else {
        n.push({ mark: '?!', text: `${hd}${label}：更差的牌会弃，只有更好的牌会继续——把有摊牌价值的牌打成了诈唬，跟注控池更好。` })
      }
    }
    return n
  }

  // 无人下注
  if (f.kind === 'check') {
    if (river) {
      if (eq !== null && eq >= 0.75 && f.legal.canRaise) {
        n.push({ mark: '?', text: `河牌拿着${hd}（约 ${pctTxt(eq)}）过牌，错过了价值下注——对手更差的牌本来会付钱。` })
      } else if (b >= Bucket.TopPair) {
        n.push({ mark: '', text: `${hd}过牌摊牌，控制底池。` })
      } else if (b <= Bucket.WeakDraw && f.sit.barreling && f.nOpp === 1) {
        n.push({ mark: '', text: `前面开过火，河牌放弃第三枪，让对手自己摊牌——也是一种选择。` })
      } else {
        n.push({ mark: '', text: f.pick([`${hd}，过牌看看能不能摊牌赢。`, `没什么可以下注的价值，过牌。`], 8) })
      }
    } else if (b >= Bucket.Strong) {
      n.push(
        f.wet >= 0.5
          ? { mark: '?!', text: `${tex}上${hd}过牌，给了听牌一张免费的牌——湿面的强牌要下注保护。` }
          : { mark: '!?', text: `${tex}拿${hd}慢打，对手很难有牌，给他一张牌去击中或诈唬，合理的陷阱。` },
      )
    } else if (f.sit.isAggressor && f.street === 'flop' && f.nOpp === 1 && b <= Bucket.WeakDraw) {
      n.push({
        mark: '',
        text: `作为翻前进攻者放弃了持续下注。${f.wet < 0.3 ? '这种干燥面其实是 c-bet 最好用的牌面，可以多打一些。' : '湿面没牌就收手，合理。'}`,
      })
    } else if (b === Bucket.StrongDraw) {
      n.push({ mark: '', text: `${hd}过牌免费看牌也行，不过主动半诈唬能多一种赢法。` })
    } else {
      n.push({ mark: '', text: f.pick([`${hd}，过牌。`, `${hd}，过牌控池。`], 9) })
    }
    return n
  }

  if (f.kind === 'bet') {
    const frac = f.added / Math.max(1, f.pot)
    const sz = sizeTxt(frac)
    const be = bluffBreakeven(f.pot, f.added)
    const ha = f.state.handAggressor
    const donk = !f.sit.isAggressor && ha >= 0 && ha !== f.seat && !f.state.seats[ha]?.folded && !f.sit.inPosition

    if (b >= Bucket.TopPair || (eq ?? 0) >= 0.6) {
      if (frac < 0.3 && f.wet >= 0.5 && !river && b >= Bucket.TopPair) {
        n.push({ mark: '?!', text: `${tex}上价值下注只下${sz}，听牌拿到了很好的价格——湿面应该下大一点。` })
      } else if (station && f.nOpp === 1) {
        n.push({ mark: '!', text: `${hd}对 ${vn} 下注${sz}——对跟注站就该这样不停地价值下注。` })
      } else {
        n.push({
          mark: b >= Bucket.Strong ? '!' : '',
          text: f.pick([`${hd}下注${sz}收价值。`, `${hd}主动下注${sz}，${f.wet >= 0.5 ? '湿面要收价值也要保护' : '让更差的牌付钱'}。`], 10),
        })
      }
    } else if (b === Bucket.StrongDraw && !river) {
      n.push({ mark: f.nOpp === 1 ? '!' : '', text: `${hd}半诈唬下注${sz}，弃牌率加补牌两条路。` })
    } else if (b === Bucket.WeakPair) {
      n.push(river ? { mark: '?!', text: `河牌用${hd}下注是很薄的价值：更差的牌大多不会跟，跟的多半比你好。` } : { mark: '', text: `${hd}下注${sz}，偏薄的价值兼保护。` })
    } else if (f.nOpp > 1) {
      n.push({ mark: '?!', text: `${f.nOpp} 个对手的底池里空气下注，至少一个人有牌的概率很高——多人底池少诈唬。` })
    } else if (station) {
      n.push({ mark: '?', text: `对 ${vn} 这种跟注站诈唬，他的弃牌率很难到 ${pctTxt(be)}，最不该诈唬的对象。` })
    } else if (f.street === 'flop' && f.sit.isAggressor) {
      n.push(
        f.wet < 0.4
          ? { mark: '!', text: `${tex}持续下注${sz}，对手大多数时候没击中，用小成本拿走底池。` }
          : { mark: '', text: `湿面空气 c-bet，对手击中或听牌的比例不低，频率上要克制。` },
      )
    } else if (f.sit.barreling) {
      n.push({
        mark: '!?',
        text: river ? `第三枪！需要对手 ${pctTxt(be)} 的弃牌率——前两条街讲的故事够连贯，这一枪才可信。` : `连续开火${sz}，需要对手 ${pctTxt(be)} 以上的弃牌率，持续施压。`,
      })
    } else {
      n.push({ mark: '!?', text: `${hd}下注${sz}作诈唬，需要对手弃牌 ${pctTxt(be)} 以上才回本。` })
    }

    if (frac > 1.25 && !f.allIn) n.push({ mark: '', text: `超池下注，范围非常极化——要么坚果要么空气。` })
    if (donk) n.push({ mark: '', text: `（没有主动权却抢先领打，现代打法里频率很低。）` })
    if (f.allIn && f.sit.spr > 3 && b < Bucket.Strong && b !== Bucket.StrongDraw) {
      n.push({ mark: '?!', text: `SPR 还有 ${f.sit.spr.toFixed(1)} 就全下，只会被更好的牌跟注，风险过大。` })
    }
  }
  return n
}

function combine(notes: Note[]): { mark: Mark; text: string } {
  if (notes.length === 0) return { mark: '', text: '标准动作。' }
  const scores = notes.map((x) => MARK_SCORE[x.mark])
  const minS = Math.min(...scores)
  const maxS = Math.max(...scores)
  const target = minS < 0 ? minS : maxS
  const lead = notes.findIndex((x) => MARK_SCORE[x.mark] === target)
  const ordered = [notes[lead], ...notes.filter((_, i) => i !== lead)].slice(0, 3)
  return { mark: notes[lead].mark, text: ordered.map((x) => x.text).join('') }
}

/** 对英雄的一次行动生成观察员点评；无法评价（无手牌/非行动阶段）时返回 null */
export function commentOnAction(ctx: CommentContext): HandComment | null {
  const f = buildFacts(ctx)
  if (!f) return null
  const notes = f.street === 'preflop' ? preflopNotes(f) : postflopNotes(f)
  const { mark, text } = combine(notes)
  return { eventIdx: ctx.eventIdx, handNo: f.state.handNo, street: f.street, mark, head: headOf(f), text: spaceCjk(text) }
}
