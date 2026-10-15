import type { TournamentPlayer } from '../core/types'
import type { Postmortem } from '../analysis/postmortem'
import { AvatarChip } from './Avatar'
import { PostmortemView } from './PostmortemView'

export function ResultModal({
  players,
  humanSeat,
  postmortem,
  onClose,
}: {
  players: readonly TournamentPlayer[]
  humanSeat: number
  postmortem: Postmortem | null
  onClose: () => void
}) {
  const sorted = [...players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
  const me = players.find((p) => p.seat === humanSeat)
  return (
    <div className="modal-mask">
      <div className="modal result-modal">
        <h2>比赛结束</h2>
        <div className="result-hero">
          {me?.rank === 1 ? '🏆 冠军！' : me?.rank !== null && (me?.rank ?? 99) <= 3 ? `🎉 第 ${me?.rank} 名，进入钱圈！` : `第 ${me?.rank} 名`}
          {me && me.prize > 0 ? <span className="prize">奖金 {me.prize}</span> : null}
        </div>
        <table className="result-table">
          <thead>
            <tr>
              <th>名次</th>
              <th>玩家</th>
              <th>奖金</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.seat} className={p.seat === humanSeat ? 'me' : ''}>
                <td>{p.rank}</td>
                <td>
                  <AvatarChip playerId={p.id} style={p.style} />
                  {p.name}
                  {p.seat === humanSeat ? '（你）' : ''}
                </td>
                <td>{p.prize > 0 ? p.prize : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {postmortem ? (
          <>
            <h3 className="pm-title">赛后复盘分析</h3>
            <PostmortemView data={postmortem} />
          </>
        ) : null}
        <button className="btn btn-primary" onClick={onClose}>
          返回大厅
        </button>
      </div>
    </div>
  )
}
