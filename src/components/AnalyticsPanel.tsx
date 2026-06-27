/**
 * Real-time analytics overlay panel.
 *
 * Reads live data from the canvas SceneHandle via requestAnimationFrame —
 * no React state updates on every frame, just direct DOM writes for the
 * values that change. This keeps the panel smooth without triggering
 * React re-renders at 60fps.
 */

import { useEffect, useRef, type MutableRefObject } from 'react'
import { SHIP_COLORS } from '../models/ship'
import type { SceneHandle } from '../canvas/useSimulationCanvas'

type Props = {
  sceneHandle: MutableRefObject<SceneHandle>
  running: boolean
}

function fmt(n: number, decimals = 3): string {
  return n.toFixed(decimals)
}

function fmtTime(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function AnalyticsPanel({ sceneHandle, running }: Props) {
  // One ref per ship × per metric — direct DOM writes, no React state.
  const rowRefs = useRef<Array<{
    dist: HTMLSpanElement | null
    length: HTMLSpanElement | null
    time: HTMLSpanElement | null
    avoid: HTMLSpanElement | null
    status: HTMLSpanElement | null
  }>>([])

  const rafRef = useRef(0)

  useEffect(() => {
    const update = () => {
      rafRef.current = requestAnimationFrame(update)
      const data = sceneHandle.current.getAnalytics()

      // Grow row refs array if ships were added.
      while (rowRefs.current.length < data.length) {
        rowRefs.current.push({ dist: null, length: null, time: null, avoid: null, status: null })
      }

      for (let i = 0; i < data.length; i++) {
        const row = rowRefs.current[i]
        const d = data[i]
        if (!row) continue
        if (row.dist)   row.dist.textContent   = fmt(d.distanceToGoal)
        if (row.length) row.length.textContent = fmt(d.totalPathLength)
        if (row.time)   row.time.textContent   = fmtTime(d.elapsedTimeMs)
        if (row.avoid)  row.avoid.textContent  = String(d.avoidanceEvents)
        if (row.status) {
          row.status.textContent = d.completed ? '✓ Arrived' : running ? '● Moving' : '— Paused'
          row.status.className = d.completed
            ? 'font-medium text-emerald-400'
            : running
              ? 'font-medium text-amber-300'
              : 'font-medium text-slate-500'
        }
      }
    }

    rafRef.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafRef.current)
  }, [sceneHandle, running])

  // We render the structural shell in React (ship count can change),
  // but values are written imperatively via refs.
  const data = sceneHandle.current.getAnalytics()

  // Ensure rowRefs is sized correctly on first render.
  while (rowRefs.current.length < data.length) {
    rowRefs.current.push({ dist: null, length: null, time: null, avoid: null, status: null })
  }

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 z-10 w-64 rounded-xl border border-slate-700/60 bg-slate-950/90 shadow-xl backdrop-blur-sm"
      aria-label="Real-time analytics"
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
          Live Analytics
        </span>
      </div>

      <div className="flex flex-col divide-y divide-slate-800/60">
        {data.map((_, i) => {
          const colors = SHIP_COLORS[_ .colorIndex % SHIP_COLORS.length]
          return (
            <div key={i} className="px-3 py-2.5">
              {/* Ship label */}
              <div className="mb-2 flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 rounded-full border"
                  style={{ backgroundColor: colors.fill, borderColor: colors.stroke }}
                  aria-hidden="true"
                />
                <span className="text-[11px] font-semibold text-slate-300">
                  Ship {i + 1}
                </span>
                <span
                  ref={(el) => { if (rowRefs.current[i]) rowRefs.current[i].status = el }}
                  className="ml-auto text-[10px] font-medium text-slate-500"
                />
              </div>

              {/* Metric rows */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                <MetricRow
                  label="Dist to goal"
                  valueRef={(el) => { if (rowRefs.current[i]) rowRefs.current[i].dist = el }}
                  unit="u"
                />
                <MetricRow
                  label="Path length"
                  valueRef={(el) => { if (rowRefs.current[i]) rowRefs.current[i].length = el }}
                  unit="u"
                />
                <MetricRow
                  label="Time"
                  valueRef={(el) => { if (rowRefs.current[i]) rowRefs.current[i].time = el }}
                />
                <MetricRow
                  label="Avoidances"
                  valueRef={(el) => { if (rowRefs.current[i]) rowRefs.current[i].avoid = el }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-slate-800 px-3 py-1.5">
        <p className="text-[10px] text-slate-600">
          u = normalized canvas units (0–1)
        </p>
      </div>
    </div>
  )
}

function MetricRow(props: {
  label: string
  valueRef: (el: HTMLSpanElement | null) => void
  unit?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-600">
        {props.label}
      </span>
      <div className="flex items-baseline gap-1">
        <span
          ref={props.valueRef}
          className="font-mono text-xs tabular-nums text-slate-200"
        >
          —
        </span>
        {props.unit && (
          <span className="text-[10px] text-slate-600">{props.unit}</span>
        )}
      </div>
    </div>
  )
}
