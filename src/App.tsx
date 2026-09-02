import { useCallback, useRef, useState } from 'react'
import { GameController } from './store/gameController'
import { loadPrefs, loadSave, persistPrefs, persistSave, type Prefs, type SaveData } from './store/storage'
import { BUY_IN, presetConfig } from './data/blindSchedule'
import { rosterFor } from './data/aiNames'
import { randomSeed } from './core/rng'
import type { TournamentConfig } from './core/types'
import { Lobby } from './ui/Lobby'
import { Game } from './ui/Game'
import { Replay } from './ui/Replay'

type Screen = { kind: 'lobby' } | { kind: 'game' } | { kind: 'replay'; archiveIdx: number | 'ongoing' }

function mkConfig(prefs: Prefs): TournamentConfig {
  const ais = rosterFor(prefs.roster).slice(0, prefs.size - 1)
  return presetConfig(randomSeed(), { size: prefs.size, structure: prefs.structure }, [
    { id: 'human', name: '你', style: 'human' },
    ...ais.map((a) => ({ id: a.id, name: a.name, style: a.style })),
  ])
}

export default function App() {
  const [save, setSave] = useState<SaveData>(() => loadSave())
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const [screen, setScreen] = useState<Screen>({ kind: 'lobby' })
  const gcRef = useRef<GameController | null>(null)

  const onSave = useCallback((next: SaveData) => {
    setSave(next)
    persistSave(next)
  }, [])

  const onPrefs = useCallback((next: Prefs) => {
    setPrefs(next)
    persistPrefs(next)
  }, [])

  const startNew = useCallback(() => {
    gcRef.current = new GameController(mkConfig(prefs), 0)
    setScreen({ kind: 'game' })
  }, [prefs])

  const resume = useCallback(() => {
    if (!save.ongoing) return
    gcRef.current = GameController.resume(save.ongoing.ts, save.ongoing.history, 0)
    setScreen({ kind: 'game' })
  }, [save])

  const abandon = useCallback(() => {
    const next: SaveData = { ...save, ongoing: null, stats: { ...save.stats, played: save.stats.played + 1, totalBuyin: save.stats.totalBuyin + BUY_IN } }
    onSave(next)
    gcRef.current = new GameController(mkConfig(prefs), 0)
    setScreen({ kind: 'game' })
  }, [save, onSave, prefs])

  if (screen.kind === 'game' && gcRef.current) {
    return <Game gc={gcRef.current} save={save} onSave={onSave} prefs={prefs} onPrefs={onPrefs} onExit={() => setScreen({ kind: 'lobby' })} />
  }

  if (screen.kind === 'replay') {
    const target = screen.archiveIdx === 'ongoing' ? save.ongoing : save.archive[screen.archiveIdx]
    if (target) {
      return <Replay ts={target.ts} history={target.history} humanSeat={0} prefs={prefs} onPrefs={onPrefs} onBack={() => setScreen({ kind: 'lobby' })} />
    }
  }

  return (
    <Lobby
      save={save}
      prefs={prefs}
      onPrefs={onPrefs}
      onStart={startNew}
      onResume={resume}
      onAbandon={abandon}
      onReplay={(idx) => setScreen({ kind: 'replay', archiveIdx: idx })}
    />
  )
}
