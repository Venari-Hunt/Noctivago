import { eqNodeType, eqBandStageCount } from './SoundSource.js'

const FILTER_SMOOTHING_SECONDS = 0.02

// A master processing chain that sits between the Mixer's masterGain and the
// audio destination. It's the live-playback counterpart of the "Whole-mix
// processing" section the Export tab already bakes into a file: whenever a
// preset carrying saved whole-mix settings is loaded in the Mixer, its
// highpass / lowpass / parametric EQ / gain are installed here and heard on
// everything playing.
//
// Signal path: input -> highpass -> lowpass -> [eq bands...] -> gain -> fadeGain
// -> limiter -> destination. The `limiter` is a brick-wall safety net: the
// user's gain (up to +24 dB) and each EQ band (up to +30 dB) have no other
// ceiling, so an aggressive preset could otherwise clip/distort the whole
// live mix - the same exposure Composite's bake had before v0.1.113. Export's
// whole-mix post-chain gets the matching ffmpeg `alimiter=limit=0.95` so the
// two stay in agreement. The EQ chain is built exactly like a sound's own (same
// eqNodeType / eqBandStageCount helpers, imported from SoundSource so there's
// no drift) - one BiquadFilterNode group per band, rebuilt only when the band
// topology changes. Neutral by default: HP at 0, LP at 20000, gain 1, no EQ
// bands - the graph is always wired and `set()` only adjusts it.
export class WholeMixChain {
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

    // Dedicated node for the on-preset-load fade-in, kept separate from
    // `gain` (the user's dB control) so a fade never fights a gain change.
    this.fadeGain = context.createGain()
    this.fadeGain.gain.value = 1

    // Brick-wall safety limiter on the summed whole-mix output. Ceiling ~0.95
    // (-0.45 dBFS) to match Export's `alimiter=limit=0.95`; transparent well
    // below that, so a neutral / cut-only whole mix is unaffected.
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
    this.gain.connect(this.fadeGain)
    this.fadeGain.connect(this.limiter)
    this.limiter.connect(destination)

    // Read-only tap for the merged Remix tab's live spectrogram (Preset
    // mode) - a dedicated fixed-gain feed node, never connected onward,
    // mirroring PreviewSource.js's own analyser tap so the graph reads
    // (fixed gain, decoupled from anything downstream) match exactly.
    this.analyserFeed = context.createGain()
    this.analyserFeed.gain.value = 1
    this.limiter.connect(this.analyserFeed)
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyserFeed.connect(this.analyser)

    this.config = null
  }

  // config: { highpassHz, lowpassHz, gainDb, eq: [...] } or null / undefined
  // for neutral. fadeInSeconds > 0 ramps fadeGain 0 -> 1 over that time (used
  // only when a preset is actually loaded; live-preview edits pass 0 so the
  // value just eases back to 1).
  set(config, { fadeInSeconds = 0 } = {}) {
    this.config = config ?? null
    const c = config ?? {}
    const now = this.context.currentTime

    this.highpass.frequency.setTargetAtTime(c.highpassHz ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.lowpass.frequency.setTargetAtTime(c.lowpassHz ?? 20000, now, FILTER_SMOOTHING_SECONDS)
    this.gain.gain.setTargetAtTime(c.gainDb ? Math.pow(10, c.gainDb / 20) : 1, now, FILTER_SMOOTHING_SECONDS)

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

    this.fadeGain.gain.cancelScheduledValues(now)
    if (fadeInSeconds > 0) {
      this.fadeGain.gain.setValueAtTime(0, now)
      this.fadeGain.gain.linearRampToValueAtTime(1, now + fadeInSeconds)
    } else {
      this.fadeGain.gain.setTargetAtTime(1, now, FILTER_SMOOTHING_SECONDS)
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
}
