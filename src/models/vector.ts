import { clamp01 } from '../utils/clamp'

/**
 * Immutable 2D vector utilities for simulation math.
 */
export class Vector {
  readonly x: number
  readonly y: number

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }

  add(other: Vector): Vector {
    return new Vector(this.x + other.x, this.y + other.y)
  }

  subtract(other: Vector): Vector {
    return new Vector(this.x - other.x, this.y - other.y)
  }

  scale(scalar: number): Vector {
    return new Vector(this.x * scalar, this.y * scalar)
  }

  dot(other: Vector): number {
    return this.x * other.x + this.y * other.y
  }

  magnitude(): number {
    return Math.hypot(this.x, this.y)
  }

  /**
   * Unit vector, or (0, 0) if length is 0 (avoids NaNs).
   */
  normalize(): Vector {
    const len = this.magnitude()
    if (len === 0) return new Vector(0, 0)
    return new Vector(this.x / len, this.y / len)
  }

  clampToUnitSquare(): Vector {
    return new Vector(clamp01(this.x), clamp01(this.y))
  }

  static of(x: number, y: number): Vector {
    return new Vector(x, y)
  }

  static fromTuple(pair: readonly [number, number]): Vector {
    return new Vector(pair[0], pair[1])
  }

  static fromPlain(point: { readonly x: number; readonly y: number }): Vector {
    return new Vector(point.x, point.y)
  }
}
