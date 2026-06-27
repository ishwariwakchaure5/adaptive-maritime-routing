import { useCallback, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { NORMALIZED_VECTOR_FIELD_PRESET } from '../engine/vectorFieldNavigation'
import { CURRENT_PRESET_NAMES, type CurrentPresetName } from '../engine/oceanCurrents'
import type { ShipRuntimeConfig, SimulationRuntimePayload } from '../simulation/simulationRuntime'
import {
  downloadJson,
  parseSceneSaveFile,
  pickJsonFile,
  SAVE_FORMAT_VERSION,
  serialiseScene,
  shipConfigsFromSave,
  type SceneSaveFile,
} from '../simulation/scenePersistence'
import type { SceneHandle } from '../canvas/useSimulationCanvas'
import {
  SimulationControlsContext,
  type SimulationControlsContextValue,
} from './simulationControlsContext'
import { SHIP_COLORS } from '../models/ship'

const preset = NORMALIZED_VECTOR_FIELD_PRESET

/** Maximum ships the UI allows. */
export const MAX_SHIPS = SHIP_COLORS.length

const DEFAULT_SHIPS: ShipRuntimeConfig[] = [
  { startX: 0.12, startY: 0.52, goalX: 0.88, goalY: 0.42 },
  { startX: 0.12, startY: 0.72, goalX: 0.88, goalY: 0.22 },
]

const EXTRA_SHIP_DEFAULTS: ShipRuntimeConfig[] = [
  { startX: 0.12, startY: 0.32, goalX: 0.88, goalY: 0.62 },
  { startX: 0.12, startY: 0.12, goalX: 0.88, goalY: 0.82 },
]

export function SimulationControlsProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false)
  const [ships, setShips] = useState<ShipRuntimeConfig[]>(DEFAULT_SHIPS)
  const [kAtt, setKAtt] = useState(preset.kAtt ?? 12)
  const [kRep, setKRep] = useState(preset.kRep ?? 0.0015)
  const [stepSize, setStepSize] = useState(preset.stepSize ?? 0.0018)
  const [resetNonce, setResetNonce] = useState(0)
  const [showVectorField, setShowVectorField] = useState(false)
  const [obstaclesDrift, setObstaclesDrift] = useState(true)
  const [driftSpeedScale, setDriftSpeedScale] = useState(1.0)
  const [lastLoadError, setLastLoadError] = useState<string | null>(null)
  const [currentsEnabled, setCurrentsEnabled] = useState(false)
  const [currentStrength, setCurrentStrength] = useState(1.0)
  const [currentPreset, setCurrentPreset] = useState<CurrentPresetName>(CURRENT_PRESET_NAMES[0])
  const [comparisonMode, setComparisonMode] = useState(false)
  const [backendMode, setBackendMode] = useState(false)
  const [backendUrl, setBackendUrl] = useState('http://localhost:8080')

  // Ref to the canvas scene handle — registered by SimulationCanvas on mount.
  const sceneHandleRef = useRef<MutableRefObject<SceneHandle> | null>(null)

  const registerSceneHandle = useCallback(
    (handle: MutableRefObject<SceneHandle>) => {
      sceneHandleRef.current = handle
    },
    [],
  )

  // ── Ship list mutations ────────────────────────────────────────────────────

  const setShipStart = useCallback((index: number, x: number, y: number) => {
    setShips((prev) =>
      prev.map((s, i) => (i === index ? { ...s, startX: x, startY: y } : s)),
    )
  }, [])

  const setShipGoal = useCallback((index: number, x: number, y: number) => {
    setShips((prev) =>
      prev.map((s, i) => (i === index ? { ...s, goalX: x, goalY: y } : s)),
    )
  }, [])

  const addShip = useCallback(() => {
    setShips((prev) => {
      if (prev.length >= MAX_SHIPS) return prev
      const defaults = EXTRA_SHIP_DEFAULTS[prev.length - DEFAULT_SHIPS.length]
      return [
        ...prev,
        defaults ?? { startX: 0.1, startY: 0.5, goalX: 0.9, goalY: 0.5 },
      ]
    })
  }, [])

  const removeShip = useCallback((index: number) => {
    setShips((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  // ── Playback ──────────────────────────────────────────────────────────────

  const startSimulation = useCallback(() => setRunning(true), [])
  const pauseSimulation = useCallback(() => setRunning(false), [])
  const resetSimulation = useCallback(() => {
    setRunning(false)
    setResetNonce((n) => n + 1)
  }, [])

  const getRuntimePayload = useCallback((): SimulationRuntimePayload => {
    return {
      running,
      ships,
      kAtt,
      kRep,
      stepSize,
      resetNonce,
      showVectorField,
      obstaclesDrift,
      driftSpeedScale,
      currentsEnabled,
      currentStrength,
      currentPreset,
      comparisonMode,
      backendMode,
      backendUrl,
    }
  }, [running, ships, kAtt, kRep, stepSize, resetNonce, showVectorField, obstaclesDrift, driftSpeedScale, currentsEnabled, currentStrength, currentPreset, comparisonMode, backendMode, backendUrl])

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveScene = useCallback(() => {
    const handle = sceneHandleRef.current?.current
    if (!handle) return

    const liveShips = handle.getShipPositions()
    const liveObstacles = handle.getObstacles()

    const file: SceneSaveFile = {
      version: SAVE_FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      ships: liveShips.map((s) => ({
        posX: s.posX,
        posY: s.posY,
        goalX: s.goalX,
        goalY: s.goalY,
      })),
      obstacles: liveObstacles,
      fieldParams: {
        kAtt,
        kRep,
        stepSize,
        obstaclesDrift,
        driftSpeedScale,
      },
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)
    downloadJson(serialiseScene(file), `simulation-${timestamp}.json`)
  }, [kAtt, kRep, stepSize, obstaclesDrift, driftSpeedScale])

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadScene = useCallback(async () => {
    setLastLoadError(null)
    let json: string
    try {
      json = await pickJsonFile()
    } catch {
      // User cancelled — not an error worth surfacing.
      return
    }

    const result = parseSceneSaveFile(json)
    if (!result.ok) {
      setLastLoadError(result.reason)
      return
    }

    const { data } = result

    // 1. Apply field params to React state.
    setKAtt(data.fieldParams.kAtt)
    setKRep(data.fieldParams.kRep)
    setStepSize(data.fieldParams.stepSize)
    setObstaclesDrift(data.fieldParams.obstaclesDrift)
    setDriftSpeedScale(data.fieldParams.driftSpeedScale)

    // 2. Apply ship configs (start = saved position, goal = saved goal).
    const newShipConfigs = shipConfigsFromSave(data.ships)
    setShips(newShipConfigs)

    // 3. Inject obstacles directly into the canvas scene (no re-mount needed).
    const handle = sceneHandleRef.current?.current
    if (handle) {
      handle.loadObstacles(data.obstacles)
    }

    // 4. Trigger a full scene reset so ships teleport to their saved positions.
    setRunning(false)
    setResetNonce((n) => n + 1)
  }, [])

  // ── Context value ─────────────────────────────────────────────────────────

  const value = useMemo(
    (): SimulationControlsContextValue => ({
      running,
      ships,
      kAtt,
      kRep,
      stepSize,
      resetNonce,
      showVectorField,
      obstaclesDrift,
      driftSpeedScale,
      currentsEnabled,
      currentStrength,
      currentPreset,
      comparisonMode,
      backendMode,
      backendUrl,
      setShipStart,
      setShipGoal,
      addShip,
      removeShip,
      setKAtt,
      setKRep,
      setStepSize,
      setShowVectorField,
      setObstaclesDrift,
      setDriftSpeedScale,
      setCurrentsEnabled,
      setCurrentStrength,
      setCurrentPreset,
      setComparisonMode,
      setBackendMode,
      setBackendUrl,
      startSimulation,
      pauseSimulation,
      resetSimulation,
      getRuntimePayload,
      registerSceneHandle,
      saveScene,
      loadScene,
      lastLoadError,
    }),
    [
      running,
      ships,
      kAtt,
      kRep,
      stepSize,
      resetNonce,
      showVectorField,
      obstaclesDrift,
      driftSpeedScale,
      currentsEnabled,
      currentStrength,
      currentPreset,
      comparisonMode,
      backendMode,
      backendUrl,
      setShipStart,
      setShipGoal,
      addShip,
      removeShip,
      startSimulation,
      pauseSimulation,
      resetSimulation,
      getRuntimePayload,
      registerSceneHandle,
      saveScene,
      loadScene,
      lastLoadError,
    ],
  )

  return (
    <SimulationControlsContext.Provider value={value}>
      {children}
    </SimulationControlsContext.Provider>
  )
}
