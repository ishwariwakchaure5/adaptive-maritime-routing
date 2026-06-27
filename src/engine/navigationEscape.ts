/**
 * Local-minima escape for the APF navigation.
 *
 * Strategy: pure tangential slip around the nearest obstacle.
 * No random wander — the tangential direction is deterministic and always
 * points toward the goal side of the obstacle, so the ship slides around
 * it rather than bouncing randomly.
 *
 * Trigger: 18 consecutive frames below the stuck-speed threshold (was 42).
 * Ramp: smoothstep over 30 frames (was 52). Faster response, cleaner exit.
 * Gain: 0.65 (was 0.38). Strong enough to actually break the local minimum.
 */

import type { Obstacle } from '../models/obstacle'
import { Vector } from '../models/vector'
import type { NavigationEscapeState } from './simulationScene'
import type { SpatialGrid } from './spatialGrid'
import { findNearestObstacleIndex } from './vectorFieldNavigation'

/** Speed below this (normalized coords / frame) counts as "stuck". */
const STUCK_SPEED_THRESHOLD = 0.00016

/** Frames below threshold before escape bias activates. */
const ESCAPE_MIN_FRAMES = 18

/** Frames over which escape strength ramps from 0 → 1. */
const ESCAPE_RAMP_FRAMES = 30

/** EMA alpha for smoothing the escape direction (low = smooth). */
const SMOOTH_ALPHA = 0.12

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * Of the two perpendiculars to `(rux, ruy)`, returns the one that has a
 * positive dot product with the goal direction — i.e. the tangent that
 * slides the ship toward the goal side of the obstacle.
 */
function goalSideTangent(
  rux: number, ruy: number,
  gdx: number, gdy: number,
): [number, number] {
  const tAx = -ruy; const tAy = rux
  const tBx =  ruy; const tBy = -rux
  return (tAx * gdx + tAy * gdy) >= (tBx * gdx + tBy * gdy)
    ? [tAx, tAy]
    : [tBx, tBy]
}

/**
 * Computes the raw escape direction: tangential slip around the nearest
 * obstacle within `influenceRadius`, biased toward the goal.
 * Falls back to a perpendicular nudge when no obstacle is nearby.
 */
export function computeRawEscapeDirection(
  position: Vector,
  goal: Vector,
  obstacles: readonly Obstacle[],
  influenceRadius: number,
  grid: SpatialGrid | null = null,
): Vector {
  const px = position.x
  const py = position.y

  const tgx = goal.x - px
  const tgy = goal.y - py
  const tgLen = Math.hypot(tgx, tgy)
  const gdx = tgLen > 1e-12 ? tgx / tgLen : 1
  const gdy = tgLen > 1e-12 ? tgy / tgLen : 0

  const nearestIdx = findNearestObstacleIndex(px, py, obstacles, influenceRadius, grid)

  if (nearestIdx >= 0) {
    const o = obstacles[nearestIdx]
    const radX = px - o.position.x
    const radY = py - o.position.y
    const radLen = Math.hypot(radX, radY)
    const rux = radLen > 1e-12 ? radX / radLen : 1
    const ruy = radLen > 1e-12 ? radY / radLen : 0
    const [tx, ty] = goalSideTangent(rux, ruy, gdx, gdy)
    const tLen = Math.hypot(tx, ty)
    return tLen > 1e-12 ? Vector.of(tx / tLen, ty / tLen) : Vector.of(0, 1)
  }

  // No nearby obstacle — nudge perpendicular to goal direction.
  const perpLen = Math.hypot(-gdy, gdx)
  return perpLen > 1e-12 ? Vector.of(-gdy / perpLen, gdx / perpLen) : Vector.of(0, 1)
}

export function updateNavigationEscapeState(
  state: NavigationEscapeState,
  speed: number,
  position: Vector,
  goal: Vector,
  obstacles: readonly Obstacle[],
  influenceRadius: number,
  timeScale: number,
  grid: SpatialGrid | null = null,
): void {
  if (speed < STUCK_SPEED_THRESHOLD) {
    state.consecutiveStuckFrames += timeScale  // time-scale aware
  } else {
    // Decay quickly once moving — don't hold escape state unnecessarily.
    state.consecutiveStuckFrames = Math.max(0, state.consecutiveStuckFrames - timeScale * 2)
  }

  // Always update the smoothed escape direction so it's ready when needed.
  const raw = computeRawEscapeDirection(position, goal, obstacles, influenceRadius, grid)

  const prev = state.smoothedEscapeUnit
  if (prev.x === 0 && prev.y === 0) {
    state.smoothedEscapeUnit = raw
    return
  }

  const blendX = prev.x * (1 - SMOOTH_ALPHA) + raw.x * SMOOTH_ALPHA
  const blendY = prev.y * (1 - SMOOTH_ALPHA) + raw.y * SMOOTH_ALPHA
  const blendLen = Math.hypot(blendX, blendY)
  if (blendLen < 1e-12) return
  state.smoothedEscapeUnit = Vector.of(blendX / blendLen, blendY / blendLen)
}

export type NavigationEscapeBlend = {
  direction: Vector
  strength: number
  /** Multiplier applied to kAtt when computing the escape bonus force. */
  gain: number
}

export function escapeBlendForStep(
  state: NavigationEscapeState,
): NavigationEscapeBlend | null {
  if (state.consecutiveStuckFrames < ESCAPE_MIN_FRAMES) return null

  const rampT = (state.consecutiveStuckFrames - ESCAPE_MIN_FRAMES) / ESCAPE_RAMP_FRAMES
  const strength = smoothstep01(rampT)
  if (strength < 0.01) return null

  const eu = state.smoothedEscapeUnit
  if (eu.x === 0 && eu.y === 0) return null

  return { direction: eu, strength, gain: 0.65 }
}

export function resetNavigationEscape(state: NavigationEscapeState): void {
  state.consecutiveStuckFrames = 0
  state.smoothedEscapeUnit = Vector.of(0, 0)
  state.wanderPhase = 0
}
