import { clamp01 } from './clamp'

/**
 * Maps pointer coordinates to normalized canvas space [0, 1] using the
 * element’s CSS layout box (correct under Hi-DPI backing stores).
 */
export function pointerToNormalizedCanvas(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  if (w <= 0 || h <= 0) return { x: 0, y: 0 }
  return {
    x: clamp01((clientX - rect.left) / w),
    y: clamp01((clientY - rect.top) / h),
  }
}
