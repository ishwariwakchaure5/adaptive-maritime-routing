/**
 * Comparison mode: runs A* once (offline) and tracks VF metrics live.
 *
 * A* is computed synchronously when the comparison is triggered (on reset
 * or when comparison mode is enabled). The result is stored in the scene
 * and rendered as a static path overlay.
 *
 * VF metrics are accumulated frame-by-frame as the ship moves.
 */

import type { Obstacle } from '../models/obstacle'
import { Vector } from '../models/vector'
import { runAstar, computePathSmoothness } from './astar'

export type AlgorithmMetrics = {
  /** Total Euclidean path length in normalized units. */
  pathLength: number
  /** Wall-clock time to compute the path (ms). For VF: time to reach goal. */
  computeTimeMs: number
  /** Average absolute heading change between segments (radians). Lower = smoother. */
  smoothness: number
  /** Whether the ship has reached the goal. */
  completed: boolean
}

export type ComparisonState = {
  /** Pre-computed A* path waypoints. Empty if not yet computed. */
  astarPath: Vector[]
  astarMetrics: AlgorithmMetrics
  vfMetrics: AlgorithmMetrics
  /** Timestamp when VF started running (for elapsed time tracking). */
  vfStartTime: number
}

export function createComparisonState(): ComparisonState {
  return {
    astarPath: [],
    astarMetrics: emptyMetrics(),
    vfMetrics: emptyMetrics(),
    vfStartTime: 0,
  }
}

export function emptyMetrics(): AlgorithmMetrics {
  return { pathLength: 0, computeTimeMs: 0, smoothness: 0, completed: false }
}

/**
 * Runs A* for a single ship and stores the result in `state`.
 * Called once on reset when comparison mode is active.
 */
export function computeAstarForShip(
  start: Vector,
  goal: Vector,
  obstacles: readonly Obstacle[],
  state: ComparisonState,
): void {
  const result = runAstar(start, goal, obstacles)
  state.astarPath = result.path
  state.astarMetrics = {
    pathLength: result.pathLength,
    computeTimeMs: result.computeTimeMs,
    smoothness: computePathSmoothness(result.path),
    completed: result.found,
  }
}

/**
 * Updates VF metrics each frame as the ship moves.
 * Call this after the ship position has been updated.
 */
export function updateVfMetrics(
  state: ComparisonState,
  pathHistory: readonly Vector[],
  reachedGoal: boolean,
): void {
  if (state.vfStartTime === 0) {
    state.vfStartTime = performance.now()
  }

  // Recompute path length from history each frame (cheap for display).
  let len = 0
  for (let i = 1; i < pathHistory.length; i++) {
    const dx = pathHistory[i].x - pathHistory[i - 1].x
    const dy = pathHistory[i].y - pathHistory[i - 1].y
    len += Math.hypot(dx, dy)
  }

  state.vfMetrics.pathLength = len
  state.vfMetrics.computeTimeMs = performance.now() - state.vfStartTime
  state.vfMetrics.smoothness = computePathSmoothness(pathHistory as Vector[])
  state.vfMetrics.completed = reachedGoal
}

/**
 * Resets VF metrics (call on scene reset).
 */
export function resetVfMetrics(state: ComparisonState): void {
  state.vfMetrics = emptyMetrics()
  state.vfStartTime = 0
}
