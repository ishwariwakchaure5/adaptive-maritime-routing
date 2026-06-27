/**
 * Real-time per-ship analytics tracked during simulation.
 *
 * Updated every frame by the step function. Read by the React analytics
 * panel via the SceneHandle without going through React state (avoids
 * re-render overhead on every frame).
 */

import type { Obstacle } from '../models/obstacle'
import { Vector } from '../models/vector'

export type ShipAnalytics = {
  /** Current straight-line distance to goal (normalized units). */
  distanceToGoal: number
  /** Accumulated Euclidean path length so far (normalized units). */
  totalPathLength: number
  /** Elapsed wall-clock time since the ship started moving (ms). */
  elapsedTimeMs: number
  /** Number of frames where the ship was actively deflected by an obstacle. */
  avoidanceEvents: number
  /** Whether the ship has reached its goal. */
  completed: boolean
  /** Timestamp when the ship first moved (performance.now()). */
  _startTime: number
  /** Previous position used for incremental path-length accumulation. */
  _prevX: number
  _prevY: number
  /** Whether the ship has started moving yet. */
  _started: boolean
}

export function createShipAnalytics(): ShipAnalytics {
  return {
    distanceToGoal: 0,
    totalPathLength: 0,
    elapsedTimeMs: 0,
    avoidanceEvents: 0,
    completed: false,
    _startTime: 0,
    _prevX: -1,
    _prevY: -1,
    _started: false,
  }
}

export function resetShipAnalytics(a: ShipAnalytics, startX: number, startY: number): void {
  a.distanceToGoal = 0
  a.totalPathLength = 0
  a.elapsedTimeMs = 0
  a.avoidanceEvents = 0
  a.completed = false
  a._startTime = 0
  a._prevX = startX
  a._prevY = startY
  a._started = false
}

/**
 * Threshold for repulsive force magnitude that counts as an avoidance event.
 * Tuned so minor field influence doesn't count — only meaningful deflections.
 */
const AVOIDANCE_FORCE_THRESHOLD = 0.004

/**
 * Updates analytics for one ship after its position has been updated.
 *
 * @param a          Analytics state to mutate.
 * @param posX/posY  New ship position.
 * @param goalX/Y    Current goal position.
 * @param repForceX/Y  Repulsive force magnitude this frame (from APF).
 * @param reachedGoal  Whether the ship just reached its goal.
 */
export function updateShipAnalytics(
  a: ShipAnalytics,
  posX: number,
  posY: number,
  goalX: number,
  goalY: number,
  repForceX: number,
  repForceY: number,
  reachedGoal: boolean,
): void {
  if (a.completed) return

  // Start timer on first movement.
  if (!a._started) {
    a._started = true
    a._startTime = performance.now()
    a._prevX = posX
    a._prevY = posY
  }

  // Distance to goal.
  const dgx = goalX - posX
  const dgy = goalY - posY
  a.distanceToGoal = Math.hypot(dgx, dgy)

  // Incremental path length.
  const dx = posX - a._prevX
  const dy = posY - a._prevY
  const moved = Math.hypot(dx, dy)
  if (moved > 1e-6) {
    a.totalPathLength += moved
    a._prevX = posX
    a._prevY = posY
  }

  // Elapsed time.
  a.elapsedTimeMs = performance.now() - a._startTime

  // Avoidance event: repulsive force exceeded threshold this frame.
  const repMag = Math.hypot(repForceX, repForceY)
  if (repMag > AVOIDANCE_FORCE_THRESHOLD) {
    a.avoidanceEvents++
  }

  if (reachedGoal) {
    a.completed = true
  }
}
