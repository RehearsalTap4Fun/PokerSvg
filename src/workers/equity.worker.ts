import { equityExact, equityMC, estimateExactCount, EXACT_LIMIT, type EquityInput } from '../analysis/equity'
import { mulberry32 } from '../core/rng'

// 胜率计算 Worker：generation（id 递增）取消旧任务；蒙特卡洛分批跑并增量上报，
// 批间用 setTimeout(0) 让出事件循环以便接收取消/新请求。

export interface EquityWorkerRequest {
  id: number
  hero: [number, number]
  board: number[]
  /** 每个对手的 1326 权重（普通数组，结构化克隆） */
  opponents: number[][]
  maxTrials: number
}

export interface EquityWorkerResponse {
  id: number
  equity: number
  tie: number
  trials: number
  exact: boolean
  done: boolean
}

let latestId = 0

const BATCH = 20_000

self.onmessage = (e: MessageEvent<EquityWorkerRequest>) => {
  const req = e.data
  if (req.id <= latestId) return
  latestId = req.id
  const input: EquityInput = {
    hero: req.hero,
    board: req.board,
    opponents: req.opponents.map((a) => Float64Array.from(a)),
  }

  if (estimateExactCount(input, EXACT_LIMIT) <= EXACT_LIMIT) {
    const r = equityExact(input)
    const resp: EquityWorkerResponse = { id: req.id, equity: r.equity, tie: r.tie, trials: r.trials, exact: true, done: true }
    self.postMessage(resp)
    return
  }

  const rng = mulberry32(0x517a ^ req.id)
  let share = 0
  let tie = 0
  let trials = 0

  const runBatch = () => {
    if (req.id !== latestId) return // 已被更新的请求取代
    const r = equityMC(input, BATCH, rng)
    share += r.equity * r.trials
    tie += r.tie * r.trials
    trials += r.trials
    const done = trials >= req.maxTrials || r.trials === 0
    const resp: EquityWorkerResponse = {
      id: req.id,
      equity: trials > 0 ? share / trials : 0,
      tie: trials > 0 ? tie / trials : 0,
      trials,
      exact: false,
      done,
    }
    self.postMessage(resp)
    if (!done) setTimeout(runBatch, 0)
  }
  runBatch()
}
