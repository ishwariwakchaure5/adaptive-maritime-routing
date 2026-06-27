import { Vector } from './vector'

/**
 * Vessel state for routing / physics. Use {@link Vector} for geometry.
 */
export type Ship = {
  position: Vector
  velocity: Vector
  /** Past positions, typically most-recent last (engine convention). */
  pathHistory: Vector[]
}

export function createShip(
  position: Vector,
  options?: {
    velocity?: Vector
    pathHistory?: Vector[]
  },
): Ship {
  return {
    position,
    velocity: options?.velocity ?? Vector.of(0, 0),
    pathHistory: options?.pathHistory ?? [],
  }
}

/** Palette of distinct ship colors (fill, stroke, path-trail). */
export const SHIP_COLORS = [
  { fill: '#22d3ee', stroke: '#a5f3fc', path: 'rgba(34,211,238,0.55)'  }, // cyan
  { fill: '#a78bfa', stroke: '#ddd6fe', path: 'rgba(167,139,250,0.55)' }, // violet
  { fill: '#34d399', stroke: '#a7f3d0', path: 'rgba(52,211,153,0.55)'  }, // emerald
  { fill: '#fb923c', stroke: '#fed7aa', path: 'rgba(251,146,60,0.55)'  }, // orange
] as const

export type ShipColorEntry = (typeof SHIP_COLORS)[number]
