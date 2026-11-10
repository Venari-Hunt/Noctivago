// The in-process steps of a saved clip, between two ffmpeg runs: Noise reduction
// (shared/noiseReductionDsp.js), Spectral repair (shared/spectralRepairDsp.js),
// then Speed, Pitch and Doppler (pitchShift.js).
// Both are the engines the Remix preview plays through, so the save matches
// what was heard. Order matches the bake: noise and repair work on source time,
// so they run before anything that moves time.
import { readWav, writeWavFloat, needsPitchPass, pitchShiftChannels } from './pitchShift.js'
import { repairChannels } from '../../shared/spectralRepairDsp.js'
import { reduceNoise, resolveNoiseWindow } from '../../shared/noiseReductionDsp.js'

// Noise reduction from the Remix settings: the sample window (stored as absolute
// file seconds, used from the clip start) and the strength. Null when it is off
// or the loop is too short to sample.
export function noiseReductionForClip(filters, loopStart, loopEnd) {
  if (!filters?.denoiseEnabled) return null
  const w = resolveNoiseWindow(filters.denoiseSampleStartSec, filters.denoiseSampleEndSec, loopStart, loopEnd)
  if (!w) return null
  return { noiseFromSec: w.start - loopStart, noiseToSec: w.end - loopStart, strengthDb: filters.denoiseStrengthDb }
}

export function needsClipPasses(speedPitch, spectralRegions, noiseSettings) {
  return needsPitchPass(speedPitch) || spectralRegions.length > 0 || Boolean(noiseSettings)
}

// inFile/outFile: 32-bit float WAV. spectralRegions: from
// spectralRepairRegionsForClip (times from the clip start).
export async function runClipPasses(inFile, outFile, { speedPitch, spectralRegions, noiseSettings = null }) {
  let { channels, sampleRate } = readWav(inFile)
  if (noiseSettings) channels = reduceNoise(channels, sampleRate, noiseSettings)
  if (spectralRegions.length > 0) channels = repairChannels(channels, sampleRate, spectralRegions)
  if (needsPitchPass(speedPitch)) channels = await pitchShiftChannels(channels, sampleRate, speedPitch)
  writeWavFloat(outFile, channels, sampleRate)
}
