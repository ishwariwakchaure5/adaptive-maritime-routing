import type { Obstacle } from '../models/obstacle'
import { Vector } from '../models/vector'

export const DEFAULT_DRIFT_SPEED_SCALE = 1.0

/**
 * Advances every drifting obstacle by one time-scaled step with elastic
 * wall bouncing. Fully inlined scalars — no Vector allocations in the hot loop.
 */
export function stepObstacles(
  obstacles: Obstacle[],
  timeScale: number,
  speedScale: number,
): void {
  if (speedScale <= 0) return

  const scale = timeScale * speedScale

  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i]
    let vx = obs.velocity.x
    let vy = obs.velocity.y
    if (vx === 0 && vy === 0) continue

    let nx = obs.position.x + vx * scale
    let ny = obs.position.y + vy * scale

    if (nx < 0) { nx = -nx; vx = Math.abs(vx) }
    else if (nx > 1) { nx = 2 - nx; vx = -Math.abs(vx) }

    if (ny < 0) { ny = -ny; vy = Math.abs(vy) }
    else if (ny > 1) { ny = 2 - ny; vy = -Math.abs(vy) }

    // Only allocate new Vector objects when values actually changed.
    const clampedX = nx < 0 ? 0 : nx > 1 ? 1 : nx
    const clampedY = ny < 0 ? 0 : ny > 1 ? 1 : ny

    if (clampedX !== obs.position.x || clampedY !== obs.position.y) {
      obs.position = Vector.of(clampedX, clampedY)
    }
    if (vx !== obs.velocity.x || vy !== obs.velocity.y) {
      obs.velocity = Vector.of(vx, vy)
    }
  }
}

/**
 * Assigns a random drift velocity to an obstacle.
 */
export function randomDriftVelocity(baseSpeed = 0.0008): Vector {
  const angle = Math.random() * Math.PI * 2
  const speed = baseSpeed * (0.6 + Math.random() * 0.8)
  return Vector.of(Math.cos(angle) * speed, Math.sin(angle) * speed)
}
