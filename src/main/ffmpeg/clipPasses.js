// The in-process steps of a saved clip, between two ffmpeg runs: Spectral repair
// (shared/spectralRepairDsp.js) then Speed, Pitch and Doppler (pitchShift.js).
// Both are the engines the Remix preview plays through, so the save matches
// what was heard. Order matches the bake: repair works on source time, so it
// runs before anything that moves time.
import { readWav, writeWavFloat, needsPitchPass, pitchShiftChannels } from './pitchShift.js'
import { repairChannels } from '../../shared/spectralRepairDsp.js'

export function needsClipPasses(speedPitch, spectralRegions) {
  return needsPitchPass(speedPitch) || spectralRegions.length > 0
}

// inFile/outFile: 32-bit float WAV. spectralRegions: from
// spectralRepairRegionsForClip (times from the clip start).
export async function runClipPasses(inFile, outFile, { speedPitch, spectralRegions }) {
  let { channels, sampleRate } = readWav(inFile)
  if (spectralRegions.length > 0) channels = repairChannels(channels, sampleRate, spectralRegions)
  if (needsPitchPass(speedPitch)) channels = await pitchShiftChannels(channels, sampleRate, speedPitch)
  writeWavFloat(outFile, channels, sampleRate)
}
