import { describe, expect, it } from 'vitest'
import { buildPots, splitPot } from '../src/core/pots'
import type { SeatState } from '../src/core/types'

function mkSeat(seat: number, totalCommitted: number, folded = false): SeatState {
  return {
    seat,
    playerId: `p${seat}`,
    startStack: 1000,
    stack: 0,
    committed: 0,
    totalCommitted,
    holeCards: null,
    folded,
    allIn: false,
    actedAt: -1,
  }
}

describe('side pots', () => {
  it('三层边池：100/300/1000 全下', () => {
    const seats = [mkSeat(0, 100), mkSeat(1, 300), mkSeat(2, 1000)]
    const pots = buildPots(seats)
    expect(pots).toHaveLength(3)
    expect(pots[0]).toEqual({ amount: 300, eligible: [0, 1, 2] })
    expect(pots[1]).toEqual({ amount: 400, eligible: [1, 2] })
    // 最外层只有 seat2 有资格 = 未被跟注部分退还
    expect(pots[2]).toEqual({ amount: 700, eligible: [2] })
  })

  it('弃牌者的钱落入对应层', () => {
    const seats = [mkSeat(0, 100), mkSeat(1, 300), mkSeat(2, 1000), mkSeat(3, 150, true)]
    const pots = buildPots(seats)
    expect(pots[0]).toEqual({ amount: 400, eligible: [0, 1, 2] }) // 100×3 + 弃牌者 100
    expect(pots[1]).toEqual({ amount: 450, eligible: [1, 2] }) // 200×2 + 弃牌者 50
    expect(pots[2]).toEqual({ amount: 700, eligible: [2] })
  })

  it('弃牌者投入超过所有未弃牌者时不丢筹码（防御性保底）', () => {
    // 真实流程不会出现：弃牌者曾投入 500，最大未弃牌投入 300 → 超出部分并入最外层池
    const seats = [mkSeat(0, 300), mkSeat(1, 200), mkSeat(2, 500, true)]
    const pots = buildPots(seats)
    expect(pots[0]).toEqual({ amount: 600, eligible: [0, 1] })
    expect(pots[1]).toEqual({ amount: 400, eligible: [0] })
    const total = pots.reduce((s, p) => s + p.amount, 0)
    expect(total).toBe(1000)
  })

  it('平分与奇数筹码：按钮左起顺序多得 1', () => {
    expect(splitPot(45, [3, 7])).toEqual(new Map([[3, 23], [7, 22]]))
    expect(splitPot(100, [1, 2, 5])).toEqual(new Map([[1, 34], [2, 33], [5, 33]]))
    expect(splitPot(101, [1, 2, 5])).toEqual(new Map([[1, 34], [2, 34], [5, 33]]))
  })
})
