import type { Obstacle } from '../models/obstacle'
import type { Ship } from '../models/ship'
import { Vector } from '../models/vector'
import type { NavigationEscapeBlend } from './navigationEscape'
import type { SpatialGrid } from './spatialGrid'
import { QUERY_RESULT_CAPACITY } from './spatialGrid'

export type VectorFieldConfig = {
  kAtt: number
  kRep: number
  /**
   * Repulsion activates when the ship is closer than this distance to an
   * obstacle's center (same units as positions).
   */
  influenceRadius: number
  stepSize: number
  /**
   * Floor on distance used in 1/d² so forces stay finite at the center.
   */
  minRepulsionDistance: number
}

/** Tuned for normalized canvas coordinates in ~[0, 1]. */
export const NORMALIZED_VECTOR_FIELD_PRESET: Partial<VectorFieldConfig> = {
  kAtt: 12,
  kRep: 0.0015,
  influenceRadius: 0.18,
  stepSize: 0.0018,
  minRepulsionDistance: 0.01,
}

export const DEFAULT_VECTOR_FIELD_CONFIG: VectorFieldConfig = {
  kAtt: 1,
  kRep: 400,
  influenceRadius: 120,
  stepSize: 2,
  minRepulsionDistance: 1e-3,
}

export function mergeVectorFieldConfig(
  overrides?: Partial<VectorFieldConfig>,
): VectorFieldConfig {
  return { ...DEFAULT_VECTOR_FIELD_CONFIG, ...overrides }
}

// ─── Reusable scratch buffer for grid query results ──────────────────────────
// One shared buffer is safe because all simulation stepping is synchronous.
const _queryBuf = new Int16Array(QUERY_RESULT_CAPACITY)

// ─── Core force math (fully inlined scalars — no Vector allocations) ─────────

/**
 * Accumulates repulsive force from all obstacles near (px, py).
 *
 * Uses the standard APF repulsion formula:
 *   F_rep = kRep × (1/d − 1/influenceRadius) × (1/d²) × unit_away
 *
 * Exported so the step function can call it separately for lookahead probing.
 * Returns [repX, repY].
 */
export function sumRepulsiveForces(
  px: number,
  py: number,
  obstacles: readonly Obstacle[],
  kRep: number,
  influenceRadius: number,
  minRepulsionDistance: number,
  grid: SpatialGrid | null,
): [number, number] {
  let rx = 0
  let ry = 0
  const invIR = 1 / influenceRadius

  const processObstacle = (o: Obstacle) => {
    const dx = px - o.position.x
    const dy = py - o.position.y
    const d = Math.max(Math.hypot(dx, dy), minRepulsionDistance)
    if (d >= influenceRadius) return
    const mag = kRep * (1 / d - invIR) / (d * d)
    const len = Math.hypot(dx, dy) || 1e-12
    rx += (dx / len) * mag
    ry += (dy / len) * mag
  }

  if (grid !== null) {
    const n = grid.queryRadius(px, py, influenceRadius, obstacles, _queryBuf)
    for (let i = 0; i < n; i++) processObstacle(obstacles[_queryBuf[i]])
  } else {
    for (let i = 0; i < obstacles.length; i++) processObstacle(obstacles[i])
  }

  return [rx, ry]
}

// Keep the old internal name as an alias for callers inside this file.
const sumRepulsiveScalar = sumRepulsiveForces

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Combined attractive + repulsive field at a point.
 * Used by the vector-field overlay (no grid — overlay has its own cadence).
 */
export function computeTotalForce(
  position: Vector,
  goal: Vector,
  obstacles: readonly Obstacle[],
  config: VectorFieldConfig,
): Vector {
  const px = position.x
  const py = position.y

  // Attractive force (inline).
  const attX = (goal.x - px) * config.kAtt
  const attY = (goal.y - py) * config.kAtt

  const [repX, repY] = sumRepulsiveScalar(
    px,
    py,
    obstacles,
    config.kRep,
    config.influenceRadius,
    config.minRepulsionDistance,
    null, // no grid for overlay
  )

  return Vector.of(attX + repX, attY + repY)
}

/**
 * Artificial potential-field step with optional spatial grid acceleration.
 *
 * @param grid              Pre-built grid. Pass `null` for linear scan.
 * @param currentForce      [cx, cy] ocean current in normalized units.
 * @param precomputedRepXY  Optional pre-blended repulsion from the step
 *                          function's lookahead probe. When provided, the
 *                          internal repulsion calculation is skipped.
 */
export function computeNextPosition(
  ship: Pick<Ship, 'position'>,
  goal: Vector,
  obstacles: readonly Obstacle[],
  config?: Partial<VectorFieldConfig>,
  escape?: NavigationEscapeBlend | null,
  grid: SpatialGrid | null = null,
  currentForce: [number, number] = [0, 0],
  precomputedRepXY?: [number, number],
): Vector {
  const {
    kAtt,
    kRep,
    influenceRadius,
    stepSize,
    minRepulsionDistance,
  } = mergeVectorFieldConfig(config)

  const px = ship.position.x
  const py = ship.position.y

  const dgx = goal.x - px
  const dgy = goal.y - py
  const distToGoal = Math.hypot(dgx, dgy)

  const captureZone = stepSize * 3
  if (distToGoal <= captureZone) {
    if (distToGoal < 1e-9) return ship.position
    const s = Math.min(distToGoal, stepSize)
    return Vector.of(px + (dgx / distToGoal) * s, py + (dgy / distToGoal) * s)
  }

  // Attractive force.
  const attScale = Math.min(kAtt, kAtt * distToGoal)
  let fx = (dgx / distToGoal) * attScale
  let fy = (dgy / distToGoal) * attScale

  // Repulsive force — use pre-computed lookahead blend when available.
  const [repX, repY] = precomputedRepXY
    ?? sumRepulsiveScalar(px, py, obstacles, kRep, influenceRadius, minRepulsionDistance, grid)
  fx += repX
  fy += repY

  // Ocean current.
  fx += currentForce[0] * kAtt
  fy += currentForce[1] * kAtt

  // Escape blend.
  if (escape && escape.strength > 1e-6) {
    const ed = escape.direction
    const edLen = Math.hypot(ed.x, ed.y)
    if (edLen > 1e-12) {
      const bonus = escape.strength * escape.gain * kAtt
      fx += (ed.x / edLen) * bonus
      fy += (ed.y / edLen) * bonus
    }
  }

  const fLen = Math.hypot(fx, fy)
  if (fLen < 1e-12) {
    return Vector.of(px + (dgx / distToGoal) * stepSize, py + (dgy / distToGoal) * stepSize)
  }

  const actualStep = Math.min(stepSize, distToGoal)
  return Vector.of(
    px + (fx / fLen) * actualStep,
    py + (fy / fLen) * actualStep,
  )
}

/**
 * Nearest-obstacle search using the spatial grid.
 * Returns the index of the nearest obstacle within `influenceRadius`, or -1.
 * Used by navigationEscape to avoid a second full scan.
 */
export function findNearestObstacleIndex(
  px: number,
  py: number,
  obstacles: readonly Obstacle[],
  influenceRadius: number,
  grid: SpatialGrid | null,
): number {
  let bestIdx = -1
  let bestD2 = influenceRadius * influenceRadius

  if (grid !== null) {
    const n = grid.queryRadius(px, py, influenceRadius, obstacles, _queryBuf)
    for (let i = 0; i < n; i++) {
      const idx = _queryBuf[i]
      const o = obstacles[idx]
      const dx = px - o.position.x
      const dy = py - o.position.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        bestIdx = idx
      }
    }
  } else {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]
      const dx = px - o.position.x
      const dy = py - o.position.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        bestIdx = i
      }
    }
  }

  return bestIdx
}
