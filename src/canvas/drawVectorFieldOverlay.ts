import {
  computeTotalForce,
  type VectorFieldConfig,
} from '../engine/vectorFieldNavigation'
import type { SimulationScene } from '../engine/simulationScene'
import { Vector } from '../models/vector'
import { clamp01 } from '../utils/clamp'

/** Cells per axis for sampling F_total (cell centers). */
export const VECTOR_FIELD_GRID_DIVISIONS = 18

/**
 * Recompute the overlay every N frames. The field changes slowly relative to
 * 60fps, so blitting a cached offscreen canvas for 2 frames out of 3 saves
 * ~66% of the 324 × N_obstacles force calculations.
 */
const OVERLAY_RECOMPUTE_INTERVAL = 3

const FORCE_EPS = 1e-14

// ─── Offscreen cache ─────────────────────────────────────────────────────────

let _offscreen: OffscreenCanvas | HTMLCanvasElement | null = null
let _offCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
let _cachedWidth = 0
let _cachedHeight = 0
let _frameCounter = 0

function getOffscreenCtx(
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (_cachedWidth !== width || _cachedHeight !== height || _offscreen === null) {
    // Recreate when size changes.
    if (typeof OffscreenCanvas !== 'undefined') {
      _offscreen = new OffscreenCanvas(width, height)
      _offCtx = (_offscreen as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D
    } else {
      // Fallback for environments without OffscreenCanvas.
      const el = document.createElement('canvas')
      el.width = width
      el.height = height
      _offscreen = el
      _offCtx = el.getContext('2d')
    }
    _cachedWidth = width
    _cachedHeight = height
    _frameCounter = 0 // force redraw on resize
  }
  return _offCtx
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

function toCanvas(nx: number, ny: number, w: number, h: number): [number, number] {
  return [clamp01(nx) * w, clamp01(ny) * h]
}

function strokeArrow(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  headLength: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()

  const angle = Math.atan2(y2 - y1, x2 - x1)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLength * Math.cos(angle - Math.PI / 6),
    y2 - headLength * Math.sin(angle - Math.PI / 6),
  )
  ctx.lineTo(
    x2 - headLength * Math.cos(angle + Math.PI / 6),
    y2 - headLength * Math.sin(angle + Math.PI / 6),
  )
  ctx.closePath()
  ctx.fill()
}

function renderToOffscreen(
  offCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: SimulationScene,
  fieldConfig: VectorFieldConfig,
): void {
  offCtx.clearRect(0, 0, width, height)

  const n = VECTOR_FIELD_GRID_DIVISIONS

  // Grid lines.
  offCtx.strokeStyle = 'rgba(51, 65, 85, 0.38)'
  offCtx.lineWidth = 1
  for (let i = 1; i < n; i++) {
    const gx = (i / n) * width
    offCtx.beginPath()
    offCtx.moveTo(gx, 0)
    offCtx.lineTo(gx, height)
    offCtx.stroke()

    const gy = (i / n) * height
    offCtx.beginPath()
    offCtx.moveTo(0, gy)
    offCtx.lineTo(width, gy)
    offCtx.stroke()
  }

  const scale = Math.min(width, height)
  const arrowLen = Math.max(6, scale * 0.028)
  const headLen = Math.max(4, arrowLen * 0.42)

  offCtx.strokeStyle = 'rgba(167, 139, 250, 0.48)'
  offCtx.fillStyle = 'rgba(167, 139, 250, 0.48)'
  offCtx.lineWidth = 1.25
  offCtx.lineCap = 'round'
  offCtx.lineJoin = 'round'

  const goal = scene.ships[0]?.goal
  if (!goal) return
  const { obstacles } = scene

  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const nx = (ix + 0.5) / n
      const ny = (iy + 0.5) / n
      const sample = Vector.of(nx, ny)
      const force = computeTotalForce(sample, goal, obstacles, fieldConfig)
      if (force.magnitude() < FORCE_EPS) continue

      const dir = force.normalize()
      const [cx, cy] = toCanvas(nx, ny, width, height)
      strokeArrow(offCtx, cx, cy, cx + dir.x * arrowLen, cy + dir.y * arrowLen, headLen)
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Draws the vector field overlay onto `ctx`.
 *
 * The field is recomputed onto an offscreen canvas every
 * `OVERLAY_RECOMPUTE_INTERVAL` frames and blitted the rest of the time,
 * cutting overlay CPU cost by ~66%.
 */
export function drawVectorFieldOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: SimulationScene,
  fieldConfig: VectorFieldConfig,
): void {
  const offCtx = getOffscreenCtx(width, height)
  if (!offCtx || !_offscreen) return

  _frameCounter++
  if (_frameCounter >= OVERLAY_RECOMPUTE_INTERVAL) {
    _frameCounter = 0
    renderToOffscreen(offCtx, width, height, scene, fieldConfig)
  }

  // Blit cached offscreen onto the main canvas.
  ctx.drawImage(_offscreen as CanvasImageSource, 0, 0)
}
