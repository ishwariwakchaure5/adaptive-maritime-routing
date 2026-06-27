import type { VectorFieldConfig } from '../engine/vectorFieldNavigation'
import type { CurrentPresetName } from '../engine/oceanCurrents'
import type { SimulationScene } from '../engine/simulationScene'
import { SHIP_COLORS } from '../models/ship'
import { clamp01 } from '../utils/clamp'
import { drawVectorFieldOverlay } from './drawVectorFieldOverlay'
import { drawCurrentOverlay } from './drawCurrentOverlay'

const BACKGROUND = '#020617'

const OBSTACLE_FILL         = 'rgba(127, 29, 29, 0.85)'
const OBSTACLE_STROKE       = '#f87171'
const OBSTACLE_DRIFT_FILL   = 'rgba(109, 40, 80, 0.88)'
const OBSTACLE_DRIFT_STROKE = '#fb7185'
const DRIFT_ARROW_COLOR     = 'rgba(251, 113, 133, 0.75)'

/**
 * How many of the most-recent path points to render per ship.
 * 6000 matches MAX_PATH_POINTS in the step function so the entire
 * recorded path is always visible.
 */
const MAX_RENDERED_PATH_POINTS = 6000

// Chaikin produces ~2× points per pass. After 2 passes on 6000 input points
// the output can reach ~24000 floats. Size buffers accordingly.
const CHAIKIN_BUF_SIZE = MAX_RENDERED_PATH_POINTS * 4

// ─── Helpers ─────────────────────────────────────────────────────────────────

function n2c(v: number, size: number): number {
  return clamp01(v) * size
}

function fillStrokeCircle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number,
  fill: string, stroke: string,
): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2
  ctx.stroke()
}

function drawGoalDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  fill: string, stroke: string,
): void {
  ctx.beginPath()
  ctx.moveTo(cx,        cy - size)
  ctx.lineTo(cx + size, cy)
  ctx.lineTo(cx,        cy + size)
  ctx.lineTo(cx - size, cy)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = stroke
  ctx.lineWidth = 2
  ctx.stroke()
}

function drawDriftArrow(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rPx: number,
  vx: number, vy: number,
): void {
  const speed = Math.hypot(vx, vy)
  if (speed < 1e-12) return
  const ux = vx / speed
  const uy = vy / speed
  const arrowLen = rPx * 1.6
  const sx = cx + ux * rPx
  const sy = cy + uy * rPx
  const ex = sx + ux * arrowLen
  const ey = sy + uy * arrowLen
  const headLen = Math.max(4, arrowLen * 0.38)
  const angle = Math.atan2(uy, ux)

  ctx.save()
  ctx.strokeStyle = DRIFT_ARROW_COLOR
  ctx.fillStyle   = DRIFT_ARROW_COLOR
  ctx.lineWidth   = 1.5
  ctx.lineCap     = 'round'

  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(ex, ey)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// ─── Path smoothing ───────────────────────────────────────────────────────────

/**
 * Chaikin's corner-cutting algorithm — one pass.
 * Each segment [P0, P1] is replaced by two points at 25% and 75% along it.
 * Two passes produce visually smooth curves from the raw simulation path.
 * Input and output are flat [x0,y0, x1,y1, …] arrays for zero allocation.
 */
function chaikinPass(pts: Float32Array, count: number, out: Float32Array): number {
  if (count < 4) {
    out.set(pts.subarray(0, count))
    return count
  }
  // Keep first point.
  out[0] = pts[0]; out[1] = pts[1]
  let outIdx = 2
  for (let i = 0; i < count - 2; i += 2) {
    // Guard: stop if we'd overflow the output buffer.
    if (outIdx + 3 >= out.length) break
    const x0 = pts[i]; const y0 = pts[i + 1]
    const x1 = pts[i + 2]; const y1 = pts[i + 3]
    out[outIdx++] = 0.75 * x0 + 0.25 * x1
    out[outIdx++] = 0.75 * y0 + 0.25 * y1
    out[outIdx++] = 0.25 * x0 + 0.75 * x1
    out[outIdx++] = 0.25 * y0 + 0.75 * y1
  }
  // Keep last point.
  if (outIdx + 1 < out.length) {
    out[outIdx++] = pts[count - 2]
    out[outIdx++] = pts[count - 1]
  }
  return outIdx
}

// Reusable scratch buffers for Chaikin — sized for the expanded point count.
const _chaikinA = new Float32Array(CHAIKIN_BUF_SIZE)
const _chaikinB = new Float32Array(CHAIKIN_BUF_SIZE)

/**
 * Fills `_chaikinA` with the smoothed path and returns the point count (×2 for x,y).
 * Applies 2 passes of Chaikin corner-cutting.
 */
function buildSmoothedPath(
  path: readonly { x: number; y: number }[],
  start: number,
  width: number,
  height: number,
): number {
  const len = path.length - start
  if (len < 2) return 0

  // Load raw points into buffer A.
  for (let i = 0; i < len; i++) {
    _chaikinA[i * 2]     = n2c(path[start + i].x, width)
    _chaikinA[i * 2 + 1] = n2c(path[start + i].y, height)
  }

  // Pass 1: A → B
  const count1 = chaikinPass(_chaikinA, len * 2, _chaikinB)
  // Pass 2: B → A
  return chaikinPass(_chaikinB, count1, _chaikinA)
}

// ─── Public API ──────────────────────────────────────────────────────────────

// ─── A* path + metrics rendering ─────────────────────────────────────────────

/** Colors for A* path overlay — distinct from ship trail colors. */
const ASTAR_PATH_COLORS = [
  { path: 'rgba(250,204,21,0.75)',  dot: '#fde047' },  // yellow
  { path: 'rgba(167,243,208,0.75)', dot: '#6ee7b7' },  // mint
  { path: 'rgba(253,186,116,0.75)', dot: '#fdba74' },  // peach
  { path: 'rgba(196,181,253,0.75)', dot: '#c4b5fd' },  // lavender
] as const

function drawAstarPath(
  ctx: CanvasRenderingContext2D,
  path: readonly { x: number; y: number }[],
  width: number,
  height: number,
  colorIdx: number,
): void {
  if (path.length < 2) return
  const c = ASTAR_PATH_COLORS[colorIdx % ASTAR_PATH_COLORS.length]

  ctx.save()
  ctx.setLineDash([6, 5])
  ctx.strokeStyle = c.path
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  ctx.moveTo(n2c(path[0].x, width), n2c(path[0].y, height))
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(n2c(path[i].x, width), n2c(path[i].y, height))
  }
  ctx.stroke()
  ctx.setLineDash([])

  // Draw waypoint dots.
  ctx.fillStyle = c.dot
  for (let i = 1; i < path.length - 1; i++) {
    ctx.beginPath()
    ctx.arc(n2c(path[i].x, width), n2c(path[i].y, height), 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawMetricsPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: SimulationScene,
): void {
  const panelW = 230
  const rowH   = 18
  const shipCount = scene.ships.length
  // 1 header row + 3 metric rows per ship × 2 algorithms + 1 gap row between ships
  const rows = 1 + shipCount * 7
  const panelH = rows * rowH + 20
  const px = width - panelW - 12
  const py = 12

  ctx.save()

  // Panel background.
  ctx.fillStyle = 'rgba(2,6,23,0.88)'
  ctx.strokeStyle = 'rgba(100,116,139,0.5)'
  ctx.lineWidth = 1
  roundRect(ctx, px, py, panelW, panelH, 8)
  ctx.fill()
  ctx.stroke()

  ctx.font = 'bold 11px ui-monospace, monospace'
  ctx.fillStyle = '#94a3b8'
  ctx.fillText('ALGORITHM COMPARISON', px + 10, py + 16)

  let y = py + 32

  for (let i = 0; i < scene.ships.length; i++) {
    const agent = scene.ships[i]
    const vf = agent.comparison.vfMetrics
    const as = agent.comparison.astarMetrics
    const shipColor = SHIP_COLORS[agent.colorIndex].fill
    const astarColor = ASTAR_PATH_COLORS[i % ASTAR_PATH_COLORS.length].dot

    // Ship label.
    ctx.font = 'bold 10px ui-monospace, monospace'
    ctx.fillStyle = shipColor
    ctx.fillText(`Ship ${i + 1}`, px + 10, y)
    y += rowH

    // Column headers.
    ctx.font = '9px ui-monospace, monospace'
    ctx.fillStyle = '#64748b'
    ctx.fillText('Metric', px + 10, y)
    ctx.fillStyle = '#22d3ee'
    ctx.fillText('VF', px + 120, y)
    ctx.fillStyle = astarColor
    ctx.fillText('A*', px + 175, y)
    y += rowH

    // Path length.
    ctx.fillStyle = '#cbd5e1'
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillText('Length', px + 10, y)
    ctx.fillStyle = '#22d3ee'
    ctx.fillText(vf.pathLength > 0 ? vf.pathLength.toFixed(3) : '—', px + 110, y)
    ctx.fillStyle = astarColor
    ctx.fillText(as.pathLength > 0 ? as.pathLength.toFixed(3) : '—', px + 165, y)
    y += rowH

    // Time.
    ctx.fillStyle = '#cbd5e1'
    ctx.fillText('Time (ms)', px + 10, y)
    ctx.fillStyle = '#22d3ee'
    ctx.fillText(vf.computeTimeMs > 0 ? vf.computeTimeMs.toFixed(0) : '—', px + 110, y)
    ctx.fillStyle = astarColor
    ctx.fillText(as.computeTimeMs > 0 ? as.computeTimeMs.toFixed(1) : '—', px + 165, y)
    y += rowH

    // Smoothness (lower = smoother).
    ctx.fillStyle = '#cbd5e1'
    ctx.fillText('Smoothness↓', px + 10, y)
    ctx.fillStyle = '#22d3ee'
    ctx.fillText(vf.smoothness > 0 ? vf.smoothness.toFixed(3) : '—', px + 110, y)
    ctx.fillStyle = astarColor
    ctx.fillText(as.smoothness > 0 ? as.smoothness.toFixed(3) : '—', px + 165, y)
    y += rowH

    // Status badges.
    ctx.fillStyle = vf.completed ? '#4ade80' : '#f87171'
    ctx.fillText(vf.completed ? '✓ Done' : '● Running', px + 110, y)
    ctx.fillStyle = as.completed ? '#4ade80' : '#94a3b8'
    ctx.fillText(as.completed ? '✓ Done' : '— Static', px + 165, y)
    y += rowH + 6
  }

  ctx.restore()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * Draws the backend status badge (top-centre of canvas):
 * - Spinning "Fetching…" indicator while the request is in-flight.
 * - Green "Backend ✓" badge once waypoints are loaded.
 * - Red error message if the fetch failed.
 * Also draws the planned waypoint path as a faint dotted line so the user
 * can see the route before the ship starts moving.
 */
function drawBackendStatus(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: SimulationScene,
  states: Array<{ fetching: boolean; error: string | null; waypoints: { x: number; y: number }[] }>,
): void {
  if (states.length === 0) return

  ctx.save()

  // ── Planned waypoint paths ────────────────────────────────────────────────
  for (let i = 0; i < states.length && i < scene.ships.length; i++) {
    const bs = states[i]
    if (bs.waypoints.length < 2) continue
    const colors = SHIP_COLORS[scene.ships[i].colorIndex]

    ctx.save()
    ctx.setLineDash([4, 6])
    ctx.strokeStyle = colors.path
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.moveTo(n2c(bs.waypoints[0].x, width), n2c(bs.waypoints[0].y, height))
    for (let j = 1; j < bs.waypoints.length; j++) {
      ctx.lineTo(n2c(bs.waypoints[j].x, width), n2c(bs.waypoints[j].y, height))
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  // ── Status badge (top-centre) ─────────────────────────────────────────────
  const anyFetching = states.some((s) => s.fetching)
  const errors      = states.map((s) => s.error).filter(Boolean) as string[]
  const allLoaded   = states.every((s) => !s.fetching && s.waypoints.length > 0 && !s.error)

  let label: string
  let bg: string
  let fg: string

  if (anyFetching) {
    label = '⟳  Fetching path from backend…'
    bg    = 'rgba(30,58,138,0.88)'
    fg    = '#93c5fd'
  } else if (errors.length > 0) {
    label = `✕  ${errors[0]}`
    bg    = 'rgba(127,29,29,0.92)'
    fg    = '#fca5a5'
  } else if (allLoaded) {
    label = `✓  Backend path loaded (${states[0].waypoints.length} waypoints)`
    bg    = 'rgba(6,78,59,0.88)'
    fg    = '#6ee7b7'
  } else {
    ctx.restore()
    return
  }

  ctx.font = '12px ui-monospace, monospace'
  const textW = ctx.measureText(label).width
  const padX  = 14
  const padY  = 8
  const bw    = textW + padX * 2
  const bh    = 28
  const bx    = (width - bw) / 2
  const by    = 10

  ctx.fillStyle = bg
  roundRect(ctx, bx, by, bw, bh, 6)
  ctx.fill()

  ctx.fillStyle = fg
  ctx.fillText(label, bx + padX, by + bh / 2 + 4)

  ctx.restore()
}

export type SimulationDrawOptions = {
  showVectorField: boolean
  vectorFieldConfig: VectorFieldConfig
  obstaclesDrift: boolean
  currentsEnabled: boolean
  currentStrength: number
  currentPreset: CurrentPresetName
  comparisonMode: boolean
  backendMode: boolean
  backendStates: Array<{ fetching: boolean; error: string | null; waypoints: { x: number; y: number }[] }>
}

export function drawSimulationScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scene: SimulationScene,
  drawOptions: SimulationDrawOptions,
): void {
  ctx.save()

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, width, height)

  // ── Ocean current overlay (drawn first, under everything) ─────────────────
  if (drawOptions.currentsEnabled) {
    drawCurrentOverlay(ctx, width, height, drawOptions.currentPreset, drawOptions.currentStrength)
  }

  // ── Vector field overlay (throttled internally) ───────────────────────────
  if (drawOptions.showVectorField && scene.ships.length > 0) {
    drawVectorFieldOverlay(ctx, width, height, scene, drawOptions.vectorFieldConfig)
  }

  const scale = Math.min(width, height)
  const shipRadius = Math.max(6, scale * 0.018)
  const goalSize   = Math.max(7, scale * 0.022)

  ctx.lineJoin = 'round'
  ctx.lineCap  = 'round'

  // ── Path trails (Chaikin-smoothed) ───────────────────────────────────────
  for (const agent of scene.ships) {
    const path = agent.ship.pathHistory
    if (path.length < 2) continue

    const start = Math.max(0, path.length - MAX_RENDERED_PATH_POINTS)
    const colors = SHIP_COLORS[agent.colorIndex]

    const smoothCount = buildSmoothedPath(path, start, width, height)
    if (smoothCount < 4) continue

    ctx.beginPath()
    ctx.moveTo(_chaikinA[0], _chaikinA[1])
    for (let i = 2; i < smoothCount; i += 2) {
      ctx.lineTo(_chaikinA[i], _chaikinA[i + 1])
    }
    ctx.strokeStyle = colors.path
    ctx.lineWidth = 2
    ctx.stroke()
  }

  // ── A* paths (comparison mode) ────────────────────────────────────────────
  if (drawOptions.comparisonMode) {
    for (let i = 0; i < scene.ships.length; i++) {
      const agent = scene.ships[i]
      if (agent.comparison.astarPath.length >= 2) {
        drawAstarPath(ctx, agent.comparison.astarPath, width, height, i)
      }
    }
  }

  // ── Obstacles ─────────────────────────────────────────────────────────────
  // Draw ALL obstacles unconditionally as filled circles, then overlay drift
  // arrows on top for drifting ones. This ensures nothing is skipped.
  const driftEnabled = drawOptions.obstaclesDrift

  for (const obs of scene.obstacles) {
    const ox = n2c(obs.position.x, width)
    const oy = n2c(obs.position.y, height)
    const rPx = Math.max(6, obs.radius * scale)
    const isDrifting = driftEnabled && (obs.velocity.x !== 0 || obs.velocity.y !== 0)

    fillStrokeCircle(
      ctx, ox, oy, rPx,
      isDrifting ? OBSTACLE_DRIFT_FILL   : OBSTACLE_FILL,
      isDrifting ? OBSTACLE_DRIFT_STROKE : OBSTACLE_STROKE,
    )

    if (isDrifting) {
      drawDriftArrow(ctx, ox, oy, rPx, obs.velocity.x, obs.velocity.y)
    }
  }

  // ── Goals (diamonds) ──────────────────────────────────────────────────────
  for (const agent of scene.ships) {
    const colors = SHIP_COLORS[agent.colorIndex]
    const gx = n2c(agent.goal.x, width)
    const gy = n2c(agent.goal.y, height)
    ctx.globalAlpha = agent.reachedGoal ? 0.35 : 1
    drawGoalDiamond(ctx, gx, gy, goalSize, colors.fill, colors.stroke)
  }
  ctx.globalAlpha = 1

  // ── Ships ─────────────────────────────────────────────────────────────────
  for (const agent of scene.ships) {
    const colors = SHIP_COLORS[agent.colorIndex]
    const sx = n2c(agent.ship.position.x, width)
    const sy = n2c(agent.ship.position.y, height)
    ctx.globalAlpha = agent.reachedGoal ? 0.45 : 1
    fillStrokeCircle(ctx, sx, sy, shipRadius, colors.fill, colors.stroke)
  }
  ctx.globalAlpha = 1

  // ── Comparison metrics panel ──────────────────────────────────────────────
  if (drawOptions.comparisonMode) {
    drawMetricsPanel(ctx, width, height, scene)
  }

  // ── Backend status overlay ────────────────────────────────────────────────
  if (drawOptions.backendMode) {
    drawBackendStatus(ctx, width, height, scene, drawOptions.backendStates)
  }

  ctx.restore()
}
