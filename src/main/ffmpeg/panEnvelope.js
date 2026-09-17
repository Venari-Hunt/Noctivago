import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { hasPanFluctuation, samplePanWalk, panMatrixFrames, encodePanWav } from './panDrift.js'

// Writes one realization of a pan-drift walk (panDrift.js) as a 4-channel
// control WAV in export-tmp - the same folder gainEnvelope.js uses, so
// exportMix.js's own cleanup and the startup sweep both cover it. Returns
// the path, or null when the config has no pan drift.
export function renderPanEnvelopeWav(fluctuation, durationSeconds, rng = Math.random) {
  if (!hasPanFluctuation(fluctuation)) return null
  const bytes = encodePanWav(panMatrixFrames(samplePanWalk(fluctuation.pan, durationSeconds, rng)))
  const dir = path.join(app.getPath('userData'), 'export-tmp')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${crypto.randomUUID()}.wav`)
  fs.writeFileSync(filePath, bytes)
  return filePath
}
