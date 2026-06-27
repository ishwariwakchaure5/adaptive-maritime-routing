import { createObstacle, type Obstacle } from '../models/obstacle'
import { createShip, type Ship, SHIP_COLORS } from '../models/ship'
import { Vector } from '../models/vector'
import { randomDriftVelocity } from './obstacleMotion'
import { resetNavigationEscape } from './navigationEscape'
import { createComparisonState, type ComparisonState } from './comparison'
import { createShipAnalytics, resetShipAnalytics, type ShipAnalytics } from './analytics'

/** Radius relative to min(canvas width, height), in [0, 1] space. */
export const POINTER_PLACED_OBSTACLE_RADIUS = 0.042

/** Upper bound so clicks cannot grow the list without limit. */
export const MAX_OBSTACLE_COUNT = 96

/**
 * Radius used when treating other ships as dynamic obstacles.
 * Slightly larger than the visual ship radius so ships give each other room.
 */
export const SHIP_AVOIDANCE_RADIUS = 0.038

export type NavigationEscapeState = {
  consecutiveStuckFrames: number
  smoothedEscapeUnit: Vector
  /** Wander phase kept for API compatibility but no longer used for mixing. */
  wanderPhase: number
}

export function createNavigationEscapeState(): NavigationEscapeState {
  return {
    consecutiveStuckFrames: 0,
    smoothedEscapeUnit: Vector.of(0, 0),
    wanderPhase: 0,
  }
}

/** One ship with its own goal and navigation state. */
export type ShipAgent = {
  ship: Ship
  goal: Vector
  reachedGoal: boolean
  goalReachThreshold: number
  navigationEscape: NavigationEscapeState
  /** Index into SHIP_COLORS palette. */
  colorIndex: number
  /**
   * Smoothed heading unit vector. Updated each frame with a turn-rate limit
   * so the ship cannot spin instantly — produces natural-looking arcs.
   */
  headingX: number
  headingY: number
  /** Comparison state — A* path + per-algorithm metrics. Always present. */
  comparison: ComparisonState
  /** Real-time analytics — distance, path length, time, avoidance events. */
  analytics: ShipAnalytics
}

export type SimulationScene = {
  ships: ShipAgent[]
  obstacles: Obstacle[]
}

// ---------------------------------------------------------------------------
// Default starting layout
// ---------------------------------------------------------------------------

const DEFAULT_SHIPS: Array<{ start: [number, number]; goal: [number, number] }> = [
  { start: [0.12, 0.52], goal: [0.88, 0.42] },
  { start: [0.12, 0.72], goal: [0.88, 0.22] },
]

export function createShipAgent(
  start: Vector,
  goal: Vector,
  colorIndex: number,
): ShipAgent {
  const dx = goal.x - start.x
  const dy = goal.y - start.y
  const len = Math.hypot(dx, dy) || 1
  return {
    ship: createShip(start, { pathHistory: [Vector.of(start.x, start.y)] }),
    goal,
    reachedGoal: false,
    goalReachThreshold: 0.028,
    navigationEscape: createNavigationEscapeState(),
    colorIndex,
    headingX: dx / len,
    headingY: dy / len,
    comparison: createComparisonState(),
    analytics: createShipAnalytics(),
  }
}

export function resetShipAgent(agent: ShipAgent, start: Vector, goal: Vector): void {
  agent.ship.position = start
  agent.ship.velocity = Vector.of(0, 0)
  agent.ship.pathHistory = [Vector.of(start.x, start.y)]
  agent.goal = goal
  agent.reachedGoal = false
  resetNavigationEscape(agent.navigationEscape)
  const dx = goal.x - start.x
  const dy = goal.y - start.y
  const len = Math.hypot(dx, dy) || 1
  agent.headingX = dx / len
  agent.headingY = dy / len
  // Reset comparison state but keep astar path — it will be recomputed by
  // applySceneFromControls when comparisonMode is active.
  agent.comparison = createComparisonState()
  resetShipAnalytics(agent.analytics, start.x, start.y)
}

export function createSimulationScene(): SimulationScene {
  return {
    ships: DEFAULT_SHIPS.map((cfg, i) =>
      createShipAgent(
        Vector.of(...cfg.start),
        Vector.of(...cfg.goal),
        i % SHIP_COLORS.length,
      ),
    ),
    obstacles: [
      createObstacle(Vector.of(0.48, 0.52), 0.045, randomDriftVelocity()),
      createObstacle(Vector.of(0.62, 0.36), 0.038, randomDriftVelocity()),
    ],
  }
}
