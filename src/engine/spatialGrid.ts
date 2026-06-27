/**
 * Uniform spatial grid for fast nearest-neighbour / radius queries.
 *
 * The simulation space is [0, 1]² in both axes. The grid divides it into
 * CELL_COUNT × CELL_COUNT cells. Each cell stores the indices of obstacles
 * whose centres fall inside it.
 *
 * Usage pattern (per frame):
 *   1. Call `build(obstacles)` once after obstacles have moved.
 *   2. Call `queryRadius(px, py, radius, out)` for each query point.
 *      Results are written into the caller-supplied `out` array to avoid
 *      per-query heap allocation.
 *
 * Design notes:
 * - All internal storage is pre-allocated flat typed arrays — no GC pressure
 *   in the hot path.
 * - CELL_COUNT = 8 gives cells of width 0.125. With influenceRadius = 0.24
 *   we need to check at most a 4×4 neighbourhood (ceil(0.24/0.125)+1 = 3
 *   cells each side), which is 16 cells vs 96 obstacles — ~6× fewer checks
 *   on average when obstacles are spread out.
 */

import type { Obstacle } from '../models/obstacle'

export const GRID_CELL_COUNT = 8
const INV_CELL = GRID_CELL_COUNT // multiply instead of divide

/**
 * Maximum obstacles the grid can hold. Must be ≥ MAX_OBSTACLE_COUNT (96).
 * Sized generously so we never need to resize.
 */
const MAX_ITEMS = 256

/**
 * Maximum items returned per radius query.
 * Sized to hold all obstacles in the worst case.
 */
export const QUERY_RESULT_CAPACITY = MAX_ITEMS

export class SpatialGrid {
  /** Flat cell → obstacle-index list, stored as a 2D array of fixed-size buckets. */
  private readonly buckets: Int16Array
  /** Number of items currently in each bucket. */
  private readonly counts: Uint8Array
  /** Max items per bucket before overflow (silently ignored). */
  private readonly bucketCapacity: number

  constructor(bucketCapacity = 32) {
    this.bucketCapacity = bucketCapacity
    const totalCells = GRID_CELL_COUNT * GRID_CELL_COUNT
    this.buckets = new Int16Array(totalCells * bucketCapacity).fill(-1)
    this.counts = new Uint8Array(totalCells)
  }

  /** Clears all cells and re-inserts every obstacle. O(N). */
  build(obstacles: readonly Obstacle[]): void {
    this.counts.fill(0)
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i]
      const cx = Math.min(GRID_CELL_COUNT - 1, (o.position.x * INV_CELL) | 0)
      const cy = Math.min(GRID_CELL_COUNT - 1, (o.position.y * INV_CELL) | 0)
      const cell = cy * GRID_CELL_COUNT + cx
      const count = this.counts[cell]
      if (count < this.bucketCapacity) {
        this.buckets[cell * this.bucketCapacity + count] = i
        this.counts[cell]++
      }
    }
  }

  /**
   * Writes indices of all obstacles within `radius` of (px, py) into `out`.
   * Returns the number of results written.
   * Does NOT allocate — caller owns `out`.
   */
  queryRadius(
    px: number,
    py: number,
    radius: number,
    obstacles: readonly Obstacle[],
    out: Int16Array,
  ): number {
    const r2 = radius * radius
    let count = 0

    // Cell range to check (expand by 1 cell to handle boundary obstacles).
    const cellRadius = Math.ceil(radius * INV_CELL)
    const cxCenter = Math.min(GRID_CELL_COUNT - 1, (px * INV_CELL) | 0)
    const cyCenter = Math.min(GRID_CELL_COUNT - 1, (py * INV_CELL) | 0)

    const cxMin = Math.max(0, cxCenter - cellRadius)
    const cxMax = Math.min(GRID_CELL_COUNT - 1, cxCenter + cellRadius)
    const cyMin = Math.max(0, cyCenter - cellRadius)
    const cyMax = Math.min(GRID_CELL_COUNT - 1, cyCenter + cellRadius)

    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const cell = cy * GRID_CELL_COUNT + cx
        const n = this.counts[cell]
        const base = cell * this.bucketCapacity
        for (let k = 0; k < n; k++) {
          const idx = this.buckets[base + k]
          const o = obstacles[idx]
          const dx = o.position.x - px
          const dy = o.position.y - py
          if (dx * dx + dy * dy < r2) {
            if (count < out.length) out[count++] = idx
          }
        }
      }
    }
    return count
  }
}
