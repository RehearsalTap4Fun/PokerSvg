import { useState } from 'react'
import type { SaveData } from '../store/storage'
import { rosterFor, type RosterKind } from '../data/aiNames'
import { STYLES } from '../ai/styles'

export interface LobbyProps {
  save: SaveData
  onStart: (roster: RosterKind) => void
  onResume: () => void
  onAbandon: (roster: RosterKind) => void
  onReplay: (archiveIdx: number | 'ongoing') => void
}

export function Lobby({ save, onStart, onResume, onAbandon, onReplay }: LobbyProps) {
  const s = save.stats
  const [roster, setRoster] = useState<RosterKind>('legend')
  const seats = rosterFor(roster)

  return (
    <div className="lobby">
      <h1>德州扑克 SNG 锦标赛</h1>
      <p className="lobby-sub">9 人单桌 · 买入 100 · 前三名分奖 450/270/180 · 内置实时胜率 / 对手范围 / EV 分析</p>

      <div className="lobby-actions">
        {save.ongoing ? (
          <>
            <button className="btn btn-primary btn-big" onClick={onResume}>
              继续上一场（第 {save.ongoing.ts.handNo + 1} 手）
            </button>
            <button className="btn btn-big" onClick={() => onAbandon(roster)}>
              放弃并新开一场
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-big" onClick={() => onStart(roster)}>
            开始比赛
          </button>
        )}
      </div>

      <div className="lobby-grid">
        <div className="lobby-card lobby-card-wide">
          <h3>对手阵容</h3>
          <div className="roster-tabs">
            <button className={roster === 'legend' ? 'active' : ''} onClick={() => setRoster('legend')}>
              🏆 传奇桌
            </button>
            <button className={roster === 'classic' ? 'active' : ''} onClick={() => setRoster('classic')}>
              🎲 风格桌
            </button>
          </div>
          <div className="roster">
            {seats.map((a) => {
              const st = STYLES[a.style]
              return (
                <div key={a.id} className="roster-item" title={st.desc}>
                  <span className="roster-name">
                    {st.emoji} {a.name}
                    <span className="top-dim">（{st.name}）</span>
                  </span>
                  <span className="roster-desc">{st.desc}</span>
                </div>
              )
            })}
          </div>
          {roster === 'legend' ? <div className="roster-note">以公开打法印象参数化的致敬版 AI；范围推断面板能直接读出每个人的倾向差异</div> : null}
        </div>

        <div className="lobby-card">
          <h3>战绩</h3>
          <div className="stat-row">
            <span>参赛</span>
            <b>{s.played}</b>
          </div>
          <div className="stat-row">
            <span>冠军</span>
            <b>{s.wins}</b>
          </div>
          <div className="stat-row">
            <span>进入钱圈</span>
            <b>{s.cashes}</b>
          </div>
          <div className="stat-row">
            <span>总盈亏</span>
            <b className={s.totalPrize - s.totalBuyin >= 0 ? 'delta-pos' : 'delta-neg'}>
              {s.totalPrize - s.totalBuyin >= 0 ? '+' : ''}
              {s.totalPrize - s.totalBuyin}
            </b>
          </div>
        </div>

        <div className="lobby-card">
          <h3>复盘</h3>
          {save.ongoing && save.ongoing.history.length > 0 ? (
            <button className="btn replay-link" onClick={() => onReplay('ongoing')}>
              进行中的比赛（{save.ongoing.history.length} 手）
            </button>
          ) : null}
          {save.archive.length === 0 && !(save.ongoing && save.ongoing.history.length > 0) ? (
            <div className="top-dim">完成比赛后可在此逐街回放每一手</div>
          ) : (
            [...save.archive].reverse().map((a, ri) => {
              const idx = save.archive.length - 1 - ri
              const me = a.ts.players.find((p) => p.style === 'human')
              return (
                <button key={a.finishedAt} className="btn replay-link" onClick={() => onReplay(idx)}>
                  {new Date(a.finishedAt).toLocaleString('zh-CN')} · 第 {me?.rank} 名 · {a.history.length} 手
                </button>
              )
            })
          )}
        </div>

        <div className="lobby-card">
          <h3>规则</h3>
          <ul className="rules">
            <li>9 人起始各 1500 筹码，盲注每 9 手升一级（后期含 ante）</li>
            <li>完整锦标赛规则：边池、不完整加注、dead button、heads-up 规则</li>
            <li>辅助面板：实时胜率（蒙特卡洛/精确枚举）、对手范围贝叶斯推断、底池赔率与 EV</li>
            <li>快捷键：F 弃牌 / C 过牌·跟注 / R 加注 / A 全下</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
