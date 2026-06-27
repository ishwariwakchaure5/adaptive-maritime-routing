import { useContext } from 'react'
import {
  SimulationControlsContext,
  type SimulationControlsContextValue,
} from '../context/simulationControlsContext'

export function useSimulationControls(): SimulationControlsContextValue {
  const ctx = useContext(SimulationControlsContext)
  if (!ctx) {
    throw new Error(
      'useSimulationControls must be used within SimulationControlsProvider',
    )
  }
  return ctx
}
