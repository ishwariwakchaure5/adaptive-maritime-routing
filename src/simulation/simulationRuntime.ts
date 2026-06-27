import type { CurrentPresetName } from '../engine/oceanCurrents'

/**
 * Per-ship configuration carried in the runtime payload.
 */
export type ShipRuntimeConfig = {
  startX: number
  startY: number
  goalX: number
  goalY: number
}

/**
 * Snapshot read by the canvas loop each frame (controls + reset versioning).
 */
export type SimulationRuntimePayload = {
  running: boolean
  /** One entry per active ship. */
  ships: ShipRuntimeConfig[]
  kAtt: number
  kRep: number
  /** Base step per nominal frame before dt scaling. */
  stepSize: number
  resetNonce: number
  showVectorField: boolean
  /** Whether obstacles drift (iceberg mode). */
  obstaclesDrift: boolean
  /** Global speed multiplier for obstacle drift (1 = normal). */
  driftSpeedScale: number
  /** Whether ocean currents are active. */
  currentsEnabled: boolean
  /** Multiplier applied to all current velocities (1 = designed default). */
  currentStrength: number
  /** Which current pattern to use. */
  currentPreset: CurrentPresetName
  /** When true, A* path is computed and shown alongside the VF path. */
  comparisonMode: boolean
  /** When true, paths are fetched from the C++ backend instead of computed locally. */
  backendMode: boolean
  /** Base URL of the C++ backend server. */
  backendUrl: string
}
