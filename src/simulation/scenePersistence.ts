/**
 * Save / load format for the simulation scene.
 *
 * Versioned so future changes can migrate old files gracefully.
 * Path history is intentionally excluded — it's transient render data.
 */

import type { ShipRuntimeConfig } from './simulationRuntime'

export const SAVE_FORMAT_VERSION = 1

// ─── Serialisable types ──────────────────────────────────────────────────────

export type SavedObstacle = {
  x: number
  y: number
  radius: number
  /** Drift velocity components (zero = stationary). */
  vx: number
  vy: number
}

export type SavedShip = {
  /** Current live position at time of save. */
  posX: number
  posY: number
  goalX: number
  goalY: number
}

export type SavedFieldParams = {
  kAtt: number
  kRep: number
  stepSize: number
  obstaclesDrift: boolean
  driftSpeedScale: number
}

export type SceneSaveFile = {
  version: number
  savedAt: string
  ships: SavedShip[]
  obstacles: SavedObstacle[]
  fieldParams: SavedFieldParams
}

// ─── Validation helpers ──────────────────────────────────────────────────────

function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/**
 * Parses and validates a JSON string produced by {@link serialiseScene}.
 * Returns `null` with a reason string on any validation failure so the caller
 * can surface a user-friendly error without crashing.
 */
export function parseSceneSaveFile(
  json: string,
): { ok: true; data: SceneSaveFile } | { ok: false; reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'File is not valid JSON.' }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'Expected a JSON object at the top level.' }
  }

  const obj = raw as Record<string, unknown>

  if (obj['version'] !== SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      reason: `Unsupported save version: ${obj['version']}. Expected ${SAVE_FORMAT_VERSION}.`,
    }
  }

  // ── Ships ──────────────────────────────────────────────────────────────────
  if (!Array.isArray(obj['ships']) || obj['ships'].length === 0) {
    return { ok: false, reason: 'Missing or empty "ships" array.' }
  }

  const ships: SavedShip[] = []
  for (let i = 0; i < (obj['ships'] as unknown[]).length; i++) {
    const s = (obj['ships'] as unknown[])[i]
    if (typeof s !== 'object' || s === null) {
      return { ok: false, reason: `ships[${i}] is not an object.` }
    }
    const sr = s as Record<string, unknown>
    for (const key of ['posX', 'posY', 'goalX', 'goalY'] as const) {
      if (!isFiniteInRange(sr[key], 0, 1)) {
        return { ok: false, reason: `ships[${i}].${key} must be a number in [0, 1].` }
      }
    }
    ships.push({
      posX: sr['posX'] as number,
      posY: sr['posY'] as number,
      goalX: sr['goalX'] as number,
      goalY: sr['goalY'] as number,
    })
  }

  // ── Obstacles ──────────────────────────────────────────────────────────────
  if (!Array.isArray(obj['obstacles'])) {
    return { ok: false, reason: 'Missing "obstacles" array.' }
  }

  const obstacles: SavedObstacle[] = []
  for (let i = 0; i < (obj['obstacles'] as unknown[]).length; i++) {
    const o = (obj['obstacles'] as unknown[])[i]
    if (typeof o !== 'object' || o === null) {
      return { ok: false, reason: `obstacles[${i}] is not an object.` }
    }
    const or_ = o as Record<string, unknown>
    if (!isFiniteInRange(or_['x'], 0, 1)) {
      return { ok: false, reason: `obstacles[${i}].x must be in [0, 1].` }
    }
    if (!isFiniteInRange(or_['y'], 0, 1)) {
      return { ok: false, reason: `obstacles[${i}].y must be in [0, 1].` }
    }
    if (!isFiniteInRange(or_['radius'], 1e-4, 0.5)) {
      return { ok: false, reason: `obstacles[${i}].radius must be in [0.0001, 0.5].` }
    }
    const vx = typeof or_['vx'] === 'number' && Number.isFinite(or_['vx']) ? or_['vx'] : 0
    const vy = typeof or_['vy'] === 'number' && Number.isFinite(or_['vy']) ? or_['vy'] : 0
    obstacles.push({
      x: or_['x'] as number,
      y: or_['y'] as number,
      radius: or_['radius'] as number,
      vx,
      vy,
    })
  }

  // ── Field params ───────────────────────────────────────────────────────────
  const fp = obj['fieldParams']
  if (typeof fp !== 'object' || fp === null) {
    return { ok: false, reason: 'Missing "fieldParams" object.' }
  }
  const fpr = fp as Record<string, unknown>

  const kAtt =
    typeof fpr['kAtt'] === 'number' && Number.isFinite(fpr['kAtt'])
      ? clamp(fpr['kAtt'], 0.1, 200)
      : 14
  const kRep =
    typeof fpr['kRep'] === 'number' && Number.isFinite(fpr['kRep'])
      ? clamp(fpr['kRep'], 1e-8, 1)
      : 6e-5
  const stepSize =
    typeof fpr['stepSize'] === 'number' && Number.isFinite(fpr['stepSize'])
      ? clamp(fpr['stepSize'], 1e-4, 0.1)
      : 0.004
  const obstaclesDrift = fpr['obstaclesDrift'] === true
  const driftSpeedScale =
    typeof fpr['driftSpeedScale'] === 'number' && Number.isFinite(fpr['driftSpeedScale'])
      ? clamp(fpr['driftSpeedScale'], 0, 20)
      : 1.0

  return {
    ok: true,
    data: {
      version: SAVE_FORMAT_VERSION,
      savedAt: typeof obj['savedAt'] === 'string' ? obj['savedAt'] : new Date().toISOString(),
      ships,
      obstacles,
      fieldParams: { kAtt, kRep, stepSize, obstaclesDrift, driftSpeedScale },
    },
  }
}

/**
 * Serialises a scene snapshot to a pretty-printed JSON string.
 */
export function serialiseScene(data: SceneSaveFile): string {
  return JSON.stringify(data, null, 2)
}

/**
 * Converts a parsed save file back into the `ShipRuntimeConfig[]` shape
 * used by the React controls context (start = saved position, goal = saved goal).
 */
export function shipConfigsFromSave(saved: SavedShip[]): ShipRuntimeConfig[] {
  return saved.map((s) => ({
    startX: clamp01(s.posX),
    startY: clamp01(s.posY),
    goalX: clamp01(s.goalX),
    goalY: clamp01(s.goalY),
  }))
}

/**
 * Triggers a browser file download of the given JSON string.
 */
export function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Opens a file-picker restricted to JSON files and resolves with the file text.
 * Rejects if the user cancels or the file cannot be read.
 */
export function pickJsonFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        reject(new Error('No file selected.'))
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('Failed to read file.'))
      reader.readAsText(file)
    }
    // Cancelled without selecting
    input.addEventListener('cancel', () => reject(new Error('Cancelled.')))
    input.click()
  })
}
