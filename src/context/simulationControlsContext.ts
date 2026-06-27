import { createContext } from 'react'
import type { MutableRefObject } from 'react'
import type { ShipRuntimeConfig, SimulationRuntimePayload } from '../simulation/simulationRuntime'
import type { CurrentPresetName } from '../engine/oceanCurrents'
import type { SceneHandle } from '../canvas/useSimulationCanvas'

export type SimulationControlsContextValue = {
  running: boolean
  ships: ShipRuntimeConfig[]
  kAtt: number
  kRep: number
  stepSize: number
  resetNonce: number
  showVectorField: boolean
  obstaclesDrift: boolean
  driftSpeedScale: number
  currentsEnabled: boolean
  currentStrength: number
  currentPreset: CurrentPresetName
  comparisonMode: boolean
  backendMode: boolean
  backendUrl: string
  // Ship list mutations
  setShipStart: (index: number, x: number, y: number) => void
  setShipGoal: (index: number, x: number, y: number) => void
  addShip: () => void
  removeShip: (index: number) => void
  // Field params
  setKAtt: (value: number) => void
  setKRep: (value: number) => void
  setStepSize: (value: number) => void
  setShowVectorField: (value: boolean) => void
  setObstaclesDrift: (value: boolean) => void
  setDriftSpeedScale: (value: number) => void
  setCurrentsEnabled: (value: boolean) => void
  setCurrentStrength: (value: number) => void
  setCurrentPreset: (value: CurrentPresetName) => void
  setComparisonMode: (value: boolean) => void
  setBackendMode: (value: boolean) => void
  setBackendUrl: (value: string) => void
  // Playback
  startSimulation: () => void
  pauseSimulation: () => void
  resetSimulation: () => void
  getRuntimePayload: () => SimulationRuntimePayload
  // Save / load
  registerSceneHandle: (handle: MutableRefObject<SceneHandle>) => void
  saveScene: () => void
  loadScene: () => Promise<void>
  lastLoadError: string | null
}

export const SimulationControlsContext =
  createContext<SimulationControlsContextValue | null>(null)
