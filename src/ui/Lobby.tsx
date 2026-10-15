import type { Prefs, SaveData } from '../store/storage'
import { rosterFor } from '../data/aiNames'
import { STYLES } from '../ai/styles'
import { AvatarChip } from './Avatar'
import { BUY_IN, STRUCTURES, TABLE_SIZES, payoutsFor, type StructureKind, type TableSize } from '../data/blindSchedule'

export interface LobbyProps {
  save: SaveData
  prefs: Prefs
  onPrefs: (p: Prefs) => void
  onStart: () => void
  onResume: () => void
  onAbandon: () => void
  onReplay: (archiveIdx: number | 'ongoing') => void
}

const SIZES: TableSize[] = [9, 6, 2]
const STRUCTS: StructureKind[] = ['standard', 'turbo', 'deep']

export function Lobby({ save, prefs, onPrefs, onStart, onResume, onAbandon, onReplay }: LobbyProps) {
  const s = save.stats
  const seats = rosterFor(prefs.roster).slice(0, prefs.size - 1)
  const payouts = payoutsFor(prefs.size)
  const st = STRUCTURES[prefs.structure]

  return (
    <div className="lobby">
      <h1>德州扑克 SNG 锦标赛</h1>
      <p className="lobby-sub">
        {TABLE_SIZES[prefs.size].name}单桌 · 买入 {BUY_IN} · {payouts.length > 1 ? `前${payouts.length === 3 ? '三' : '两'}名分奖 ${payouts.join('/')}` : `赢者全拿 ${payouts[0]}`} · {st.desc} · 内置实时胜率 / 对手范围 / EV / ICM 分析
      </p>

      <div className="lobby-actions">
        {save.ongoing ? (
          <>
            <button className="btn btn-primary btn-big" onClick={onResume}>
              继续上一场（第 {save.ongoing.ts.handNo + 1} 手）
            </button>
            <button className="btn btn-big" onClick={onAbandon}>
              放弃并新开一场
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-big" onClick={onStart}>
            开始比赛
          </button>
        )}
      </div>

      <div className="lobby-grid">
        <div className="lobby-card lobby-card-wide">
          <h3>赛制</h3>
          <div className="cfg-row">
            <span className="cfg-label">人数</span>
            <div className="roster-tabs">
              {SIZES.map((n) => (
                <button key={n} className={prefs.size === n ? 'active' : ''} title={TABLE_SIZES[n].desc} onClick={() => onPrefs({ ...prefs, size: n })}>
                  {TABLE_SIZES[n].name}
                </button>
              ))}
            </div>
            <span className="cfg-desc">{TABLE_SIZES[prefs.size].desc}</span>
          </div>
          <div className="cfg-row">
            <span className="cfg-label">结构</span>
            <div className="roster-tabs">
              {STRUCTS.map((k) => (
                <button key={k} className={prefs.structure === k ? 'active' : ''} title={STRUCTURES[k].desc} onClick={() => onPrefs({ ...prefs, structure: k })}>
                  {STRUCTURES[k].name}
                </button>
              ))}
            </div>
            <span className="cfg-desc">{st.desc}</span>
          </div>
          <div className="cfg-row">
            <span className="cfg-label">推断</span>
            <div className="roster-tabs">
              <button className={!prefs.honest ? 'active' : ''} onClick={() => onPrefs({ ...prefs, honest: false })}>
                上帝视角
              </button>
              <button className={prefs.honest ? 'active' : ''} onClick={() => onPrefs({ ...prefs, honest: true })}>
                诚实模式
              </button>
            </div>
            <span className="cfg-desc">
              {prefs.honest ? '范围推断只用你在牌桌上能观察到的行为统计，不借用 AI 的真实策略——更接近真实对局的训练' : '范围推断借用每个 AI 的真实策略函数反推，是最准的"上帝视角"辅助'}
            </span>
          </div>
        </div>

        <div className="lobby-card lobby-card-wide">
          <h3>对手阵容</h3>
          <div className="roster-tabs">
            <button className={prefs.roster === 'legend' ? 'active' : ''} onClick={() => onPrefs({ ...prefs, roster: 'legend' })}>
              🏆 传奇桌
            </button>
            <button className={prefs.roster === 'classic' ? 'active' : ''} onClick={() => onPrefs({ ...prefs, roster: 'classic' })}>
              🎲 风格桌
            </button>
          </div>
          <div className="roster">
            {seats.map((a) => {
              const stl = STYLES[a.style]
              return (
                <div key={a.id} className="roster-item" title={stl.desc}>
                  <AvatarChip playerId={a.id} style={a.style} />
                  <span className="roster-name">
                    {a.name}
                    <span className="top-dim">（{stl.name}）</span>
                  </span>
                  <span className="roster-desc">{stl.desc}</span>
                </div>
              )
            })}
          </div>
          {prefs.roster === 'legend' ? <div className="roster-note">以公开打法印象参数化的致敬版 AI；AI 会按你的实际打法调整应对，范围推断面板能直接读出每个人的倾向差异</div> : null}
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
            <div className="top-dim">完成比赛后可在此逐街回放每一手、查看赛后分析、导出手牌历史</div>
          ) : (
            [...save.archive].reverse().map((a, ri) => {
              const idx = save.archive.length - 1 - ri
              const me = a.ts.players.find((p) => p.style === 'human')
              return (
                <button key={a.finishedAt} className="btn replay-link" onClick={() => onReplay(idx)}>
                  {new Date(a.finishedAt).toLocaleString('zh-CN')} · {a.ts.players.length} 人 · 第 {me?.rank} 名 · {a.history.length} 手
                </button>
              )
            })
          )}
        </div>

        <div className="lobby-card">
          <h3>规则</h3>
          <ul className="rules">
            <li>
              {TABLE_SIZES[prefs.size].name}起始各 {st.startingStack} 筹码，盲注每 {st.handsPerLevel} 手升一级（后期含 ante）
            </li>
            <li>完整锦标赛规则：边池、不完整加注、dead button、heads-up 规则</li>
            <li>辅助面板：实时胜率（蒙特卡洛/精确枚举）、对手范围贝叶斯推断、底池赔率与 EV、ICM、行为统计</li>
            <li>快捷键：F 弃牌 / C 过牌·跟注 / R 加注 / A 全下</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
