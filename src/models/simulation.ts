export type Vec2 = {
  x: number
  y: number
}

/**
 * Positions in normalized canvas space: each axis is in [0, 1] relative to
 * width and height so layout stays stable when the canvas resizes.
 */
export type SimulationState = {
  ship: Vec2
  goal: Vec2
}

export const INITIAL_SIMULATION_STATE: SimulationState = {
  ship: { x: 0.22, y: 0.52 },
  goal: { x: 0.78, y: 0.42 },
}
