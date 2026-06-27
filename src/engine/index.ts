export { applySceneFromControls } from './applySceneFromControls'
export type { ShipAgent, SimulationScene } from './simulationScene'
export {
  createSimulationScene,
  createShipAgent,
  resetShipAgent,
  MAX_OBSTACLE_COUNT,
  POINTER_PLACED_OBSTACLE_RADIUS,
  SHIP_AVOIDANCE_RADIUS,
} from './simulationScene'
export { stepVectorFieldSimulation } from './stepVectorFieldSimulation'
export type { VectorFieldConfig } from './vectorFieldNavigation'
export {
  computeNextPosition,
  computeTotalForce,
  DEFAULT_VECTOR_FIELD_CONFIG,
  mergeVectorFieldConfig,
  NORMALIZED_VECTOR_FIELD_PRESET,
} from './vectorFieldNavigation'
