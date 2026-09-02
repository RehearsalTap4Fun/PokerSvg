import { useCallback, useRef, useState } from 'react'
import { GameController } from './store/gameController'
import { loadSave, persistSave, type SaveData } from './store/storage'
import { defaultConfig } from './data/blindSchedule'
import { rosterFor, type RosterKind } from './data/aiNames'
import { randomSeed } from './core/rng'
import type { TournamentConfig } from './core/types'
import { Lobby } from './ui/Lobby'
import { Game } from './ui/Game'
import { Replay } from './ui/Replay'

type Screen = { kind: 'lobby' } | { kind: 'game' } | { kind: 'replay'; archiveIdx: number | 'ongoing' }

function mkConfig(roster: RosterKind): TournamentConfig {
  return defaultConfig(randomSeed(), [
    { id: 'human', name: '你', style: 'human' },
    ...rosterFor(roster).map((a) => ({ id: a.id, name: a.name, style: a.style })),
  ])
}

export default function App() {
  const [save, setSave] = useState<SaveData>(() => loadSave())
  const [screen, setScreen] = useState<Screen>({ kind: 'lobby' })
  const gcRef = useRef<GameController | null>(null)

  const onSave = useCallback((next: SaveData) => {
    setSave(next)
    persistSave(next)
  }, [])

  const startNew = useCallback((roster: RosterKind) => {
    gcRef.current = new GameController(mkConfig(roster), 0)
    setScreen({ kind: 'game' })
  }, [])

  const resume = useCallback(() => {
    if (!save.ongoing) return
    gcRef.current = GameController.resume(save.ongoing.ts, save.ongoing.history, 0)
    setScreen({ kind: 'game' })
  }, [save])

  const abandon = useCallback(
    (roster: RosterKind) => {
      const next: SaveData = { ...save, ongoing: null, stats: { ...save.stats, played: save.stats.played + 1, totalBuyin: save.stats.totalBuyin + 100 } }
      onSave(next)
      gcRef.current = new GameController(mkConfig(roster), 0)
      setScreen({ kind: 'game' })
    },
    [save, onSave],
  )

  if (screen.kind === 'game' && gcRef.current) {
    return <Game gc={gcRef.current} save={save} onSave={onSave} onExit={() => setScreen({ kind: 'lobby' })} />
  }

  if (screen.kind === 'replay') {
    const target = screen.archiveIdx === 'ongoing' ? save.ongoing : save.archive[screen.archiveIdx]
    if (target) {
      return <Replay ts={target.ts} history={target.history} humanSeat={0} onBack={() => setScreen({ kind: 'lobby' })} />
    }
  }

  return (
    <Lobby
      save={save}
      onStart={startNew}
      onResume={resume}
      onAbandon={abandon}
      onReplay={(idx) => setScreen({ kind: 'replay', archiveIdx: idx })}
    />
  )
}
