import { Vector } from './vector'

export type Obstacle = {
  position: Vector
  radius: number
  /**
   * Drift velocity in normalized units per nominal 60fps frame.
   * Zero vector means the obstacle is stationary.
   */
  velocity: Vector
}

export function createObstacle(
  position: Vector,
  radius: number,
  velocity?: Vector,
): Obstacle {
  return { position, radius, velocity: velocity ?? Vector.of(0, 0) }
}
