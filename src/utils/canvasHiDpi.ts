export const MAX_CANVAS_DEVICE_PIXEL_RATIO = 2

export type CssCanvasSize = {
  width: number
  height: number
}

export function readCssCanvasSize(container: HTMLElement): CssCanvasSize {
  return {
    width: Math.max(0, Math.floor(container.clientWidth)),
    height: Math.max(0, Math.floor(container.clientHeight)),
  }
}

/**
 * Sizes the bitmap and CSS box so 1 canvas unit ≈ 1 CSS pixel, scaled by DPR.
 */
export function layoutHiDpiCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
): void {
  const dpr = Math.min(
    window.devicePixelRatio ?? 1,
    MAX_CANVAS_DEVICE_PIXEL_RATIO,
  )
  canvas.width = Math.floor(cssWidth * dpr)
  canvas.height = Math.floor(cssHeight * dpr)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
