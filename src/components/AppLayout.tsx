import { SimulationControlsProvider } from '../context/SimulationControlsProvider'
import { SimulationCanvas } from '../canvas/SimulationCanvas'
import { Sidebar } from './Sidebar'

export function AppLayout() {
  return (
    <SimulationControlsProvider>
      <div className="flex h-full min-h-0 w-full overflow-hidden bg-slate-950 text-slate-100">
        <SimulationCanvas />
        <Sidebar />
      </div>
    </SimulationControlsProvider>
  )
}
