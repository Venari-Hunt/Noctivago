import { eqNodeType, eqBandStageCount } from './SoundSource.js'
import { createReverbImpulse } from './reverbIR.js'

const FILTER_SMOOTHING_SECONDS = 0.02
// Upper bound a Web Audio DelayNode must declare at creation time - matches
// WholeMixChain's/SoundSource.js's own per-sound echo delay's ceiling.
const MAX_ECHO_DELAY_SECONDS = 2.0

// A submix bus for a named "Sound Group" (see the Remix plugin's Group mode
// + the Mixer's right-click "Add to group…" menu on a sound row) - several
// sounds route their gainNode through one shared
// highpass/lowpass/EQ/gain chain instead of straight to masterGain, so they
// can be shaped together ("make these sound like they're outside a house")
// without touching any sound's own per-sound filters. Structurally identical
// to WholeMixChain (same EQ-chain helpers, same echo tap, same brick-wall
// limiter so a boosted group can't clip) minus the on-load fade-in, which
// only makes sense for a whole preset being loaded, not a group whose
// membership can change at any time while things are already playing.
export class SoundGroupChain {
  constructor(context, destination) {
    this.context = context

    this.input = context.createGain()

    this.highpass = context.createBiquadFilter()
    this.highpass.type = 'highpass'
    this.highpass.frequency.value = 0

    this.lowpass = context.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.frequency.value = 20000

    this.gain = context.createGain()
    this.gain.gain.value = 1

    // Echo: a feedback delay line tapped in parallel off the post-EQ/gain
    // signal, mirroring WholeMixChain's/SoundSource.js's own echo exactly -
    // the owner's own direction (2026-09-06) that Echo isn't single-sound-
    // specific the way trim/waveform/etc. are.
    this.echoDelay = context.createDelay(MAX_ECHO_DELAY_SECONDS)
    this.echoDelay.delayTime.value = 0
    this.echoSendGain = context.createGain()
    this.echoSendGain.gain.value = 0
    this.echoFeedbackGain = context.createGain()
    this.echoFeedbackGain.gain.value = 0

    // Reverb: mirrors WholeMixChain's own reverb tap exactly - see its
    // doc comment for the full reasoning.
    this._reverbSizeMs = 0
    this.reverbSendGain = context.createGain()
    this.reverbSendGain.gain.value = 0
    this.reverbConvolver = context.createConvolver()
    this.reverbConvolver.normalize = true

    // Brick-wall safety limiter, same ceiling as WholeMixChain's - a group's
    // own gain/EQ boosts have no other ceiling, and several loud member
    // sounds summed together can genuinely clip.
    this.limiter = context.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.05

    this.eqNodes = []
    this.eqNodeGroups = []
    this.eqTopology = ''

    this.input.connect(this.highpass)
    this.highpass.connect(this.lowpass)
    this._rebuildEqChain([])
    this.gain.connect(this.limiter)

    this.gain.connect(this.echoSendGain)
    this.echoSendGain.connect(this.echoDelay)
    this.echoDelay.connect(this.echoFeedbackGain)
    this.echoFeedbackGain.connect(this.echoDelay)
    this.echoDelay.connect(this.limiter)

    this.gain.connect(this.reverbSendGain)
    this.reverbSendGain.connect(this.reverbConvolver)
    this.reverbConvolver.connect(this.limiter)

    this.limiter.connect(destination)

    // Read-only tap for the merged Remix tab's live spectrogram (Group
    // mode) - see WholeMixChain's identical tap for why a dedicated
    // fixed-gain feed node instead of tapping `limiter` directly.
    this.analyserFeed = context.createGain()
    this.analyserFeed.gain.value = 1
    this.limiter.connect(this.analyserFeed)
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyserFeed.connect(this.analyser)

    this.config = null
  }

  // config: { highpassHz, lowpassHz, gainDb, echoDelayMs, echoDecay,
  // reverbSizeMs, reverbMix, eq: [...] } or null / undefined for neutral.
  set(config) {
    this.config = config ?? null
    const c = config ?? {}
    const now = this.context.currentTime

    this.highpass.frequency.setTargetAtTime(c.highpassHz ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.lowpass.frequency.setTargetAtTime(c.lowpassHz ?? 20000, now, FILTER_SMOOTHING_SECONDS)
    this.gain.gain.setTargetAtTime(c.gainDb ? Math.pow(10, c.gainDb / 20) : 1, now, FILTER_SMOOTHING_SECONDS)

    this.echoDelay.delayTime.setTargetAtTime((c.echoDelayMs ?? 0) / 1000, now, FILTER_SMOOTHING_SECONDS)
    this.echoSendGain.gain.setTargetAtTime(c.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.echoFeedbackGain.gain.setTargetAtTime(c.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)

    const reverbSizeMs = c.reverbSizeMs ?? 0
    if (reverbSizeMs !== this._reverbSizeMs) {
      this._reverbSizeMs = reverbSizeMs
      this.reverbConvolver.buffer = reverbSizeMs > 0 ? createReverbImpulse(this.context, reverbSizeMs / 1000) : null
    }
    this.reverbSendGain.gain.setTargetAtTime(c.reverbMix ?? 0, now, FILTER_SMOOTHING_SECONDS)

    const eq = c.eq ?? []
    const topology = eq.map(eqBandStageCount).join(',')
    if (topology !== this.eqTopology) {
      this._rebuildEqChain(eq)
    } else {
      this.eqNodeGroups.forEach((group, i) => {
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

  _rebuildEqChain(eq) {
    this.lowpass.disconnect()
    for (const node of this.eqNodes) node.disconnect()
    this.eqNodeGroups = eq.map((band) => {
      const stageCount = eqBandStageCount(band)
      return Array.from({ length: stageCount }, () => {
        const node = this.context.createBiquadFilter()
        node.type = eqNodeType(band)
        node.frequency.value = band.freqHz
        node.Q.value = band.q
        node.gain.value = band.gainDb
        return node
      })
    })
    this.eqNodes = this.eqNodeGroups.flat()
    this.eqTopology = eq.map(eqBandStageCount).join(',')
    const end = this.eqNodes.reduce((prev, node) => {
      prev.connect(node)
      return node
    }, this.lowpass)
    end.connect(this.gain)
  }

  // Torn down when a group is deleted, or its preset is no longer the one
  // loaded (see AudioEngine.setSoundGroups) - disconnects every node so
  // nothing keeps this chain alive after it's no longer referenced.
  dispose() {
    this.input.disconnect()
    this.highpass.disconnect()
    this.lowpass.disconnect()
    for (const node of this.eqNodes) node.disconnect()
    this.gain.disconnect()
    this.echoDelay.disconnect()
    this.echoSendGain.disconnect()
    this.echoFeedbackGain.disconnect()
    this.reverbSendGain.disconnect()
    this.reverbConvolver.disconnect()
    this.limiter.disconnect()
    this.analyserFeed.disconnect()
    this.analyser.disconnect()
  }
}
