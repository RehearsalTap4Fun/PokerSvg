import EquityWorker from '../workers/equity.worker?worker&inline'
import type { EquityWorkerRequest, EquityWorkerResponse } from '../workers/equity.worker'
import { equityMC, type EquityInput } from '../analysis/equity'
import { mulberry32 } from '../core/rng'
import type { Range } from '../analysis/range'

// HUD 的胜率计算通道：优先 Web Worker（?worker&inline，兼容单文件构建），
// 构造失败时降级为主线程分片计算（保证 file:// 极端环境可用）。

export interface EquityUpdate {
  equity: number
  tie: number
  trials: number
  exact: boolean
  done: boolean
}

export class HudEquity {
  private worker: Worker | null = null
  private id = 0
  private listener: ((u: EquityUpdate) => void) | null = null
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    try {
      this.worker = new EquityWorker()
      this.worker.onmessage = (e: MessageEvent<EquityWorkerResponse>) => {
        if (e.data.id !== this.id) return
        this.listener?.(e.data)
      }
    } catch {
      this.worker = null
    }
  }

  onUpdate(fn: (u: EquityUpdate) => void): void {
    this.listener = fn
  }

  /** 触发一次新的胜率计算（自动取消进行中的旧任务） */
  request(hero: [number, number], board: readonly number[], opponents: Range[], maxTrials = 400_000): void {
    this.id++
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
    if (opponents.length === 0) return
    if (this.worker) {
      const req: EquityWorkerRequest = {
        id: this.id,
        hero,
        board: [...board],
        opponents: opponents.map((r) => Array.from(r)),
        maxTrials,
      }
      this.worker.postMessage(req)
    } else {
      this.runFallback(this.id, { hero, board: [...board], opponents: opponents.map((r) => Float64Array.from(r)) }, maxTrials)
    }
  }

  cancel(): void {
    this.id++
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
  }

  private runFallback(id: number, input: EquityInput, maxTrials: number): void {
    const rng = mulberry32(0x517a ^ id)
    let share = 0
    let tie = 0
    let trials = 0
    const step = () => {
      if (id !== this.id) return
      const r = equityMC(input, 8000, rng)
      share += r.equity * r.trials
      tie += r.tie * r.trials
      trials += r.trials
      const done = trials >= maxTrials || r.trials === 0
      this.listener?.({
        equity: trials > 0 ? share / trials : 0,
        tie: trials > 0 ? tie / trials : 0,
        trials,
        exact: false,
        done,
      })
      if (!done) this.fallbackTimer = setTimeout(step, 16)
    }
    step()
  }

  dispose(): void {
    this.cancel()
    this.worker?.terminate()
  }
}
