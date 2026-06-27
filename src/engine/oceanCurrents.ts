/**
 * Ocean current field for the simulation.
 *
 * The field is a superposition of:
 *   1. A base uniform drift (direction + speed).
 *   2. Several sinusoidal vortex terms that create spatial variation.
 *
 * All positions are in normalized [0,1]² space.
 * Output is a velocity vector in normalized units / nominal frame.
 *
 * The field is purely mathematical — no state, no allocations in the hot path.
 */

export type CurrentPresetName = 'trade_winds' | 'gyre' | 'stormy' | 'calm'

type VortexTerm = {
  /** Frequency multiplier for x and y. */
  fx: number
  fy: number
  /** Phase offsets. */
  px: number
  py: number
  /** Amplitude of the x and y components. */
  ax: number
  ay: number
}

type CurrentPreset = {
  label: string
  /** Base drift direction (unit vector scaled by base speed). */
  baseDx: number
  baseDy: number
  /** Vortex terms summed to produce spatial variation. */
  vortices: VortexTerm[]
}

/** Base speed in normalized units / nominal frame (before strength scaling). */
const BASE_SPEED = 0.003

const PRESETS: Record<CurrentPresetName, CurrentPreset> = {
  trade_winds: {
    label: 'Trade Winds',
    // Steady eastward drift with gentle north-south undulation.
    baseDx: BASE_SPEED * 1.2,
    baseDy: BASE_SPEED * 0.1,
    vortices: [
      { fx: 1.5, fy: 2.0, px: 0.0, py: 0.5, ax:  0.0,          ay:  BASE_SPEED * 0.8 },
      { fx: 3.0, fy: 1.0, px: 1.0, py: 0.0, ax:  BASE_SPEED * 0.4, ay:  0.0 },
    ],
  },
  gyre: {
    label: 'Ocean Gyre',
    // Large clockwise circulation — strong spatial variation.
    baseDx: 0,
    baseDy: 0,
    vortices: [
      // Clockwise gyre: u = sin(π·y), v = -sin(π·x)
      { fx: 0,   fy: Math.PI, px: 0, py: 0, ax:  BASE_SPEED * 2.5, ay: 0 },
      { fx: Math.PI, fy: 0,   px: 0, py: 0, ax:  0, ay: -BASE_SPEED * 2.5 },
      // Secondary counter-gyre in the top-right quadrant.
      { fx: 0,   fy: Math.PI * 2, px: 0, py: Math.PI, ax: -BASE_SPEED * 1.0, ay: 0 },
    ],
  },
  stormy: {
    label: 'Stormy Seas',
    // Chaotic multi-frequency field — ships get pushed around significantly.
    baseDx: BASE_SPEED * 0.5,
    baseDy: BASE_SPEED * 0.3,
    vortices: [
      { fx: 2.1, fy: 3.3, px: 0.7, py: 1.1, ax:  BASE_SPEED * 2.0, ay:  BASE_SPEED * 1.5 },
      { fx: 4.7, fy: 1.9, px: 2.3, py: 0.4, ax: -BASE_SPEED * 1.8, ay:  BASE_SPEED * 2.2 },
      { fx: 1.3, fy: 5.1, px: 0.2, py: 3.1, ax:  BASE_SPEED * 1.2, ay: -BASE_SPEED * 1.6 },
      { fx: 6.0, fy: 2.5, px: 1.5, py: 0.9, ax: -BASE_SPEED * 0.9, ay: -BASE_SPEED * 1.1 },
    ],
  },
  calm: {
    label: 'Calm Waters',
    // Very gentle southward drift, barely perceptible.
    baseDx: BASE_SPEED * 0.1,
    baseDy: BASE_SPEED * 0.2,
    vortices: [
      { fx: 1.0, fy: 1.0, px: 0.0, py: 0.0, ax: BASE_SPEED * 0.15, ay: BASE_SPEED * 0.1 },
    ],
  },
}

export const CURRENT_PRESET_NAMES: CurrentPresetName[] = [
  'trade_winds',
  'gyre',
  'stormy',
  'calm',
]

export function getCurrentPresetLabel(name: CurrentPresetName): string {
  return PRESETS[name].label
}

/**
 * Samples the ocean current velocity at normalized position (px, py).
 *
 * Returns [vx, vy] in normalized units / nominal frame, scaled by `strength`.
 * `strength = 1` is the designed default; `strength = 2` doubles all forces.
 *
 * The formula for each vortex term is:
 *   vx += ax * sin(fx * π * x + px)
 *   vy += ay * sin(fy * π * y + py)
 *
 * This produces smooth, spatially varying flow without any state.
 */
export function sampleCurrent(
  px: number,
  py: number,
  preset: CurrentPresetName,
  strength: number,
): [number, number] {
  if (strength <= 0) return [0, 0]

  const p = PRESETS[preset]
  let vx = p.baseDx
  let vy = p.baseDy

  for (const v of p.vortices) {
    vx += v.ax * Math.sin(v.fx * Math.PI * px + v.px)
    vy += v.ay * Math.sin(v.fy * Math.PI * py + v.py)
  }

  return [vx * strength, vy * strength]
}
