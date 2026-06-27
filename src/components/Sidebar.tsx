import { useState } from 'react'
import { useSimulationControls } from '../hooks/useSimulationControls'
import { MAX_SHIPS } from '../context/SimulationControlsProvider'
import { SHIP_COLORS } from '../models/ship'
import { CURRENT_PRESET_NAMES, getCurrentPresetLabel } from '../engine/oceanCurrents'
import { clamp01 } from '../utils/clamp'

const K_ATT_RANGE   = { min: 1,    max: 30,    step: 0.5   }
const K_REP_RANGE   = { min: 1e-4, max: 0.02,  step: 1e-4  }
const STEP_RANGE    = { min: 0.0005, max: 0.006, step: 0.0001 }
const DRIFT_SPEED_RANGE    = { min: 0.1, max: 5.0, step: 0.1 }
const CURRENT_STRENGTH_RANGE = { min: 0.1, max: 5.0, step: 0.1 }

function parseUnitCoord(raw: string): number | null {
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? clamp01(v) : null
}

function CoordInput(props: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={props.id}
        className="text-[11px] font-medium uppercase tracking-wide text-slate-500"
      >
        {props.label}
      </label>
      <input
        id={props.id}
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={props.value}
        onChange={(e) => {
          const next = parseUnitCoord(e.target.value)
          if (next !== null) props.onChange(next)
        }}
        className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none ring-violet-500/40 focus:border-violet-500/60 focus:ring-2"
      />
    </div>
  )
}

function LabeledSlider(props: {
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={props.id}
          className="text-[11px] font-medium uppercase tracking-wide text-slate-500"
        >
          {props.label}
        </label>
        <span className="font-mono text-xs tabular-nums text-violet-200/90">
          {props.format(props.value)}
        </span>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-violet-500"
      />
    </div>
  )
}

export function Sidebar() {
  const {
    running,
    ships,
    kAtt,
    kRep,
    stepSize,
    setShipStart,
    setShipGoal,
    addShip,
    removeShip,
    setKAtt,
    setKRep,
    setStepSize,
    showVectorField,
    setShowVectorField,
    obstaclesDrift,
    setObstaclesDrift,
    driftSpeedScale,
    setDriftSpeedScale,
    currentsEnabled,
    setCurrentsEnabled,
    currentStrength,
    setCurrentStrength,
    currentPreset,
    setCurrentPreset,
    comparisonMode,
    setComparisonMode,
    backendMode,
    setBackendMode,
    backendUrl,
    setBackendUrl,
    startSimulation,    pauseSimulation,
    resetSimulation,
    saveScene,
    loadScene,
    lastLoadError,
  } = useSimulationControls()

  const [isLoading, setIsLoading] = useState(false)

  const handleLoad = async () => {
    setIsLoading(true)
    try {
      await loadScene()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-900/90 backdrop-blur-sm"
      aria-label="Simulation controls"
    >
      <header className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight text-slate-100">
          Controls
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Normalized coordinates (0–1). Each ship has its own start and goal.
          Ships avoid obstacles and each other.
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4">

        {/* ── Playback ─────────────────────────────────────────────────── */}
        <section aria-label="Playback">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Playback
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={startSimulation}
              disabled={running}
              className="rounded-md border border-emerald-700/80 bg-emerald-950/80 px-3 py-2 text-sm font-medium text-emerald-100 shadow-sm transition hover:bg-emerald-900/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start
            </button>
            <button
              type="button"
              onClick={pauseSimulation}
              disabled={!running}
              className="rounded-md border border-amber-700/80 bg-amber-950/70 px-3 py-2 text-sm font-medium text-amber-100 shadow-sm transition hover:bg-amber-900/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={resetSimulation}
              className="rounded-md border border-rose-800/80 bg-rose-950/70 px-3 py-2 text-sm font-medium text-rose-100 shadow-sm transition hover:bg-rose-900/80"
            >
              Reset
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-600">
            Status:{' '}
            <span className="font-medium text-slate-400">
              {running ? 'Running' : 'Paused'}
            </span>
          </p>
        </section>

        {/* ── Save / Load ──────────────────────────────────────────────── */}
        <section aria-label="Save and load">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Save / Load
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveScene}
              className="flex-1 rounded-md border border-sky-700/80 bg-sky-950/70 px-3 py-2 text-sm font-medium text-sky-100 shadow-sm transition hover:bg-sky-900/80"
            >
              ↓ Export JSON
            </button>
            <button
              type="button"
              onClick={handleLoad}
              disabled={isLoading}
              className="flex-1 rounded-md border border-indigo-700/80 bg-indigo-950/70 px-3 py-2 text-sm font-medium text-indigo-100 shadow-sm transition hover:bg-indigo-900/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Loading…' : '↑ Import JSON'}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Export saves ship positions, goals, obstacles, and field parameters.
            Import restores the full scene and resets the simulation.
          </p>
          {lastLoadError && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-rose-800/60 bg-rose-950/50 px-3 py-2 text-[11px] leading-relaxed text-rose-300"
            >
              {lastLoadError}
            </p>
          )}
        </section>

        {/* ── Ships ────────────────────────────────────────────────────── */}        <section aria-label="Ships">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Ships ({ships.length}/{MAX_SHIPS})
            </h2>
            {ships.length < MAX_SHIPS && (
              <button
                type="button"
                onClick={addShip}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300 transition hover:bg-slate-700"
              >
                + Add ship
              </button>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {ships.map((ship, i) => {
              const colors = SHIP_COLORS[i % SHIP_COLORS.length]
              return (
                <div
                  key={i}
                  className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
                >
                  {/* Ship header */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block size-3 rounded-full border"
                        style={{
                          backgroundColor: colors.fill,
                          borderColor: colors.stroke,
                        }}
                        aria-hidden="true"
                      />
                      <span className="text-xs font-semibold text-slate-300">
                        Ship {i + 1}
                      </span>
                    </div>
                    {ships.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeShip(i)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-slate-500 transition hover:bg-rose-950/60 hover:text-rose-400"
                        aria-label={`Remove ship ${i + 1}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Start */}
                  <p className="mb-1.5 text-[11px] text-slate-500">Start</p>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <CoordInput
                      id={`ship-${i}-start-x`}
                      label="X"
                      value={ship.startX}
                      onChange={(v) => setShipStart(i, v, ship.startY)}
                    />
                    <CoordInput
                      id={`ship-${i}-start-y`}
                      label="Y"
                      value={ship.startY}
                      onChange={(v) => setShipStart(i, ship.startX, v)}
                    />
                  </div>

                  {/* Goal */}
                  <p className="mb-1.5 text-[11px] text-slate-500">Goal</p>
                  <div className="grid grid-cols-2 gap-2">
                    <CoordInput
                      id={`ship-${i}-goal-x`}
                      label="X"
                      value={ship.goalX}
                      onChange={(v) => setShipGoal(i, v, ship.goalY)}
                    />
                    <CoordInput
                      id={`ship-${i}-goal-y`}
                      label="Y"
                      value={ship.goalY}
                      onChange={(v) => setShipGoal(i, ship.goalX, v)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Visualization ────────────────────────────────────────────── */}
        <section aria-label="Visualization">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Visualization
          </h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 hover:border-slate-700">
            <input
              type="checkbox"
              checked={showVectorField}
              onChange={(e) => setShowVectorField(e.target.checked)}
              className="size-4 rounded border-slate-600 bg-slate-900 text-violet-500 focus:ring-violet-500/40"
            />
            <span>Show vector field grid</span>
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Arrows show F_total for ship 1's goal. Updates with obstacles and
            field parameters.
          </p>
        </section>

        {/* ── Obstacles ────────────────────────────────────────────────── */}
        <section aria-label="Obstacles">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Obstacles
          </h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 hover:border-slate-700">
            <input
              type="checkbox"
              checked={obstaclesDrift}
              onChange={(e) => setObstaclesDrift(e.target.checked)}
              className="size-4 rounded border-slate-600 bg-slate-900 text-violet-500 focus:ring-violet-500/40"
            />
            <span>Drifting obstacles (iceberg mode)</span>
          </label>
          <p className="mt-2 mb-4 text-[11px] leading-relaxed text-slate-600">
            Obstacles drift continuously. Click the canvas to add more.
          </p>
          {obstaclesDrift && (
            <LabeledSlider
              id="drift-speed"
              label="Drift speed"
              {...DRIFT_SPEED_RANGE}
              value={driftSpeedScale}
              format={(v) => `${v.toFixed(1)}×`}
              onChange={setDriftSpeedScale}
            />
          )}
        </section>

        {/* ── Ocean Currents ───────────────────────────────────────────── */}
        <section aria-label="Ocean currents">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Ocean Currents
          </h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 hover:border-slate-700">
            <input
              type="checkbox"
              checked={currentsEnabled}
              onChange={(e) => setCurrentsEnabled(e.target.checked)}
              className="size-4 rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500/40"
            />
            <span>Enable ocean currents</span>
          </label>
          <p className="mt-2 mb-4 text-[11px] leading-relaxed text-slate-600">
            Adds a spatially varying water-flow force to F_total. Arrows on the
            canvas show direction and speed (blue = slow, teal = fast).
          </p>

          {currentsEnabled && (
            <div className="flex flex-col gap-4">
              {/* Preset selector */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Pattern
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {CURRENT_PRESET_NAMES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setCurrentPreset(name)}
                      className={[
                        'rounded-md border px-2 py-1.5 text-[11px] font-medium transition',
                        currentPreset === name
                          ? 'border-cyan-600/80 bg-cyan-950/70 text-cyan-100'
                          : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200',
                      ].join(' ')}
                    >
                      {getCurrentPresetLabel(name)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Strength slider */}
              <LabeledSlider
                id="current-strength"
                label="Current strength"
                {...CURRENT_STRENGTH_RANGE}
                value={currentStrength}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={setCurrentStrength}
              />
            </div>
          )}
        </section>

        {/* ── Backend Mode ─────────────────────────────────────────────── */}
        <section aria-label="Backend mode">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Backend Mode
          </h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 hover:border-slate-700">
            <input
              type="checkbox"
              checked={backendMode}
              onChange={(e) => setBackendMode(e.target.checked)}
              className="size-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40"
            />
            <span>Use C++ backend server</span>
          </label>
          <p className="mt-2 mb-3 text-[11px] leading-relaxed text-slate-600">
            On Start, sends ship/goal/obstacles to the backend, receives the
            computed path, and animates the ship along it. Falls back to local
            algorithm if the server is unreachable.
          </p>
          {backendMode && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="backend-url"
                className="text-[11px] font-medium uppercase tracking-wide text-slate-500"
              >
                Server URL
              </label>
              <input
                id="backend-url"
                type="url"
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value.trim())}
                placeholder="http://localhost:8080"
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-emerald-500/40 focus:border-emerald-500/60 focus:ring-2"
              />
              <p className="text-[10px] text-slate-600">
                Start the server: <code className="text-slate-400">./build/daa_path_server</code>
              </p>
            </div>
          )}
        </section>

        {/* ── Comparison Mode ──────────────────────────────────────────── */}        <section aria-label="Comparison mode">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Algorithm Comparison
          </h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-200 hover:border-slate-700">
            <input
              type="checkbox"
              checked={comparisonMode}
              onChange={(e) => setComparisonMode(e.target.checked)}
              className="size-4 rounded border-slate-600 bg-slate-900 text-yellow-500 focus:ring-yellow-500/40"
            />
            <span>Compare VF vs A*</span>
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
            Runs A* pathfinding on the same environment. The dashed yellow path
            shows the A* route. The metrics panel on the canvas compares path
            length, compute time, and smoothness. Hit Reset to recompute A*.
          </p>
          {comparisonMode && (
            <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-yellow-400/80" />
                <span className="text-[11px] text-yellow-300/80">A* path (dashed)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-5 border-t-2 border-cyan-400/80" />
                <span className="text-[11px] text-cyan-300/80">Vector field path (solid)</span>
              </div>
            </div>
          )}
        </section>

        {/* ── Field parameters ─────────────────────────────────────────── */}        <section aria-label="Vector field">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Field parameters
          </h2>
          <div className="flex flex-col gap-5">
            <LabeledSlider
              id="k-att"
              label="Attractive force (k_att)"
              {...K_ATT_RANGE}
              value={kAtt}
              format={(v) => v.toFixed(1)}
              onChange={setKAtt}
            />
            <LabeledSlider
              id="k-rep"
              label="Repulsive force (k_rep)"
              {...K_REP_RANGE}
              value={kRep}
              format={(v) => v.toExponential(2)}
              onChange={setKRep}
            />
            <LabeledSlider
              id="step-size"
              label="Step size"
              {...STEP_RANGE}
              value={stepSize}
              format={(v) => v.toFixed(4)}
              onChange={setStepSize}
            />
          </div>
        </section>

      </div>
    </aside>
  )
}
