/**
 * Renders the ocean current field as a colored arrow grid.
 *
 * Arrow color encodes speed (blue = slow → cyan → teal = fast).
 * Arrow direction shows the current flow direction at each cell center.
 * The overlay is cached on an offscreen canvas and redrawn every
 * RECOMPUTE_INTERVAL frames for performance.
 */

import { sampleCurrent, type CurrentPresetName } from '../engine/oceanCurrents'

const GRID_DIVISIONS = 22
const RECOMPUTE_INTERVAL = 4   // redraw every 4 frames (~15fps at 60fps)

// ─── Offscreen cache ─────────────────────────────────────────────────────────

let _offscreen: OffscreenCanvas | HTMLCanvasElement | null = null
let _offCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
let _cachedW = 0
let _cachedH = 0
let _cachedPreset: CurrentPresetName | '' = ''
let _cachedStrength = -1
let _frame = 0

function getCtx(
  w: number,
  h: number,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (_cachedW !== w || _cachedH !== h || _offscreen === null) {
    if (typeof OffscreenCanvas !== 'undefined') {
      _offscreen = new OffscreenCanvas(w, h)
      _offCtx = (_offscreen as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D
    } else {
      const el = document.createElement('canvas')
      el.width = w; el.height = h
      _offscreen = el
      _offCtx = el.getContext('2d')
    }
    _cachedW = w; _cachedH = h
    _frame = 0
  }
  return _offCtx
}

// ─── Color mapping ────────────────────────────────────────────────────────────

/**
 * Maps a speed in [0, maxSpeed] to an rgba string.
 * Slow = deep blue, medium = cyan, fast = bright teal/white.
 */
function speedColor(speed: number, maxSpeed: number): string {
  const t = Math.min(1, speed / (maxSpeed || 1))
  // Interpolate: dark-blue (0,60,120) → cyan (0,200,220) → white-teal (180,255,255)
  const r = Math.round(t < 0.5 ? t * 2 * 0   : (t - 0.5) * 2 * 180)
  const g = Math.round(t < 0.5 ? 60 + t * 2 * 140 : 200 + (t - 0.5) * 2 * 55)
  const b = Math.round(t < 0.5 ? 120 + t * 2 * 100 : 220 + (t - 0.5) * 2 * 35)
  const a = 0.55 + t * 0.3
  return `rgba(${r},${g},${b},${a.toFixed(2)})`
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderOverlay(
  offCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  w: number,
  h: number,
  preset: CurrentPresetName,
  strength: number,
): void {
  offCtx.clearRect(0, 0, w, h)

  const n = GRID_DIVISIONS
  const cellW = w / n
  const cellH = h / n

  // First pass: find max speed for color normalization.
  let maxSpeed = 1e-9
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const nx = (ix + 0.5) / n
      const ny = (iy + 0.5) / n
      const [vx, vy] = sampleCurrent(nx, ny, preset, strength)
      const spd = Math.hypot(vx, vy)
      if (spd > maxSpeed) maxSpeed = spd
    }
  }

  const arrowLen = Math.min(cellW, cellH) * 0.52
  const headLen  = Math.max(3, arrowLen * 0.35)

  offCtx.lineWidth = 1.4
  offCtx.lineCap   = 'round'
  offCtx.lineJoin  = 'round'

  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const nx = (ix + 0.5) / n
      const ny = (iy + 0.5) / n
      const [vx, vy] = sampleCurrent(nx, ny, preset, strength)
      const spd = Math.hypot(vx, vy)
      if (spd < 1e-9) continue

      const ux = vx / spd
      const uy = vy / spd
      const cx = (ix + 0.5) * cellW
      const cy = (iy + 0.5) * cellH

      // Scale arrow length by relative speed so fast areas are visually prominent.
      const len = arrowLen * (0.4 + 0.6 * (spd / maxSpeed))
      const ex = cx + ux * len
      const ey = cy + uy * len
      const sx = cx - ux * len * 0.3
      const sy = cy - uy * len * 0.3

      const color = speedColor(spd, maxSpeed)
      offCtx.strokeStyle = color
      offCtx.fillStyle   = color

      // Shaft
      offCtx.beginPath()
      offCtx.moveTo(sx, sy)
      offCtx.lineTo(ex, ey)
      offCtx.stroke()

      // Arrowhead
      const angle = Math.atan2(uy, ux)
      offCtx.beginPath()
      offCtx.moveTo(ex, ey)
      offCtx.lineTo(
        ex - headLen * Math.cos(angle - Math.PI / 6),
        ey - headLen * Math.sin(angle - Math.PI / 6),
      )
      offCtx.lineTo(
        ex - headLen * Math.cos(angle + Math.PI / 6),
        ey - headLen * Math.sin(angle + Math.PI / 6),
      )
      offCtx.closePath()
      offCtx.fill()
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function drawCurrentOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  preset: CurrentPresetName,
  strength: number,
): void {
  const offCtx = getCtx(width, height)
  if (!offCtx || !_offscreen) return

  _frame++
  const presetChanged  = _cachedPreset   !== preset
  const strengthChanged = _cachedStrength !== strength

  if (_frame >= RECOMPUTE_INTERVAL || presetChanged || strengthChanged) {
    _frame = 0
    _cachedPreset   = preset
    _cachedStrength = strength
    renderOverlay(offCtx, width, height, preset, strength)
  }

  ctx.drawImage(_offscreen as CanvasImageSource, 0, 0)
}
