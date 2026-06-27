import type { SimulationRuntimePayload } from '../simulation/simulationRuntime'
import { SHIP_COLORS } from '../models/ship'
import { Vector } from '../models/vector'
import { randomDriftVelocity } from './obstacleMotion'
import { createObstacle } from '../models/obstacle'
import {
  createShipAgent,
  resetShipAgent,
  type SimulationScene,
  POINTER_PLACED_OBSTACLE_RADIUS,
} from './simulationScene'
import { computeAstarForShip, resetVfMetrics } from './comparison'

/**
 * Applies a full reset from the runtime payload.
 * When comparisonMode is active, also runs A* for each ship.
 */
export function applySceneFromControls(
  scene: SimulationScene,
  payload: SimulationRuntimePayload,
): void {
  const configs = payload.ships

  while (scene.ships.length < configs.length) {
    const idx = scene.ships.length
    const cfg = configs[idx]
    scene.ships.push(
      createShipAgent(
        Vector.of(cfg.startX, cfg.startY).clampToUnitSquare(),
        Vector.of(cfg.goalX, cfg.goalY).clampToUnitSquare(),
        idx % SHIP_COLORS.length,
      ),
    )
  }
  scene.ships.length = configs.length

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const start = Vector.of(cfg.startX, cfg.startY).clampToUnitSquare()
    const goal  = Vector.of(cfg.goalX,  cfg.goalY).clampToUnitSquare()
    scene.ships[i].colorIndex = i % SHIP_COLORS.length
    resetShipAgent(scene.ships[i], start, goal)
    resetVfMetrics(scene.ships[i].comparison)

    if (payload.comparisonMode) {
      // A* uses the current (post-reset) obstacle list.
      computeAstarForShip(start, goal, scene.obstacles, scene.ships[i].comparison)
    }
  }

  // Rebuild obstacles.
  const count = Math.min(scene.obstacles.length, 2)
  scene.obstacles.length = 0
  const defaultPositions: [number, number, number][] = [
    [0.48, 0.52, 0.045],
    [0.62, 0.36, 0.038],
  ]
  for (let i = 0; i < Math.max(count, defaultPositions.length); i++) {
    const [x, y, r] = defaultPositions[i] ?? [
      0.3 + Math.random() * 0.4,
      0.3 + Math.random() * 0.4,
      POINTER_PLACED_OBSTACLE_RADIUS,
    ]
    scene.obstacles.push(createObstacle(Vector.of(x, y), r, randomDriftVelocity()))
  }
}
