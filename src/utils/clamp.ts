export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
