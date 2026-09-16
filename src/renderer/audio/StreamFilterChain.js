import { createReverbImpulse } from './reverbIR.js'
import { eqNodeType, eqBandStageCount } from './SoundSource.js'
import { PanStage } from './PanStage.js'

// Shared EQ/Echo/Reverb chain builder for the two scatter/scheduled *stream*
// fallbacks (StreamScatterSource/StreamScheduledSource, both same directory -
// this is core, not a plugin, so sharing one implementation is the right call
// rather than the plugin sandbox's forced duplication). Mirrors
// LocalFileSoundSource's (SoundSource.js) own live chain shape - highpass ->
// lowpass -> EQ -> filterGain -> [parallel echo tap] -> [parallel reverb tap]
// - summed into whatever per-shot envelope node the caller passes as
// `outputNode` (StreamScatterSource/StreamScheduledSource's own
// shotGainNode).
//
// Before this existed, both Stream* classes only ever built highpass/
// lowpass/gain nodes - EQ, Echo, and Reverb were silently dropped whenever a
// scatter/scheduled sound fell back to streaming (a trim too long to bake, or
// one that just hasn't finished baking yet), even though BufferScatterSource/
// BufferScheduledSource always has them (baked into the clip's own samples at
// Save time) and the export pipeline always bakes the full set too (see
// loopClip.js's buildFilterChain/applyReverbPass). That mismatch was a real,
// reported bug (2026-09-14 inbox: a thunderclap's export had "a really strong
// reverb that isn't audible on the mixer tab") - the thunderclap was almost
// certainly caught mid-stream-fallback in the Mixer (e.g. right after an edit
// invalidated its baked clip, before the next play re-baked it) while the
// export always re-renders the shot fresh via ffmpeg with the real filters.
const MAX_ECHO_DELAY_SECONDS = 2.0

function rebuildEqChain(chain, eq) {
  chain.lowpassNode.disconnect()
  for (const node of chain.eqNodes) node.disconnect()
  chain.eqNodeGroups = eq.map((band) => {
    const stageCount = eqBandStageCount(band)
    return Array.from({ length: stageCount }, () => {
      const node = chain.context.createBiquadFilter()
      node.type = eqNodeType(band)
      node.frequency.value = band.freqHz
      node.Q.value = band.q
      node.gain.value = band.gainDb
      return node
    })
  })
  chain.eqNodes = chain.eqNodeGroups.flat()
  chain.eqTopology = eq.map(eqBandStageCount).join(',')
  const eqChainEnd = chain.eqNodes.reduce((prev, node) => {
    prev.connect(node)
    return node
  }, chain.lowpassNode)
  eqChainEnd.connect(chain.filterGainNode)
}

// Builds and wires the chain; `chain.highpassNode` is the entry point the
// caller connects its <audio> element's MediaElementSourceNode into.
export function createStreamFilterChain(context, filters, outputNode) {
  const f = filters ?? {}
  const highpassNode = context.createBiquadFilter()
  highpassNode.type = 'highpass'
  highpassNode.frequency.value = f.highpassHz ?? 0

  const lowpassNode = context.createBiquadFilter()
  lowpassNode.type = 'lowpass'
  lowpassNode.frequency.value = f.lowpassHz ?? 20000

  const filterGainNode = context.createGain()
  filterGainNode.gain.value = f.gainDb ? Math.pow(10, f.gainDb / 20) : 1

  const echoDelayNode = context.createDelay(MAX_ECHO_DELAY_SECONDS)
  echoDelayNode.delayTime.value = (f.echoDelayMs ?? 0) / 1000
  const echoSendGain = context.createGain()
  echoSendGain.gain.value = f.echoDecay ?? 0
  const echoFeedbackGain = context.createGain()
  echoFeedbackGain.gain.value = f.echoDecay ?? 0

  const reverbSendGain = context.createGain()
  reverbSendGain.gain.value = f.reverbMix ?? 0
  const reverbConvolver = context.createConvolver()
  reverbConvolver.normalize = true
  const reverbSizeMs = f.reverbSizeMs ?? 0

  // Stereo pan (v0.1.216) - after the echo/reverb taps, same position as
  // LocalFileSoundSource's own panStage.
  const panStage = new PanStage(context, f.pan ?? 0)

  const chain = {
    context,
    filters: f,
    highpassNode,
    lowpassNode,
    filterGainNode,
    echoDelayNode,
    echoSendGain,
    echoFeedbackGain,
    reverbSendGain,
    reverbConvolver,
    panStage,
    _reverbSizeMs: reverbSizeMs,
    eqNodes: [],
    eqNodeGroups: [],
    eqTopology: ''
  }
  if (reverbSizeMs > 0) reverbConvolver.buffer = createReverbImpulse(context, reverbSizeMs / 1000)

  highpassNode.connect(lowpassNode)
  rebuildEqChain(chain, f.eq ?? [])

  filterGainNode.connect(panStage.input)

  filterGainNode.connect(echoSendGain)
  echoSendGain.connect(echoDelayNode)
  echoDelayNode.connect(echoFeedbackGain)
  echoFeedbackGain.connect(echoDelayNode)
  echoDelayNode.connect(panStage.input)

  filterGainNode.connect(reverbSendGain)
  reverbSendGain.connect(reverbConvolver)
  reverbConvolver.connect(panStage.input)

  panStage.output.connect(outputNode)

  return chain
}

// Live-update counterpart, called whenever the sound's saved filters change
// while this stream source already exists - same smoothing constant
// LocalFileSoundSource's own setFilters uses.
const FILTER_SMOOTHING_SECONDS = 0.01

export function updateStreamFilterChain(chain, filters) {
  chain.filters = filters ?? {}
  const now = chain.context.currentTime
  chain.highpassNode.frequency.setTargetAtTime(chain.filters.highpassHz ?? 0, now, FILTER_SMOOTHING_SECONDS)
  chain.lowpassNode.frequency.setTargetAtTime(chain.filters.lowpassHz ?? 20000, now, FILTER_SMOOTHING_SECONDS)
  chain.filterGainNode.gain.setTargetAtTime(chain.filters.gainDb ? Math.pow(10, chain.filters.gainDb / 20) : 1, now, FILTER_SMOOTHING_SECONDS)
  chain.echoDelayNode.delayTime.setTargetAtTime((chain.filters.echoDelayMs ?? 0) / 1000, now, FILTER_SMOOTHING_SECONDS)
  chain.echoSendGain.gain.setTargetAtTime(chain.filters.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)
  chain.echoFeedbackGain.gain.setTargetAtTime(chain.filters.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)
  chain.reverbSendGain.gain.setTargetAtTime(chain.filters.reverbMix ?? 0, now, FILTER_SMOOTHING_SECONDS)
  if (!chain.panStage.hasPan(chain.filters.pan ?? 0)) chain.panStage.setPan(chain.filters.pan ?? 0)
  const reverbSizeMs = chain.filters.reverbSizeMs ?? 0
  if (reverbSizeMs !== chain._reverbSizeMs) {
    chain._reverbSizeMs = reverbSizeMs
    chain.reverbConvolver.buffer = reverbSizeMs > 0 ? createReverbImpulse(chain.context, reverbSizeMs / 1000) : null
  }
  const eq = chain.filters.eq ?? []
  const topology = eq.map(eqBandStageCount).join(',')
  if (topology !== chain.eqTopology) {
    rebuildEqChain(chain, eq)
  } else {
    chain.eqNodeGroups.forEach((group, i) => {
      const band = eq[i]
      const newType = eqNodeType(band)
      for (const node of group) {
        if (node.type !== newType) node.type = newType
        node.frequency.setTargetAtTime(band.freqHz, now, FILTER_SMOOTHING_SECONDS)
        node.Q.setTargetAtTime(band.q, now, FILTER_SMOOTHING_SECONDS)
        node.gain.setTargetAtTime(band.gainDb, now, FILTER_SMOOTHING_SECONDS)
      }
    })
  }
}

export function disposeStreamFilterChain(chain) {
  chain.highpassNode.disconnect()
  chain.lowpassNode.disconnect()
  for (const node of chain.eqNodes) node.disconnect()
  chain.filterGainNode.disconnect()
  chain.echoSendGain.disconnect()
  chain.echoDelayNode.disconnect()
  chain.echoFeedbackGain.disconnect()
  chain.reverbSendGain.disconnect()
  chain.reverbConvolver.disconnect()
  chain.panStage.dispose()
}
