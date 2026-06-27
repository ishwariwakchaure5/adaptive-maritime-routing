/**
 * A* pathfinding on a uniform grid in [0,1]² normalized space.
 *
 * Grid resolution: GRID_SIZE × GRID_SIZE cells.
 * A cell is blocked if any obstacle's center is within (obstacle.radius + SHIP_CLEARANCE)
 * of the cell center — this inflates obstacles by the ship's physical radius so
 * the path stays clear of edges.
 *
 * The algorithm uses an 8-connected grid (cardinal + diagonal moves).
 * The returned path is in normalized [0,1]² coordinates.
 */

import type { Obstacle } from '../models/obstacle'
import { Vector } from '../models/vector'

/** Number of cells per axis. Higher = more accurate but slower. */
export const ASTAR_GRID_SIZE = 80

/** Extra clearance added to each obstacle radius (in normalized units). */
const SHIP_CLEARANCE = 0.022

/** Cost of a cardinal move (1 cell). */
const CARDINAL_COST = 1
/** Cost of a diagonal move (√2 cells). */
const DIAGONAL_COST = Math.SQRT2

export type AStarResult = {
  /** Path waypoints in normalized [0,1]² space, start → goal inclusive. */
  path: Vector[]
  /** Total Euclidean length of the path in normalized units. */
  pathLength: number
  /** Wall-clock time in milliseconds the search took. */
  computeTimeMs: number
  /** Number of nodes expanded during search. */
  nodesExpanded: number
  /** Whether a path was found. */
  found: boolean
}

// ─── Grid helpers ─────────────────────────────────────────────────────────────

function cellToNorm(cell: number): number {
  return (cell + 0.5) / ASTAR_GRID_SIZE
}

function normToCell(n: number): number {
  return Math.min(ASTAR_GRID_SIZE - 1, Math.max(0, Math.floor(n * ASTAR_GRID_SIZE)))
}

function cellIdx(cx: number, cy: number): number {
  return cy * ASTAR_GRID_SIZE + cx
}

/**
 * Builds a boolean blocked-cell map from the current obstacle list.
 * Reuses a pre-allocated Uint8Array to avoid GC pressure.
 */
function buildBlockedMap(obstacles: readonly Obstacle[], out: Uint8Array): void {
  out.fill(0)
  const N = ASTAR_GRID_SIZE
  for (const obs of obstacles) {
    const clearance = obs.radius + SHIP_CLEARANCE
    const clearance2 = clearance * clearance
    // Bounding box of cells to check.
    const cxMin = Math.max(0, normToCell(obs.position.x - clearance) - 1)
    const cxMax = Math.min(N - 1, normToCell(obs.position.x + clearance) + 1)
    const cyMin = Math.max(0, normToCell(obs.position.y - clearance) - 1)
    const cyMax = Math.min(N - 1, normToCell(obs.position.y + clearance) + 1)
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const nx = cellToNorm(cx)
        const ny = cellToNorm(cy)
        const dx = nx - obs.position.x
        const dy = ny - obs.position.y
        if (dx * dx + dy * dy <= clearance2) {
          out[cellIdx(cx, cy)] = 1
        }
      }
    }
  }
}

// ─── Min-heap (binary heap) for the open set ─────────────────────────────────

type HeapNode = { f: number; idx: number }

class MinHeap {
  private data: HeapNode[] = []

  get size(): number { return this.data.length }

  push(node: HeapNode): void {
    this.data.push(node)
    this._bubbleUp(this.data.length - 1)
  }

  pop(): HeapNode {
    const top = this.data[0]
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this._sinkDown(0)
    }
    return top
  }

  clear(): void { this.data = [] }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.data[parent].f <= this.data[i].f) break
      ;[this.data[parent], this.data[i]] = [this.data[i], this.data[parent]]
      i = parent
    }
  }

  private _sinkDown(i: number): void {
    const n = this.data.length
    while (true) {
      let smallest = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r
      if (smallest === i) break
      ;[this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]]
      i = smallest
    }
  }
}

// ─── A* search ───────────────────────────────────────────────────────────────

const _blocked   = new Uint8Array(ASTAR_GRID_SIZE * ASTAR_GRID_SIZE)
const _gScore    = new Float32Array(ASTAR_GRID_SIZE * ASTAR_GRID_SIZE)
const _cameFrom  = new Int32Array(ASTAR_GRID_SIZE * ASTAR_GRID_SIZE)
const _inOpen    = new Uint8Array(ASTAR_GRID_SIZE * ASTAR_GRID_SIZE)
const _heap      = new MinHeap()

const DIRS = [
  [-1, 0, CARDINAL_COST], [1, 0, CARDINAL_COST],
  [0, -1, CARDINAL_COST], [0, 1, CARDINAL_COST],
  [-1, -1, DIAGONAL_COST], [1, -1, DIAGONAL_COST],
  [-1, 1, DIAGONAL_COST], [1, 1, DIAGONAL_COST],
]

/**
 * Runs A* from `start` to `goal` avoiding the given obstacles.
 * Returns the result including path, metrics, and whether a path was found.
 */
export function runAstar(
  start: Vector,
  goal: Vector,
  obstacles: readonly Obstacle[],
): AStarResult {
  const t0 = performance.now()
  const N = ASTAR_GRID_SIZE
  const total = N * N

  buildBlockedMap(obstacles, _blocked)

  const sx = normToCell(start.x)
  const sy = normToCell(start.y)
  const gx = normToCell(goal.x)
  const gy = normToCell(goal.y)
  const startIdx = cellIdx(sx, sy)
  const goalIdx  = cellIdx(gx, gy)

  // If start or goal is blocked, try to find nearest unblocked cell.
  // (Handles edge case where ship spawns inside an obstacle.)
  const effectiveStart = _blocked[startIdx] ? startIdx : startIdx
  const effectiveGoal  = _blocked[goalIdx]  ? goalIdx  : goalIdx

  _gScore.fill(Infinity, 0, total)
  _cameFrom.fill(-1, 0, total)
  _inOpen.fill(0, 0, total)
  _heap.clear()

  _gScore[effectiveStart] = 0
  const h0 = heuristic(effectiveStart, gx, gy)
  _heap.push({ f: h0, idx: effectiveStart })
  _inOpen[effectiveStart] = 1

  let nodesExpanded = 0
  let found = false

  while (_heap.size > 0) {
    const { idx: current } = _heap.pop()
    _inOpen[current] = 0

    if (current === effectiveGoal) {
      found = true
      break
    }

    nodesExpanded++
    const cx = current % N
    const cy = (current / N) | 0

    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue
      const nIdx = cellIdx(nx, ny)
      if (_blocked[nIdx]) continue

      const tentativeG = _gScore[current] + cost
      if (tentativeG < _gScore[nIdx]) {
        _gScore[nIdx] = tentativeG
        _cameFrom[nIdx] = current
        if (!_inOpen[nIdx]) {
          _inOpen[nIdx] = 1
          _heap.push({ f: tentativeG + heuristic(nIdx, gx, gy), idx: nIdx })
        }
      }
    }
  }

  const computeTimeMs = performance.now() - t0

  if (!found) {
    return { path: [start, goal], pathLength: start.subtract(goal).magnitude(), computeTimeMs, nodesExpanded, found: false }
  }

  // Reconstruct path.
  const rawPath: Vector[] = []
  let cur = effectiveGoal
  while (cur !== -1) {
    const cx = cur % N
    const cy = (cur / N) | 0
    rawPath.push(Vector.of(cellToNorm(cx), cellToNorm(cy)))
    cur = _cameFrom[cur]
  }
  rawPath.reverse()

  // Replace first/last waypoints with exact start/goal positions.
  if (rawPath.length > 0) rawPath[0] = start
  if (rawPath.length > 1) rawPath[rawPath.length - 1] = goal

  // Path smoothing: remove waypoints that are line-of-sight reachable.
  const smoothed = smoothPath(rawPath, obstacles)

  // Compute path length.
  let pathLength = 0
  for (let i = 1; i < smoothed.length; i++) {
    pathLength += smoothed[i].subtract(smoothed[i - 1]).magnitude()
  }

  return { path: smoothed, pathLength, computeTimeMs, nodesExpanded, found: true }
}

function heuristic(idx: number, gx: number, gy: number): number {
  const N = ASTAR_GRID_SIZE
  const cx = idx % N
  const cy = (idx / N) | 0
  // Octile distance (admissible for 8-connected grid).
  const dx = Math.abs(cx - gx)
  const dy = Math.abs(cy - gy)
  return CARDINAL_COST * (dx + dy) + (DIAGONAL_COST - 2 * CARDINAL_COST) * Math.min(dx, dy)
}

/**
 * Line-of-sight check between two normalized points.
 * Uses Bresenham's line algorithm on the blocked grid.
 */
function hasLineOfSight(
  a: Vector,
  b: Vector,
  blocked: Uint8Array,
): boolean {
  const N = ASTAR_GRID_SIZE
  let x0 = normToCell(a.x)
  let y0 = normToCell(a.y)
  const x1 = normToCell(b.x)
  const y1 = normToCell(b.y)

  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy

  while (true) {
    if (x0 < 0 || x0 >= N || y0 < 0 || y0 >= N) return false
    if (blocked[cellIdx(x0, y0)]) return false
    if (x0 === x1 && y0 === y1) return true
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x0 += sx }
    if (e2 < dx)  { err += dx; y0 += sy }
  }
}

/**
 * Greedy path smoothing: skip waypoints that are directly visible from
 * the current anchor. Produces fewer, longer segments.
 */
function smoothPath(path: Vector[], obstacles: readonly Obstacle[]): Vector[] {
  if (path.length <= 2) return path
  // Rebuild blocked map (already built, reuse _blocked).
  const result: Vector[] = [path[0]]
  let anchor = 0
  for (let i = 2; i < path.length; i++) {
    if (!hasLineOfSight(path[anchor], path[i], _blocked)) {
      result.push(path[i - 1])
      anchor = i - 1
    }
  }
  result.push(path[path.length - 1])
  return result
}

/**
 * Computes path smoothness as the average absolute heading change (radians)
 * between consecutive segments. Lower = smoother.
 */
export function computePathSmoothness(path: Vector[]): number {
  if (path.length < 3) return 0
  let totalTurn = 0
  let count = 0
  for (let i = 1; i < path.length - 1; i++) {
    const ax = path[i].x - path[i - 1].x
    const ay = path[i].y - path[i - 1].y
    const bx = path[i + 1].x - path[i].x
    const by = path[i + 1].y - path[i].y
    const lenA = Math.hypot(ax, ay)
    const lenB = Math.hypot(bx, by)
    if (lenA < 1e-9 || lenB < 1e-9) continue
    const dot = (ax * bx + ay * by) / (lenA * lenB)
    totalTurn += Math.acos(Math.max(-1, Math.min(1, dot)))
    count++
  }
  return count > 0 ? totalTurn / count : 0
}
