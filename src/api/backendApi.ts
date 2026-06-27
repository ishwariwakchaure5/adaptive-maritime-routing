/**
 * Typed client for the C++ Crow path-planning backend.
 *
 * All coordinates are in normalized [0,1]² space matching the canvas.
 *
 * Three modes:
 *  1. fetchPath()       — POST /compute-path  — full path in one shot
 *  2. fetchStep()       — POST /simulate-step — one step at a time (HTTP)
 *  3. StepWebSocket     — WS  /ws             — one step per message (low latency)
 */

export const DEFAULT_BACKEND_URL = 'http://localhost:8080'

// ─── Shared types ─────────────────────────────────────────────────────────────

export type BackendObstacle = { x: number; y: number; radius: number }
export type BackendPathPoint = { x: number; y: number }

/**
 * Mutable navigation state round-tripped with every step request.
 * The server is stateless — the client owns this and sends it back each call.
 */
export type NavState = {
  headingX:          number
  headingY:          number
  stuckFrames:       number
  escapeX:           number
  escapeY:           number
  escapeInitialized: boolean
}

export function createNavState(goalDx = 1, goalDy = 0): NavState {
  const len = Math.hypot(goalDx, goalDy) || 1
  return {
    headingX:          goalDx / len,
    headingY:          goalDy / len,
    stuckFrames:       0,
    escapeX:           0,
    escapeY:           0,
    escapeInitialized: false,
  }
}

export type StepRequest = {
  ship:      { x: number; y: number }
  goal:      { x: number; y: number }
  obstacles: BackendObstacle[]
  navState?: NavState
  config?:   Record<string, number>
}

export type StepResponse = {
  position:    { x: number; y: number }
  navState:    NavState
  reachedGoal: boolean
  distToGoal:  number
}

// ─── Full-path endpoint ───────────────────────────────────────────────────────

export type BackendPathRequest = {
  ship:      { x: number; y: number }
  goal:      { x: number; y: number }
  obstacles: BackendObstacle[]
  algorithm?: 'vector_field' | 'astar' | 'both'
}

export type BackendPathResponse = {
  path:      BackendPathPoint[]
  algorithm: string
  steps:     number
  computeMs: number
}

export type BackendResult =
  | { ok: true;  data: BackendPathResponse }
  | { ok: false; error: string }

export async function fetchPath(
  req: BackendPathRequest,
  baseUrl = DEFAULT_BACKEND_URL,
  timeoutMs = 5000,
): Promise<BackendResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/compute-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) {
      let msg = `HTTP ${response.status}`
      try { const b = await response.json() as { error?: string }; if (b.error) msg = b.error } catch { /**/ }
      return { ok: false, error: msg }
    }
    const data = await response.json() as BackendPathResponse
    if (!Array.isArray(data.path) || data.path.length === 0)
      return { ok: false, error: 'Server returned an empty path.' }
    return { ok: true, data }
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError')
      return { ok: false, error: `Timed out after ${timeoutMs}ms. Is the server running?` }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Single-step HTTP endpoint ────────────────────────────────────────────────

export type StepResult =
  | { ok: true;  data: StepResponse }
  | { ok: false; error: string }

export async function fetchStep(
  req: StepRequest,
  baseUrl = DEFAULT_BACKEND_URL,
  timeoutMs = 2000,
): Promise<StepResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/simulate-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) {
      let msg = `HTTP ${response.status}`
      try { const b = await response.json() as { error?: string }; if (b.error) msg = b.error } catch { /**/ }
      return { ok: false, error: msg }
    }
    const data = await response.json() as StepResponse
    return { ok: true, data }
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof DOMException && err.name === 'AbortError')
      return { ok: false, error: `Step timed out after ${timeoutMs}ms.` }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── WebSocket step client ────────────────────────────────────────────────────

type StepCallback = (resp: StepResponse) => void
type ErrorCallback = (err: string) => void

/**
 * Manages a WebSocket connection to /ws for real-time step-by-step simulation.
 *
 * Usage:
 *   const ws = new StepWebSocket('ws://localhost:8080/ws')
 *   ws.onStep = (resp) => { ... move ship ... }
 *   ws.onError = (err) => { ... handle ... }
 *   ws.connect()
 *   ws.sendStep({ ship, goal, obstacles, navState })
 *   ws.close()
 */
export class StepWebSocket {
  private ws: WebSocket | null = null
  private readonly url: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _closed = false

  onStep:  StepCallback  = () => { /**/ }
  onError: ErrorCallback = () => { /**/ }
  onOpen:  () => void    = () => { /**/ }
  onClose: () => void    = () => { /**/ }

  constructor(baseUrl = DEFAULT_BACKEND_URL) {
    // Convert http(s):// → ws(s)://
    this.url = baseUrl.replace(/^http/, 'ws') + '/ws'
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    this._closed = false
    this._open()
  }

  private _open(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.onopen = () => {
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
      this.onOpen()
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as StepResponse & { error?: string }
        if (data.error) { this.onError(data.error); return }
        this.onStep(data)
      } catch {
        this.onError('Failed to parse server message.')
      }
    }

    ws.onerror = () => {
      this.onError('WebSocket error — check that the server is running.')
    }

    ws.onclose = () => {
      this.onClose()
      if (!this._closed) {
        // Auto-reconnect after 1 second.
        this.reconnectTimer = setTimeout(() => this._open(), 1000)
      }
    }
  }

  sendStep(req: StepRequest): void {
    if (!this.isOpen) return
    this.ws!.send(JSON.stringify(req))
  }

  close(): void {
    this._closed = true
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    this.ws?.close()
    this.ws = null
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkBackendHealth(
  baseUrl = DEFAULT_BACKEND_URL,
  timeoutMs = 3000,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    clearTimeout(timer)
    return false
  }
}
