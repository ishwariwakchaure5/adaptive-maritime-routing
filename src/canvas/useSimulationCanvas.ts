import { useEffect, useLayoutEffect, useRef } from 'react'
import { applySceneFromControls } from '../engine/applySceneFromControls'
import {
  createSimulationScene,
  MAX_OBSTACLE_COUNT,
  POINTER_PLACED_OBSTACLE_RADIUS,
  type SimulationScene,
} from '../engine/simulationScene'
import { stepVectorFieldSimulation } from '../engine/stepVectorFieldSimulation'
import {
  mergeVectorFieldConfig,
  NORMALIZED_VECTOR_FIELD_PRESET,
} from '../engine/vectorFieldNavigation'
import { randomDriftVelocity } from '../engine/obstacleMotion'
import { createObstacle } from '../models/obstacle'
import { Vector } from '../models/vector'
import type { SimulationRuntimePayload } from '../simulation/simulationRuntime'
import type { SavedObstacle } from '../simulation/scenePersistence'
import {
  StepWebSocket,
  fetchStep,
  createNavState,
  type NavState,
  type StepResponse,
} from '../api/backendApi'
import { layoutHiDpiCanvas, readCssCanvasSize } from '../utils/canvasHiDpi'
import { pointerToNormalizedCanvas } from '../utils/canvasPointer'
import { drawSimulationScene } from './drawSimulation'
import { updateShipAnalytics } from '../engine/analytics'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SceneHandle = {
  getObstacles: () => Array<{ x: number; y: number; radius: number; vx: number; vy: number }>
  getShipPositions: () => Array<{ posX: number; posY: number; goalX: number; goalY: number }>
  loadObstacles: (obstacles: SavedObstacle[]) => void
  getAnalytics: () => Array<{
    distanceToGoal: number
    totalPathLength: number
    elapsedTimeMs: number
    avoidanceEvents: number
    completed: boolean
    colorIndex: number
  }>
}

// ─── Per-ship real-time backend state ─────────────────────────────────────────

type RealtimeShipState = {
  /** Mutable nav state round-tripped with every step request. */
  navState: NavState
  /** Whether a step request is currently in-flight (HTTP mode). */
  pendingStep: boolean
  /** Latest position received from the server (applied next RAF frame). */
  pendingPosition: { x: number; y: number } | null
  /** Whether the server says the goal has been reached. */
  reachedGoal: boolean
  /** Error from the last step, or null. */
  error: string | null
  /** Status label shown in the canvas overlay. */
  status: 'idle' | 'fetching' | 'running' | 'done' | 'error'
}

function createRealtimeShipState(goalDx = 1, goalDy = 0): RealtimeShipState {
  return {
    navState:        createNavState(goalDx, goalDy),
    pendingStep:     false,
    pendingPosition: null,
    reachedGoal:     false,
    error:           null,
    status:          'idle',
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSimulationCanvas(
  getRuntimePayload: () => SimulationRuntimePayload,
) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const sceneRef      = useRef<SimulationScene | null>(null)
  const getPayloadRef = useRef(getRuntimePayload)

  // Real-time backend state — one entry per ship.
  const rtStatesRef = useRef<RealtimeShipState[]>([])

  // Shared WebSocket — one connection for all ships (multiplexed by ship index).
  const wsRef = useRef<StepWebSocket | null>(null)

  // Track previous running/backendMode to detect edges.
  const wasRunningRef = useRef(false)
  const wasBackendRef = useRef(false)

  useEffect(() => {
    getPayloadRef.current = getRuntimePayload
  }, [getRuntimePayload])

  // ── Stable scene handle ───────────────────────────────────────────────────
  const sceneHandleRef = useRef<SceneHandle>({
    getObstacles: () => {
      const s = sceneRef.current; if (!s) return []
      return s.obstacles.map((o) => ({ x: o.position.x, y: o.position.y, radius: o.radius, vx: o.velocity.x, vy: o.velocity.y }))
    },
    getShipPositions: () => {
      const s = sceneRef.current; if (!s) return []
      return s.ships.map((a) => ({ posX: a.ship.position.x, posY: a.ship.position.y, goalX: a.goal.x, goalY: a.goal.y }))
    },
    loadObstacles: (obstacles: SavedObstacle[]) => {
      const s = sceneRef.current; if (!s) return
      s.obstacles.length = 0
      for (const o of obstacles)
        s.obstacles.push(createObstacle(Vector.of(o.x, o.y), o.radius, Vector.of(o.vx, o.vy)))
    },
    getAnalytics: () => {
      const s = sceneRef.current; if (!s) return []
      return s.ships.map((a) => ({
        distanceToGoal:  a.analytics.distanceToGoal,
        totalPathLength: a.analytics.totalPathLength,
        elapsedTimeMs:   a.analytics.elapsedTimeMs,
        avoidanceEvents: a.analytics.avoidanceEvents,
        completed:       a.analytics.completed,
        colorIndex:      a.colorIndex,
      }))
    },
  })

  // ── Main canvas loop ──────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const scene = createSimulationScene()
    sceneRef.current = scene

    let rafHandle    = 0
    let lastTime     = performance.now()
    let lastResetNonce = -1

    const resize = () => {
      const { width, height } = readCssCanvasSize(container)
      layoutHiDpiCanvas(canvas, ctx, width, height)
    }

    // ── Apply a step response to a ship ───────────────────────────────────
    const applyStepResponse = (shipIdx: number, resp: StepResponse) => {
      const agent = scene.ships[shipIdx]
      const rs    = rtStatesRef.current[shipIdx]
      if (!agent || !rs) return

      rs.navState        = resp.navState
      rs.pendingPosition = resp.position
      rs.reachedGoal     = resp.reachedGoal
      rs.status          = resp.reachedGoal ? 'done' : 'running'
    }

    // ── WebSocket setup ───────────────────────────────────────────────────
    const setupWebSocket = (rt: SimulationRuntimePayload) => {
      if (wsRef.current) wsRef.current.close()

      const ws = new StepWebSocket(rt.backendUrl)

      // Track which ship each outgoing message belongs to.
      // Messages are ordered, so a FIFO queue is correct.
      const pendingQueue: number[] = []

      ws.onOpen = () => {
        // Send the first step for each ship immediately on connect.
        scene.ships.forEach((agent, i) => {
          const rs = rtStatesRef.current[i]
          if (!rs || rs.reachedGoal) return
          rs.status = 'running'
          pendingQueue.push(i)
          ws.sendStep({
            ship:      { x: agent.ship.position.x, y: agent.ship.position.y },
            goal:      { x: agent.goal.x,          y: agent.goal.y },
            obstacles: scene.obstacles.map((o) => ({ x: o.position.x, y: o.position.y, radius: o.radius })),
            navState:  rs.navState,
          })
        })
      }

      ws.onStep = (resp) => {
        const shipIdx = pendingQueue.shift()
        if (shipIdx === undefined) return
        applyStepResponse(shipIdx, resp)

        // Immediately queue the next step for this ship (pipelining).
        const agent = scene.ships[shipIdx]
        const rs    = rtStatesRef.current[shipIdx]
        if (!agent || !rs || rs.reachedGoal) return

        const rt2 = getPayloadRef.current()
        if (!rt2.running || !rt2.backendMode) return

        pendingQueue.push(shipIdx)
        ws.sendStep({
          ship:      { x: agent.ship.position.x, y: agent.ship.position.y },
          goal:      { x: agent.goal.x,          y: agent.goal.y },
          obstacles: scene.obstacles.map((o) => ({ x: o.position.x, y: o.position.y, radius: o.radius })),
          navState:  rs.navState,
        })
      }

      ws.onError = (err) => {
        rtStatesRef.current.forEach((rs) => { rs.error = err; rs.status = 'error' })
      }

      ws.connect()
      wsRef.current = ws
    }

    // ── Send next WS step for a ship ──────────────────────────────────────
    // No-op in the new pipelined design — steps are sent from onStep callback.
    const sendNextWsStep = (_shipIdx: number) => { /* handled in onStep */ }

    // ── HTTP fallback: fire-and-forget step ───────────────────────────────
    const sendHttpStep = (shipIdx: number, rt: SimulationRuntimePayload) => {
      const agent = scene.ships[shipIdx]
      const rs    = rtStatesRef.current[shipIdx]
      if (!agent || !rs || rs.pendingStep || rs.reachedGoal) return

      rs.pendingStep = true
      rs.status      = 'fetching'

      fetchStep(
        {
          ship:      { x: agent.ship.position.x, y: agent.ship.position.y },
          goal:      { x: agent.goal.x,          y: agent.goal.y },
          obstacles: scene.obstacles.map((o) => ({ x: o.position.x, y: o.position.y, radius: o.radius })),
          navState:  rs.navState,
        },
        rt.backendUrl,
      ).then((result) => {
        rs.pendingStep = false
        if (result.ok) {
          applyStepResponse(shipIdx, result.data)
        } else {
          rs.error  = result.error
          rs.status = 'error'
        }
      })
    }

    // ── Apply pending position to ship (called every RAF frame) ──────────
    const flushPendingPosition = (shipIdx: number) => {
      const agent = scene.ships[shipIdx]
      const rs    = rtStatesRef.current[shipIdx]
      if (!agent || !rs || !rs.pendingPosition) return

      const prev = agent.ship.position
      const next = rs.pendingPosition
      rs.pendingPosition = null

      agent.ship.position = Vector.of(next.x, next.y)
      agent.ship.velocity = Vector.of(next.x - prev.x, next.y - prev.y)

      const moved = agent.ship.velocity
      if (moved.x * moved.x + moved.y * moved.y >= 9e-8) {
        agent.ship.pathHistory.push(agent.ship.position)
        if (agent.ship.pathHistory.length > 6000) agent.ship.pathHistory.splice(0, 64)
      }

      if (rs.reachedGoal) {
        agent.reachedGoal   = true
        agent.ship.position = agent.goal
        agent.ship.velocity = Vector.of(0, 0)
        agent.ship.pathHistory.push(agent.goal)
      }

      updateShipAnalytics(
        agent.analytics,
        agent.ship.position.x, agent.ship.position.y,
        agent.goal.x, agent.goal.y,
        0, 0,
        agent.reachedGoal,
      )
    }

    // ── RAF loop ──────────────────────────────────────────────────────────
    const runFrame = (now: number) => {
      rafHandle = requestAnimationFrame(runFrame)
      const { width, height } = readCssCanvasSize(container)
      if (width === 0 || height === 0) return

      const rt = getPayloadRef.current()

      // Reset on nonce change.
      if (rt.resetNonce !== lastResetNonce) {
        applySceneFromControls(scene, rt)
        lastResetNonce = rt.resetNonce
        // Reset per-ship realtime state.
        rtStatesRef.current = scene.ships.map((agent) => {
          const dx = agent.goal.x - agent.ship.position.x
          const dy = agent.goal.y - agent.ship.position.y
          return createRealtimeShipState(dx, dy)
        })
        // Close any open WebSocket on reset.
        wsRef.current?.close()
        wsRef.current = null
        wasRunningRef.current = false
      }

      // Live-update goals.
      for (let i = 0; i < rt.ships.length && i < scene.ships.length; i++) {
        const cfg = rt.ships[i]
        scene.ships[i].goal = Vector.of(cfg.goalX, cfg.goalY).clampToUnitSquare()
      }

      const dt        = Math.min((now - lastTime) / 1000, 0.05)
      lastTime        = now

      const justStarted = rt.running && !wasRunningRef.current
      wasRunningRef.current = rt.running

      if (rt.backendMode) {
        // ── Real-time backend mode ──────────────────────────────────────────
        if (justStarted || (rt.running && !wasBackendRef.current)) {
          // Try WebSocket first; HTTP fallback happens automatically if WS fails.
          setupWebSocket(rt)
        }

        if (rt.running) {
          const useWs = wsRef.current?.isOpen ?? false

          for (let i = 0; i < scene.ships.length; i++) {
            const rs = rtStatesRef.current[i]
            if (!rs || rs.reachedGoal) continue

            // Apply any position the server sent since last frame.
            flushPendingPosition(i)

            if (!useWs) {
              // HTTP fallback: fire a new step request if none is in-flight.
              sendHttpStep(i, rt)
            }
            // WS mode: steps are pipelined automatically in onStep callback.
          }
        }
      } else {
        // ── Local mode ──────────────────────────────────────────────────────
        // Close WebSocket if we switched away from backend mode.
        if (wasBackendRef.current) {
          wsRef.current?.close()
          wsRef.current = null
        }

        stepVectorFieldSimulation(scene, dt, {
          running:         rt.running,
          kAtt:            rt.kAtt,
          kRep:            rt.kRep,
          stepSize:        rt.stepSize,
          obstaclesDrift:  rt.obstaclesDrift,
          driftSpeedScale: rt.driftSpeedScale,
          currentsEnabled: rt.currentsEnabled,
          currentStrength: rt.currentStrength,
          currentPreset:   rt.currentPreset,
          comparisonMode:  rt.comparisonMode,
        })
      }

      wasBackendRef.current = rt.backendMode

      const vectorFieldConfig = mergeVectorFieldConfig({
        ...NORMALIZED_VECTOR_FIELD_PRESET,
        kAtt: rt.kAtt,
        kRep: rt.kRep,
      })

      // Build backendStates for the draw overlay.
      const backendStates = rtStatesRef.current.map((rs) => ({
        fetching:  rs.status === 'fetching' || rs.status === 'idle',
        error:     rs.error,
        waypoints: [] as { x: number; y: number }[],
        status:    rs.status,
      }))

      drawSimulationScene(ctx, width, height, scene, {
        showVectorField:  rt.showVectorField,
        vectorFieldConfig,
        obstaclesDrift:   rt.obstaclesDrift,
        currentsEnabled:  rt.currentsEnabled,
        currentStrength:  rt.currentStrength,
        currentPreset:    rt.currentPreset,
        comparisonMode:   rt.comparisonMode,
        backendMode:      rt.backendMode,
        backendStates,
      })
    }

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()
    lastTime  = performance.now()
    rafHandle = requestAnimationFrame(runFrame)

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const { x, y } = pointerToNormalizedCanvas(canvas, event.clientX, event.clientY)
      if (scene.obstacles.length >= MAX_OBSTACLE_COUNT) return
      scene.obstacles.push(
        createObstacle(Vector.of(x, y), POINTER_PLACED_OBSTACLE_RADIUS, randomDriftVelocity()),
      )
    }

    canvas.addEventListener('pointerdown', handlePointerDown)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      cancelAnimationFrame(rafHandle)
      ro.disconnect()
      wsRef.current?.close()
      wsRef.current = null
      sceneRef.current = null
    }
  }, [])

  return { containerRef, canvasRef, sceneHandle: sceneHandleRef }
}
