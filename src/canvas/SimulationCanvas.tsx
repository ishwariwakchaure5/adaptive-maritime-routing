import { useSimulationControls } from '../hooks/useSimulationControls'
import { useSimulationCanvas } from './useSimulationCanvas'
import { AnalyticsPanel } from '../components/AnalyticsPanel'

export function SimulationCanvas() {
  const { getRuntimePayload, registerSceneHandle, running } = useSimulationControls()
  const { containerRef, canvasRef, sceneHandle } = useSimulationCanvas(getRuntimePayload)

  // Register the stable handle with the controls context so save/load can use it.
  registerSceneHandle(sceneHandle)

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Simulation
        </span>
        <span className="text-[11px] text-slate-600">
          Click canvas to place obstacles
        </span>
      </div>
      <div
        ref={containerRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-crosshair touch-none"
          aria-label="Ship routing simulation canvas. Click to place obstacles."
        />
        {/* Analytics panel — absolute overlay, bottom-left of canvas */}
        <AnalyticsPanel sceneHandle={sceneHandle} running={running} />
      </div>
    </div>
  )
}
