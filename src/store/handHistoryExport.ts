import type { TournamentState } from '../core/types'
import { cardToStr } from '../core/cards'
import type { HandRecord } from './gameController'

// 手牌历史导出：PokerStars 风格文本（外部复盘/HUD 工具普遍能解析的格式）。
// 默认只写英雄底牌与摊牌亮出的牌（真实牌桌可得信息）；godView=true 则写出所有底牌。

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']

function cards(list: readonly number[]): string {
  return `[${list.map(cardToStr).join(' ')}]`
}

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export interface ExportOptions {
  godView?: boolean
  /** 首手时间（每手 +1 分钟），默认当前时间 */
  startTime?: Date
  tableName?: string
}

export function exportHand(rec: HandRecord, ts: TournamentState, humanSeat: number, opts: ExportOptions = {}, when = new Date()): string {
  const ev = rec.events
  const start = ev[0]
  if (!start || start.t !== 'handStart') return ''
  const nameOf = (seat: number): string => ts.players.find((p) => p.seat === seat)?.name ?? `Seat${seat + 1}`
  const levelIdx = ts.config.levels.findIndex((l) => l.sb === start.level.sb && l.bb === start.level.bb && l.ante === start.level.ante)
  const lines: string[] = []
  const buyIn = Math.round(ts.config.payouts.reduce((a, b) => a + b, 0) / ts.config.players.length)
  lines.push(
    `PokerStars Hand #${ts.config.seed}${String(rec.handNo).padStart(4, '0')}: Tournament #${ts.config.seed}, ${buyIn}+0 Hold'em No Limit - Level ${ROMAN[Math.max(0, levelIdx)] ?? levelIdx + 1} (${start.level.sb}/${start.level.bb}) - ${fmtDate(when)}`,
  )
  lines.push(`Table '${opts.tableName ?? `SNG ${ts.config.seed}`} 1' ${ts.config.players.length}-max Seat #${start.buttonSeat + 1} is the button`)
  for (const s of start.seats) lines.push(`Seat ${s.seat + 1}: ${nameOf(s.seat)} (${s.stack} in chips)`)

  const hole = new Map<number, [number, number]>()
  const board: number[] = []
  let currentBet = start.level.bb
  let street: 'preflop' | 'flop' | 'turn' | 'river' = 'preflop'
  const foldedOn = new Map<number, string>()
  const collected = new Map<number, number>()
  const shown = new Map<number, string>()
  let totalPot = 0
  let holeSectionWritten = false
  const committed = new Map<number, number>()

  for (let i = 1; i < ev.length; i++) {
    const e = ev[i]
    switch (e.t) {
      case 'postAnte':
        lines.push(`${nameOf(e.seat)}: posts the ante ${e.amount}${e.allIn ? ' and is all-in' : ''}`)
        totalPot += e.amount
        break
      case 'postSB':
        lines.push(`${nameOf(e.seat)}: posts small blind ${e.amount}${e.allIn ? ' and is all-in' : ''}`)
        committed.set(e.seat, e.amount)
        totalPot += e.amount
        break
      case 'postBB':
        lines.push(`${nameOf(e.seat)}: posts big blind ${e.amount}${e.allIn ? ' and is all-in' : ''}`)
        committed.set(e.seat, e.amount)
        totalPot += e.amount
        break
      case 'dealHole':
        hole.set(e.seat, e.cards)
        if (!holeSectionWritten) {
          lines.push('*** HOLE CARDS ***')
          holeSectionWritten = true
        }
        if (e.seat === humanSeat || opts.godView) lines.push(`Dealt to ${nameOf(e.seat)} ${cards(e.cards)}`)
        break
      case 'action': {
        const name = nameOf(e.seat)
        const a = e.action
        const allIn = e.allIn ? ' and is all-in' : ''
        if (a.type === 'fold') {
          lines.push(`${name}: folds`)
          foldedOn.set(e.seat, street)
        } else if (a.type === 'check') lines.push(`${name}: checks`)
        else if (a.type === 'call') lines.push(`${name}: calls ${e.paid}${allIn}`)
        else if (a.type === 'bet') {
          lines.push(`${name}: bets ${a.to}${allIn}`)
          currentBet = a.to
        } else {
          lines.push(`${name}: raises ${a.to - currentBet} to ${a.to}${allIn}`)
          currentBet = a.to
        }
        committed.set(e.seat, (committed.get(e.seat) ?? 0) + e.paid)
        totalPot += e.paid
        break
      }
      case 'street': {
        street = e.street === 'flop' || e.street === 'turn' || e.street === 'river' ? e.street : street
        const before = board.slice()
        board.push(...e.cards)
        if (e.street === 'flop') lines.push(`*** FLOP *** ${cards(board)}`)
        else if (e.street === 'turn') lines.push(`*** TURN *** ${cards(before)} ${cards(e.cards)}`)
        else if (e.street === 'river') lines.push(`*** RIVER *** ${cards(before)} ${cards(e.cards)}`)
        currentBet = 0
        committed.clear()
        break
      }
      case 'showdown': {
        if (!lines.includes('*** SHOW DOWN ***')) lines.push('*** SHOW DOWN ***')
        if (e.reveal) {
          lines.push(`${nameOf(e.seat)}: shows ${cards(e.cards)} (${e.desc})`)
          shown.set(e.seat, `showed ${cards(e.cards)}`)
        } else {
          lines.push(`${nameOf(e.seat)}: mucks hand`)
          shown.set(e.seat, opts.godView ? `mucked ${cards(e.cards)}` : 'mucked')
        }
        break
      }
      case 'potAward': {
        if (e.reason === 'uncalled') {
          lines.push(`Uncalled bet (${e.amount}) returned to ${nameOf(e.seat)}`)
          totalPot -= e.amount
        } else {
          const potName = e.potIndex === 0 ? 'pot' : `side pot-${e.potIndex}`
          lines.push(`${nameOf(e.seat)} collected ${e.amount} from ${potName}`)
          collected.set(e.seat, (collected.get(e.seat) ?? 0) + e.amount)
        }
        break
      }
      default:
        break
    }
  }

  lines.push('*** SUMMARY ***')
  lines.push(`Total pot ${totalPot} | Rake 0`)
  if (board.length > 0) lines.push(`Board ${cards(board)}`)
  const streetName: Record<string, string> = { preflop: 'before Flop', flop: 'on the Flop', turn: 'on the Turn', river: 'on the River' }
  for (const s of start.seats) {
    const name = nameOf(s.seat)
    const tag = s.seat === start.buttonSeat ? ' (button)' : s.seat === start.sbSeat ? ' (small blind)' : s.seat === start.bbSeat ? ' (big blind)' : ''
    const won = collected.get(s.seat)
    let text: string
    if (foldedOn.has(s.seat)) {
      text = `folded ${streetName[foldedOn.get(s.seat)!]}`
    } else if (shown.has(s.seat)) {
      text = `${shown.get(s.seat)}${won ? ` and won (${won})` : ' and lost'}`
    } else if (won) {
      text = `collected (${won})`
    } else {
      text = 'folded'
    }
    if (opts.godView && hole.has(s.seat) && !shown.has(s.seat)) text += ` ${cards(hole.get(s.seat)!)}`
    lines.push(`Seat ${s.seat + 1}: ${name}${tag} ${text}`)
  }
  return lines.join('\n')
}

/** 整场的手牌历史（每手空两行分隔） */
export function exportHandHistory(history: readonly HandRecord[], ts: TournamentState, humanSeat: number, opts: ExportOptions = {}): string {
  const base = opts.startTime ?? new Date()
  return history.map((rec, i) => exportHand(rec, ts, humanSeat, opts, new Date(base.getTime() + i * 60_000))).join('\n\n\n') + '\n'
}
