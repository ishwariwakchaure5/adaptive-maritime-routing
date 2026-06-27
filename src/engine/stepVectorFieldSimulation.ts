/**
 * Per-frame simulation step for all ships.
 *
 * Three intelligence improvements over the basic APF step:
 *
 * 1. HEADING SMOOTHING — each ship tracks a smoothed heading unit vector.
 *    The desired direction from the APF force is blended toward the current
 *    heading with a max turn-rate cap (MAX_TURN_RAD_PER_FRAME). This prevents
 *    instant 180° flips and produces natural-looking arcs.
 *
 * 2. PREDICTIVE LOOKAHEAD — repulsion is sampled at a point projected
 *    LOOKAHEAD_DIST ahead along the current heading, then blended with the
 *    repulsion at the ship's actual position. The ship starts curving away
 *    from obstacles before it reaches them.
 *
 * 3. PURE TANGENTIAL ESCAPE — local-minima recovery uses only the
 *    goal-side tangent of the nearest obstacle (no random wander).
 *    Triggers faster (18 frames) and ramps stronger (gain 0.65).
 */

import { createObstacle } from '../models/obstacle'
import { Vector } from '../models/vector'
import type { SimulationRuntimePayload } from '../simulation/simulationRuntime'
import {
  escapeBlendForStep,
  resetNavigationEscape,
  updateNavigationEscapeState,
} from './navigationEscape'
import { stepObstacles } from './obstacleMotion'
import { sampleCurrent } from './oceanCurrents'
import { SpatialGrid } from './spatialGrid'
import {
  computeNextPosition,
  mergeVectorFieldConfig,
  NORMALIZED_VECTOR_FIELD_PRESET,
  sumRepulsiveForces,
} from './vectorFieldNavigation'
import type { ShipAgent, SimulationScene } from './simulationScene'
import { SHIP_AVOIDANCE_RADIUS } from './simulationScene'
import { updateVfMetrics } from './comparison'
import { updateShipAnalytics } from './analytics'

const MAX_PATH_POINTS = 6000
const PATH_RECORD_MIN_DIST2 = 9e-8

/**
 * Maximum heading change per nominal frame (radians).
 * ~4.5° per frame at 60fps → smooth arcs, not instant pivots.
 */
const MAX_TURN_RAD_PER_FRAME = 0.078

/**
 * How far ahead (in normalized units) to probe for obstacles.
 * 3× the step size gives ~12 frames of warning at default speed.
 */
const LOOKAHEAD_DIST = 0.048

/**
 * Weight of the lookahead repulsion vs current-position repulsion.
 * 0.55 = lookahead slightly dominates so the ship curves early.
 */
const LOOKAHEAD_BLEND = 0.55

export type StepSimulationOptions = Pick<
  SimulationRuntimePayload,
  | 'running'
  | 'kAtt'
  | 'kRep'
  | 'stepSize'
  | 'obstaclesDrift'
  | 'driftSpeedScale'
  | 'currentsEnabled'
  | 'currentStrength'
  | 'currentPreset'
  | 'comparisonMode'
>

// ─── Module-level singletons ─────────────────────────────────────────────────

const _obstacleGrid = new SpatialGrid(32)

const _peerScratch: ReturnType<typeof createObstacle>[] = Array.from(
  { length: 8 },
  () => createObstacle(Vector.of(0, 0), SHIP_AVOIDANCE_RADIUS),
)

function fillPeerObstacles(scene: SimulationScene, selfAgent: ShipAgent): number {
  let n = 0
  for (const agent of scene.ships) {
    if (agent === selfAgent) continue
    _peerScratch[n].position = agent.ship.position
    n++
  }
  return n
}

// ─── Heading smoothing ───────────────────────────────────────────────────────

/**
 * Rotates the current heading (hx, hy) toward the desired direction (dx, dy)
 * by at most `maxTurn` radians. Returns the new heading as [nx, ny].
 *
 * Uses the cross-product sign to determine rotation direction, then clamps
 * the angle change — no trigonometry needed for the common case.
 */
function smoothHeading(
  hx: number, hy: number,
  dx: number, dy: number,
  maxTurn: number,
): [number, number] {
  // Dot and cross products between current heading and desired direction.
  const dot   =  hx * dx + hy * dy   // cos θ
  const cross =  hx * dy - hy * dx   // sin θ  (positive = turn left)

  // If already aligned (dot ≈ 1) or desired is zero, keep heading.
  const desiredLen = Math.hypot(dx, dy)
  if (desiredLen < 1e-9) return [hx, hy]

  // Clamp the angle.
  const angle = Math.atan2(cross, dot)          // signed angle in (-π, π]
  const clamped = Math.max(-maxTurn, Math.min(maxTurn, angle))

  if (Math.abs(clamped - angle) < 1e-9) {
    // No clamping needed — just normalise the desired direction.
    return [dx / desiredLen, dy / desiredLen]
  }

  // Rotate current heading by `clamped` radians.
  const cosA = Math.cos(clamped)
  const sinA = Math.sin(clamped)
  const nx = hx * cosA - hy * sinA
  const ny = hx * sinA + hy * cosA
  const nLen = Math.hypot(nx, ny) || 1
  return [nx / nLen, ny / nLen]
}

// ─── Per-ship step ───────────────────────────────────────────────────────────

function stepShipAgent(
  agent: ShipAgent,
  scene: SimulationScene,
  timeScale: number,
  options: StepSimulationOptions,
): void {  if (agent.reachedGoal) return

  const config = mergeVectorFieldConfig({
    ...NORMALIZED_VECTOR_FIELD_PRESET,
    kAtt: options.kAtt,
    kRep: options.kRep,
    stepSize: options.stepSize * timeScale,
  })

  const peerCount = fillPeerObstacles(scene, agent)
  const allObstacles =
    peerCount === 0
      ? scene.obstacles
      : [...scene.obstacles, ..._peerScratch.slice(0, peerCount)]

  const prev = agent.ship.position
  const prevSpeed = agent.ship.velocity.magnitude()

  updateNavigationEscapeState(
    agent.navigationEscape,
    prevSpeed,
    prev,
    agent.goal,
    allObstacles,
    config.influenceRadius,
    timeScale,
    _obstacleGrid,
  )

  const escapeBlend = escapeBlendForStep(agent.navigationEscape)

  // ── Predictive lookahead ────────────────────────────────────────────────
  // Sample repulsion at a point projected ahead along the current heading.
  // Blend it with the repulsion at the ship's actual position so the ship
  // starts curving before it reaches the obstacle.
  const laX = Math.min(1, Math.max(0, prev.x + agent.headingX * LOOKAHEAD_DIST))
  const laY = Math.min(1, Math.max(0, prev.y + agent.headingY * LOOKAHEAD_DIST))

  const [repNowX, repNowY] = sumRepulsiveForces(
    prev.x, prev.y, allObstacles,
    config.kRep, config.influenceRadius, config.minRepulsionDistance,
    _obstacleGrid,
  )
  const [repLaX, repLaY] = sumRepulsiveForces(
    laX, laY, allObstacles,
    config.kRep, config.influenceRadius, config.minRepulsionDistance,
    _obstacleGrid,
  )

  // Weighted blend: lookahead slightly dominates.
  const blendedRepX = repNowX * (1 - LOOKAHEAD_BLEND) + repLaX * LOOKAHEAD_BLEND
  const blendedRepY = repNowY * (1 - LOOKAHEAD_BLEND) + repLaY * LOOKAHEAD_BLEND

  // ── Ocean current ───────────────────────────────────────────────────────
  const currentForce = options.currentsEnabled
    ? sampleCurrent(prev.x, prev.y, options.currentPreset, options.currentStrength)
    : ([0, 0] as [number, number])

  // ── Compute desired direction from APF + lookahead + current ───────────
  const next = computeNextPosition(
    agent.ship,
    agent.goal,
    allObstacles,
    config,
    escapeBlend,
    _obstacleGrid,
    currentForce,
    [blendedRepX, blendedRepY],
  )

  // Desired direction = vector from current position to proposed next position.
  const rawDx = next.x - prev.x
  const rawDy = next.y - prev.y
  const rawLen = Math.hypot(rawDx, rawDy)

  // ── Heading smoothing ───────────────────────────────────────────────────
  // Limit how fast the ship can turn. Scale max turn by timeScale so it's
  // frame-rate independent.
  const maxTurn = MAX_TURN_RAD_PER_FRAME * Math.min(timeScale, 2)

  let newHx: number
  let newHy: number

  if (rawLen < 1e-9) {
    // No movement desired — keep current heading.
    newHx = agent.headingX
    newHy = agent.headingY
  } else {
    ;[newHx, newHy] = smoothHeading(
      agent.headingX, agent.headingY,
      rawDx / rawLen, rawDy / rawLen,
      maxTurn,
    )
  }

  agent.headingX = newHx
  agent.headingY = newHy

  // ── Move along smoothed heading ─────────────────────────────────────────
  const distToGoal = Math.hypot(agent.goal.x - prev.x, agent.goal.y - prev.y)
  const actualStep = Math.min(config.stepSize, distToGoal)

  const cx = Math.min(1, Math.max(0, prev.x + newHx * actualStep))
  const cy = Math.min(1, Math.max(0, prev.y + newHy * actualStep))
  const clamped = Vector.of(cx, cy)

  agent.ship.position = clamped
  agent.ship.velocity = Vector.of(cx - prev.x, cy - prev.y)

  // Record path point only when the ship has moved enough.
  const dx = cx - prev.x
  const dy = cy - prev.y
  if (dx * dx + dy * dy >= PATH_RECORD_MIN_DIST2) {
    agent.ship.pathHistory.push(clamped)
    if (agent.ship.pathHistory.length > MAX_PATH_POINTS) {
      agent.ship.pathHistory.splice(0, 64)
    }
  }

  // Goal arrival check.
  const sepX = cx - agent.goal.x
  const sepY = cy - agent.goal.y
  if (sepX * sepX + sepY * sepY <= agent.goalReachThreshold * agent.goalReachThreshold) {
    agent.reachedGoal = true
    agent.ship.position = agent.goal
    agent.ship.velocity = Vector.of(0, 0)
    resetNavigationEscape(agent.navigationEscape)
    agent.ship.pathHistory.push(agent.goal)
  }

  // Update VF metrics for comparison panel.
  if (options.comparisonMode) {
    updateVfMetrics(agent.comparison, agent.ship.pathHistory, agent.reachedGoal)
  }

  // Always update real-time analytics.
  updateShipAnalytics(
    agent.analytics,
    cx, cy,
    agent.goal.x, agent.goal.y,
    blendedRepX, blendedRepY,
    agent.reachedGoal,
  )
}

// ─── Scene step ──────────────────────────────────────────────────────────────

export function stepVectorFieldSimulation(
  scene: SimulationScene,
  dtSeconds: number,
  options: StepSimulationOptions,
): void {
  const timeScale = Math.min(Math.max(dtSeconds * 60, 0), 3)

  stepObstacles(
    scene.obstacles,
    timeScale,
    options.obstaclesDrift ? options.driftSpeedScale : 0,
  )

  _obstacleGrid.build(scene.obstacles)

  if (!options.running) return

  for (const agent of scene.ships) {
    stepShipAgent(agent, scene, timeScale, options)
  }
}
