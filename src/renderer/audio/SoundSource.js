import log from 'electron-log/renderer'
import { createReverbImpulse } from './reverbIR.js'
import { PanStage } from './PanStage.js'
import { SoundFluctuation, fluctuationKey } from './Modulator.js'
import { NoiseGate } from './NoiseGate.js'
import { rampEqualPower } from './equalPowerRamp.js'
import { createPitchShiftNode } from './pitchShiftNode.js'

const RAMP_SECONDS = 0.15
const LOOP_EPSILON_SECONDS = 0.03
// Matches plugins/editor/audio/PreviewSource.js's live-drag smoothing, so a
// filter change saved in Remix updates an already-playing Mixer sound with
// the same feel as dragging the slider live in the Remix preview itself.
const FILTER_SMOOTHING_SECONDS = 0.01
// Upper bound a Web Audio DelayNode must declare at creation time - well
// above the Remix slider's max (see plugins/editor/index.js) so the delay
// time can never need a value the node wasn't built to hold.
const MAX_ECHO_DELAY_SECONDS = 2.0

// Default length of the loop-seam crossfade in stream mode (see _tick /
// _startCrossfade below). Mirrors loopClip.js's DEFAULT_CROSSFADE_SECONDS
// (the baked buffer-mode path's own default) so a long, stream-only sound
// loops with roughly the same seam feel as a short one that got baked -
// buffer mode still wins on sample-accuracy, this just closes the gap for
// files whose loop region is too long to ever bake. A sound's per-sound
// entry.crossfadeSeconds overrides this; an explicit 0 there falls back to
// the old hard seek-back (a real "off" switch, matching every other
// 0-means-off control in the app).
const DEFAULT_STREAM_CROSSFADE_SECONDS = 0.2

// How long a 'waiting'/stalled <audio> element gets before this treats it as
// a real problem rather than normal, brief re-buffering. See the 'waiting'
// listener below for why this exists at all: the sound:// stream (hand-
// rolled HTTP Range serving over fs.createReadStream, see src/main/index.js)
// had zero error handling, and the <audio> element had zero stall/error
// listeners - so a transient I/O hiccup on a long streaming session could
// silently stop a sound with nothing in the app ever noticing, matching a
// user report of playback going quiet then sometimes recovering on its own
// (accidental browser retry behavior, not anything this app did on purpose).
const STALL_RECOVERY_DELAY_MS = 8000
const MAX_RECOVERY_ATTEMPTS = 3

// 'off' is a pseudo-type (not a real BiquadFilterNode type) - see the
// eqNodes comment in the constructor below for why 'allpass' is the right
// stand-in. A muted band (see the Remix EQ's per-band Mute/Solo controls)
// takes the same 'allpass' bypass, independent of whatever real type it's
// set to - muting is meant to be non-destructive, so it never touches
// band.type itself, only whether the node actually applies it. Shared by
// both construction and live updates (setFilters) so they can't drift.
// Exported so WholeMixChain.js (the Preset Remix whole-mix chain) can build
// an identically-shaped EQ chain without a third private copy - this is
// core-to-core, unlike the plugin-side duplicates.
export function eqNodeType(band) {
  return band.muted || band.type === 'off' ? 'allpass' : (band.type ?? 'peaking')
}

// Only the four filter-*shaped* types have a real "slope" (rolloff
// steepness) concept - peaking/shelf types are gain-shaped, 'off' does
// nothing. BiquadFilterNode is inherently one fixed 12dB/octave stage with
// no slope parameter of its own, so "Steep" is real cascading: N identical
// stages chained in series, each stage multiplying the rolloff by another
// ~12dB/octave (feasibility confirmed against both Web Audio and the real
// bundled ffmpeg binary before implementing - see the ranked backlog's
// slope research). Mirrors PreviewSource.js's identical helper (and
// EqEditor.js's copy, used for the response-curve preview).
const SLOPE_CAPABLE_EQ_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch']
const STEEP_STAGE_COUNT = 4
export function eqBandStageCount(band) {
  return band.slope === 'steep' && SLOPE_CAPABLE_EQ_TYPES.includes(band.type) ? STEEP_STAGE_COUNT : 1
}

// Plays the original file by streaming it through an <audio> element, for
// sounds whose loop region is too long to bake into a buffer clip (see
// BufferSoundSource for the short-region path). Loops seamlessly via a
// two-element crossfade at the seam: two <audio> elements of the same file
// feed a pair of crossfade GainNodes that sum into the shared filter chain;
// as the active element nears loopEnd the standby element (pre-seeked to
// loopStart) fades in over crossfadeSeconds while the active fades out, then
// the two swap roles. This is the streaming counterpart of the baked clip's
// own tail/head crossfade - it can't be sample-accurate (the seam trigger is
// still rAF-polled currentTime, documented imprecise), but the crossfade
// masks that jitter far better than the old hard `currentTime = loopStart`
// seek did. entry.crossfadeSeconds === 0 opts back out to that hard seek.
export class LocalFileSoundSource {
  constructor(engine, { soundId, loopStart, loopEnd, volume, filters, speed, crossfadeSeconds, fluctuation }) {
    this.engine = engine
    this.soundId = soundId
    this.loopStart = loopStart ?? 0
    this.loopEnd = loopEnd ?? null
    this.volume = volume
    this.playing = false
    this._rafId = null
    this._pauseTimeoutId = null
    this._stallTimeoutId = null
    this._recoveryAttempts = 0

    // Speed is the only speed/pitch/reverse control applied to stream mode -
    // playbackRate maps to it directly, and the browser's own default
    // preservesPitch=true keeps this a pure tempo change. Pitch and reverse
    // need real DSP (rubberband/areverse) that only exists on the ffmpeg
    // side (see loopClip.js), so they only take effect once a sound is
    // baked into a buffer-mode clip - a real, documented gap for sounds too
    // long to bake, same category as buffer mode's other seam-smoothness-
    // only advantages over streaming.
    this.speed = speed ?? 1
    // Live pitch-fluctuation multiplier on top of Speed (see this._fluctuation
    // below). 1 when no pitch drift is active. Stream mode has no detune
    // primitive on <audio>, so pitch drift rides playbackRate.
    //
    // BUG FIX (v0.1.225): with the browser's default preservesPitch, that
    // made drift a slight tempo wobble with no pitch change at all. While
    // pitch drift is on, the elements now run with preservesPitch off, so
    // drift is tape-style (pitch and tempo together) like buffer mode's
    // detune. Speed must stay a pure tempo change, so when Speed isn't 100%
    // a pitch-shift node undoes the pitch Speed would otherwise add (see
    // _syncPitchMode and pitchShiftNode.js).
    this._pitchFactor = 1
    this._pitchCorrection = null
    this._pitchCorrectionRatio = 1
    this._pitchModeToken = 0
    // Nullable - null means "use DEFAULT_STREAM_CROSSFADE_SECONDS". See
    // _crossfadeSeconds() / _tick() for how it drives the loop-seam blend.
    this.crossfadeSeconds = crossfadeSeconds ?? null

    // Two identical streaming voices of the same file. _active indexes which
    // one is currently audible (crossfade gain 1); the other sits paused,
    // seeked to loopStart, ready to fade in at the next seam. audioEl (a
    // getter) is always the active one, so most of the code below reads as
    // if there were a single element.
    this._els = [new Audio(), new Audio()]
    this._srcNodes = []
    this._xfadeGains = []
    for (let i = 0; i < this._els.length; i++) {
      const el = this._els[i]
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      el.src = `sound://${soundId}`
      el.playbackRate = this._rate
      const srcNode = engine.context.createMediaElementSource(el)
      const xfade = engine.context.createGain()
      xfade.gain.value = i === 0 ? 1 : 0
      srcNode.connect(xfade)
      this._srcNodes.push(srcNode)
      this._xfadeGains.push(xfade)
    }
    this._active = 0
    this._crossfading = false
    this._crossfadeTimeoutId = null

    this._bindRecoveryListeners()

    // Same highpass -> lowpass -> gain chain as the Remix plugin's preview
    // (plugins/editor/audio/PreviewSource.js), so saved filters are audible
    // in the Mixer even for sounds too long to qualify for a baked buffer
    // clip. Loop-clip eligibility only affects seam smoothness, never
    // whether filters apply. Both crossfade voices feed into it.
    this.filters = filters ?? {}

    // Noise gate: sits first in the chain (before highpass), on the summed
    // output of both crossfade voices. Baked into the clip for buffer-mode
    // sounds, so this live node only matters for the stream-mode fallback -
    // same "filters still apply even without a baked clip" reasoning as the
    // highpass/lowpass/EQ nodes below.
    this.noiseGate = new NoiseGate(engine.context)
    this.noiseGate.configure(this.filters)

    this.highpassNode = engine.context.createBiquadFilter()
    this.highpassNode.type = 'highpass'
    this.highpassNode.frequency.value = this.filters.highpassHz ?? 0

    this.lowpassNode = engine.context.createBiquadFilter()
    this.lowpassNode.type = 'lowpass'
    this.lowpassNode.frequency.value = this.filters.lowpassHz ?? 20000

    // Parametric EQ: a chain of BiquadFilterNodes, one *group* per band the
    // user has actually added on the graph (see EqEditor.js's +/trash
    // controls - the band count is entirely user-managed now, not a fixed
    // preset), each independently one of Web Audio's native filter types - a
    // lucky architecture fit, since BiquadFilterNode's own type set (lowpass/
    // highpass/bandpass/lowshelf/highshelf/peaking/notch/allpass) already
    // covers 7 of the real FL Studio "Fruity Parametric EQ 2" reference's 8
    // shapes directly. 'off' (the 8th, a pseudo-type - see eqNodeType) maps
    // to 'allpass', which leaves the amplitude spectrum completely unchanged
    // - a true no-op for tone-shaping without needing to special-case it out
    // of the chain. A peaking/lowshelf/highshelf band left at its default
    // gainDb:0 is also a true no-op regardless of type, matching every
    // other 0/neutral-means-off control here - but lowpass/highpass/
    // bandpass/notch have no gain parameter at all and always shape the
    // signal whenever selected, they're never "neutral." Inserted between
    // lowpass and the overall filter gain, same position ffmpeg's bake
    // applies them (see loopClip.js's buildFilterChain) so live playback
    // and the baked clip agree. A band's own group is 1 node normally, or
    // STEEP_STAGE_COUNT identical cascaded nodes when its slope is 'steep'
    // (see eqBandStageCount) - eqNodes stays the flat, fully-ordered list of
    // every real node for connect/disconnect purposes, eqNodeGroups is the
    // same nodes re-grouped per band for per-band parameter updates. Starts
    // empty and is built by _rebuildEqChain below, the same rebuild path
    // setFilters() uses whenever the topology changes later - one code path
    // for both initial construction and live add/remove/type/slope changes,
    // so they can't drift apart.
    this.eqNodes = []
    this.eqNodeGroups = []
    this.eqTopology = ''

    this.filterGainNode = engine.context.createGain()
    this.filterGainNode.gain.value = this.filters.gainDb ? Math.pow(10, this.filters.gainDb / 20) : 1

    // Echo: a feedback delay line tapped in parallel off the filtered (dry)
    // signal. echoSendGain controls how much signal enters the delay loop
    // at all (0 = no echo, matching how highpassHz=0 means "off" for that
    // band); echoFeedbackGain attenuates each pass back through the delay,
    // so a single (delayMs, decay) pair naturally produces a decaying train
    // of repeats rather than one fixed echo - tied to the same value as
    // echoSendGain so "how loud the echo enters" and "how long it persists"
    // scale together from one user-facing knob (see the Remix preset UI).
    this.echoDelayNode = engine.context.createDelay(MAX_ECHO_DELAY_SECONDS)
    this.echoDelayNode.delayTime.value = (this.filters.echoDelayMs ?? 0) / 1000

    this.echoSendGain = engine.context.createGain()
    this.echoSendGain.gain.value = this.filters.echoDecay ?? 0

    this.echoFeedbackGain = engine.context.createGain()
    this.echoFeedbackGain.gain.value = this.filters.echoDecay ?? 0

    // Reverb: a real convolution reverb (ConvolverNode), replacing the old
    // idea of "Reverb" as just a preset combination of the Echo knobs above
    // (a short delay + high decay was never an actual reverb algorithm - see
    // reverbIR.js). A third parallel send off filterGainNode, same pattern
    // as echoSendGain right above rather than chained after it - Echo and
    // Reverb are independent, stackable effects, not one feeding the other.
    // reverbConvolver.buffer is a synthetic impulse response regenerated
    // only when reverbSizeMs actually changes (see setFilters) - _reverbSizeMs
    // tracks what it was last built for.
    this._reverbSizeMs = this.filters.reverbSizeMs ?? 0
    this.reverbSendGain = engine.context.createGain()
    this.reverbSendGain.gain.value = this.filters.reverbMix ?? 0
    this.reverbConvolver = engine.context.createConvolver()
    this.reverbConvolver.normalize = true
    if (this._reverbSizeMs > 0) {
      this.reverbConvolver.buffer = createReverbImpulse(engine.context, this._reverbSizeMs / 1000)
    }

    // Fluctuation (v0.1.164): slow volume/pitch drift. fluctuationGain sits
    // between the filter/echo/reverb chain and the per-sound volume gainNode,
    // so its 0..1 multiplier rides *below* the sound's set volume (never
    // boosts - can't push into clipping) and composes cleanly with the
    // play/pause fade and Sound Groups routing (both of which act on
    // gainNode, left untouched here). Pitch drift has no node - it rides
    // this._pitchFactor into playbackRate (see _rate). Modulators only run
    // while actually playing and while the axis is enabled.
    this.fluctuationGain = engine.context.createGain()
    this.fluctuationGain.gain.value = 1
    this._fluctuation = new SoundFluctuation({
      onVolume: (v) => this.fluctuationGain.gain.setTargetAtTime(v, this.engine.context.currentTime, 0.12),
      onPan: (v) => this.driftPanStage.setPan(v),
      onPitch: (semitones) => {
        this._pitchFactor = Math.pow(2, semitones / 12)
        this._applyPlaybackRate()
      }
    })
    this._fluctuation.configure(fluctuation ?? {})

    // Stereo pan (v0.1.216): after the whole filter/echo/reverb/fluctuation
    // chain, right before the per-sound volume - the same spot the ffmpeg
    // bake applies it (loopClip.js's renderCrossfadedLoop, last stage).
    this.panStage = new PanStage(engine.context, this.filters.pan ?? 0)
    // Pan drift (v0.1.217) is its own stage right after the static one - a
    // baked clip already has the static pan in its samples, so buffer mode
    // (BufferSoundSource) can only add drift *after* it; doing the same here
    // keeps stream and buffer mode (and the export) sounding identical.
    this.driftPanStage = new PanStage(engine.context, 0)

    this.gainNode = engine.context.createGain()
    this.gainNode.gain.value = 0

    // Both voices meet here; the optional pitch-correction node is inserted
    // between this bus and the noise gate.
    this.voiceBus = engine.context.createGain()
    this._xfadeGains[0].connect(this.voiceBus)
    this._xfadeGains[1].connect(this.voiceBus)
    this.voiceBus.connect(this.noiseGate.input)
    this._syncPitchMode()
    this.noiseGate.output.connect(this.highpassNode)
    this.highpassNode.connect(this.lowpassNode)
    this._rebuildEqChain(this.filters.eq ?? [])
    this.filterGainNode.connect(this.fluctuationGain)

    this.filterGainNode.connect(this.echoSendGain)
    this.echoSendGain.connect(this.echoDelayNode)
    this.echoDelayNode.connect(this.echoFeedbackGain)
    this.echoFeedbackGain.connect(this.echoDelayNode)
    this.echoDelayNode.connect(this.fluctuationGain)

    this.filterGainNode.connect(this.reverbSendGain)
    this.reverbSendGain.connect(this.reverbConvolver)
    this.reverbConvolver.connect(this.fluctuationGain)

    this.fluctuationGain.connect(this.panStage.input)
    this.panStage.output.connect(this.driftPanStage.input)
    this.driftPanStage.output.connect(this.gainNode)
    this.gainNode.connect(engine.masterGain)
  }

  // Speed x live pitch-fluctuation factor - the actual <audio> playbackRate.
  get _rate() {
    return this.speed * this._pitchFactor
  }

  _applyPlaybackRate() {
    for (const el of this._els) el.playbackRate = this._rate
  }

  // Pitch drift on -> preservesPitch off, plus a 1/speed pitch correction
  // when Speed isn't 100%. Called when the drift config or Speed changes.
  _syncPitchMode() {
    const driftOn = this._fluctuation.pitchMod.enabled
    for (const el of this._els) el.preservesPitch = !driftOn
    const ratio = driftOn && Math.abs(this.speed - 1) > 0.001 ? 1 / this.speed : 1
    if (ratio === this._pitchCorrectionRatio) return
    this._pitchCorrectionRatio = ratio
    const token = ++this._pitchModeToken
    if (ratio === 1) {
      this._setPitchCorrection(null)
      return
    }
    if (this._pitchCorrection) {
      this._pitchCorrection.parameters.get('ratio').value = ratio
      return
    }
    createPitchShiftNode(this.engine.context, ratio)
      .then((node) => {
        if (this._disposed || token !== this._pitchModeToken) {
          node.disconnect()
          return
        }
        this._setPitchCorrection(node)
      })
      .catch((err) => log.warn('Stream pitch correction unavailable', err))
  }

  _setPitchCorrection(node) {
    this.voiceBus.disconnect()
    if (this._pitchCorrection) this._pitchCorrection.disconnect()
    this._pitchCorrection = node
    if (node) {
      this.voiceBus.connect(node)
      node.connect(this.noiseGate.input)
    } else {
      this.voiceBus.connect(this.noiseGate.input)
    }
  }

  get audioEl() {
    return this._els[this._active]
  }

  get _standbyEl() {
    return this._els[1 - this._active]
  }

  get _activeXfadeGain() {
    return this._xfadeGains[this._active].gain
  }

  get _standbyXfadeGain() {
    return this._xfadeGains[1 - this._active].gain
  }

  // 'waiting' fires whenever playback runs out of buffered data - this is
  // completely normal for a second or two while streaming catches up, so
  // this only acts if it's still stalled after STALL_RECOVERY_DELAY_MS with
  // no 'playing' event cancelling the timer in between. 'error' recovers
  // immediately, no delay - a real media error isn't going to resolve itself
  // by waiting. Bound to both crossfade voices; the standby only matters
  // while it's mid-crossfade (otherwise it's deliberately paused).
  _bindRecoveryListeners() {
    for (const el of this._els) {
      el.addEventListener('waiting', () => {
        if (!this.playing || this._stallTimeoutId) return
        if (el !== this.audioEl && !this._crossfading) return
        this._stallTimeoutId = setTimeout(() => {
          this._stallTimeoutId = null
          log.warn(`Sound ${this.soundId} stalled for ${STALL_RECOVERY_DELAY_MS}ms, attempting recovery`)
          this._recover(el)
        }, STALL_RECOVERY_DELAY_MS)
      })

      el.addEventListener('playing', () => {
        if (this._stallTimeoutId) {
          clearTimeout(this._stallTimeoutId)
          this._stallTimeoutId = null
        }
        // A sustained resume is a good sign the stream is healthy again -
        // don't let one bad patch permanently eat into the retry budget for
        // an otherwise long, mostly-fine listening session.
        this._recoveryAttempts = 0
      })

      el.addEventListener('error', () => {
        log.error(`Sound ${this.soundId} audio element error`, el.error)
        if (this.playing && (el === this.audioEl || this._crossfading)) this._recover(el)
      })
    }
  }

  async _recover(el) {
    if (!this.playing) return
    if (this._recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      log.error(`Sound ${this.soundId} gave up after ${MAX_RECOVERY_ATTEMPTS} recovery attempts`)
      return
    }
    this._recoveryAttempts += 1
    const resumeAt = el.currentTime
    log.info(`Sound ${this.soundId} recovery attempt ${this._recoveryAttempts}, resuming at ${resumeAt.toFixed(2)}s`)
    try {
      el.load()
      // load() resets playbackRate to the default (1) per the HTML spec -
      // restore the sound's Speed (x any live pitch drift) so a stall-
      // recovered element doesn't silently revert to 1x.
      el.playbackRate = this._rate
      el.currentTime = resumeAt
      await el.play()
      log.info(`Sound ${this.soundId} recovery attempt ${this._recoveryAttempts} succeeded`)
    } catch (err) {
      log.error(`Sound ${this.soundId} recovery attempt ${this._recoveryAttempts} failed`, err)
    }
  }

  waitForMetadata() {
    if (this.audioEl.readyState >= 1) return Promise.resolve(this.audioEl.duration)
    return new Promise((resolve) => {
      this.audioEl.addEventListener('loadedmetadata', () => resolve(this.audioEl.duration), { once: true })
    })
  }

  setLoopPoints(loopStart, loopEnd) {
    this.loopStart = loopStart
    this.loopEnd = loopEnd
    // Keep an idle standby voice parked at the new loop start so the next
    // crossfade blends from the right place.
    if (!this._crossfading && this._standbyEl.paused) {
      try {
        this._standbyEl.currentTime = this.loopStart
      } catch {
        // seeking a not-yet-loaded element throws; it'll be re-seeked in play()
      }
    }
  }

  hasLoopPoints(loopStart, loopEnd) {
    return this.loopStart === loopStart && this.loopEnd === loopEnd
  }

  // Bug fix: an already-playing sound's filters were only ever set once, at
  // construction time - saving new filters in the Remix plugin updated the
  // library entry, and the Mixer's onShow refresh picked up the new value
  // into state.library, but the already-created LocalFileSoundSource for a
  // sound already in the mix (playing OR just paused - getOrCreateSource
  // reuses any cached source regardless of pause state) kept its original,
  // now-stale filter nodes forever, since nothing ever called back into it.
  // This is the live-update counterpart to that construction-time setup,
  // called from the Mixer's refresh reconciliation once it detects the
  // entry's filters no longer match what this source is actually playing.
  setFilters(filters) {
    this.filters = filters ?? {}
    const now = this.engine.context.currentTime
    this.noiseGate.configure(this.filters)
    this.noiseGate.sync(this.playing)
    this.highpassNode.frequency.setTargetAtTime(this.filters.highpassHz ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.lowpassNode.frequency.setTargetAtTime(this.filters.lowpassHz ?? 20000, now, FILTER_SMOOTHING_SECONDS)
    this.filterGainNode.gain.setTargetAtTime(this.filters.gainDb ? Math.pow(10, this.filters.gainDb / 20) : 1, now, FILTER_SMOOTHING_SECONDS)
    this.echoDelayNode.delayTime.setTargetAtTime((this.filters.echoDelayMs ?? 0) / 1000, now, FILTER_SMOOTHING_SECONDS)
    this.echoSendGain.gain.setTargetAtTime(this.filters.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.echoFeedbackGain.gain.setTargetAtTime(this.filters.echoDecay ?? 0, now, FILTER_SMOOTHING_SECONDS)
    this.reverbSendGain.gain.setTargetAtTime(this.filters.reverbMix ?? 0, now, FILTER_SMOOTHING_SECONDS)
    if (!this.panStage.hasPan(this.filters.pan ?? 0)) this.panStage.setPan(this.filters.pan ?? 0)
    // Regenerating the impulse response is real work (fills a whole buffer of
    // noise samples) and would also restart the convolver's own internal
    // history - only do it when the size actually changed, same "topology
    // fingerprint" guard the EQ chain rebuild uses below.
    const reverbSizeMs = this.filters.reverbSizeMs ?? 0
    if (reverbSizeMs !== this._reverbSizeMs) {
      this._reverbSizeMs = reverbSizeMs
      this.reverbConvolver.buffer = reverbSizeMs > 0 ? createReverbImpulse(this.engine.context, reverbSizeMs / 1000) : null
    }
    // The EQ chain's shape now varies with both how many bands exist AND how
    // many stages each one needs (a plain length check alone can't tell a
    // type/slope change apart from a same-length no-op) - only rebuild the
    // chain (real work: disconnecting/recreating nodes) when the per-band
    // topology fingerprint actually changes; an in-place param update on
    // every node already in a band's own group is enough whenever it
    // hasn't, same pattern as before.
    const eq = this.filters.eq ?? []
    const topology = eq.map(eqBandStageCount).join(',')
    if (topology !== this.eqTopology) {
      this._rebuildEqChain(eq)
    } else {
      this.eqNodeGroups.forEach((group, i) => {
        const band = eq[i]
        // .type isn't an AudioParam - a plain property, so it can't be
        // smoothed like the others below. Only actually reassigned when it
        // changes, since setting it unconditionally every call would reset
        // the filter's internal state (a small click) even when nothing
        // changed.
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

  // Tears down and rebuilds the eqNodes chain to match a new band topology
  // (band count, or any band's own stage count via type/slope) - used both
  // at construction (see the constructor, starting from an empty chain) and
  // whenever setFilters() sees the topology actually change. .disconnect()
  // with no arguments removes every outgoing connection from a node, so
  // this is safe regardless of whether the old chain was empty (lowpassNode
  // wired directly to filterGainNode) or had N nodes in it. New nodes get
  // their values set directly (no smoothing) since there's no previous
  // value on a brand-new node to smooth *from* - matches how the
  // constructor already initializes every other node in this chain. Each
  // band becomes its own internal cascade of eqBandStageCount(band)
  // identical nodes chained in series (1 normally, 4 for a 'steep'
  // filter-shaped band) - stacking identical stages is exactly how a
  // steeper rolloff is achieved, since BiquadFilterNode has no slope
  // parameter of its own.
  _rebuildEqChain(eq) {
    this.lowpassNode.disconnect()
    for (const node of this.eqNodes) node.disconnect()
    this.eqNodeGroups = eq.map((band) => {
      const stageCount = eqBandStageCount(band)
      return Array.from({ length: stageCount }, () => {
        const node = this.engine.context.createBiquadFilter()
        node.type = eqNodeType(band)
        node.frequency.value = band.freqHz
        node.Q.value = band.q
        node.gain.value = band.gainDb
        return node
      })
    })
    this.eqNodes = this.eqNodeGroups.flat()
    this.eqTopology = eq.map(eqBandStageCount).join(',')
    const eqChainEnd = this.eqNodes.reduce((prev, node) => {
      prev.connect(node)
      return node
    }, this.lowpassNode)
    eqChainEnd.connect(this.filterGainNode)
  }

  hasFilters(filters) {
    return JSON.stringify(this.filters ?? {}) === JSON.stringify(filters ?? {})
  }

  setSpeed(speed) {
    this.speed = speed ?? 1
    this._applyPlaybackRate()
    this._syncPitchMode()
  }

  setFluctuation(fluctuation) {
    this._fluctuation.configure(fluctuation ?? {})
    this._fluctuation.sync(this.playing)
    this._syncPitchMode()
  }

  hasFluctuation(fluctuation) {
    return this._fluctuation.key === fluctuationKey(fluctuation)
  }

  hasSpeed(speed) {
    return this.speed === (speed ?? 1)
  }

  setCrossfadeSeconds(crossfadeSeconds) {
    this.crossfadeSeconds = crossfadeSeconds ?? null
  }

  hasCrossfadeSeconds(crossfadeSeconds) {
    return this.crossfadeSeconds === (crossfadeSeconds ?? null)
  }

  _loopEnd() {
    return this.loopEnd ?? this.audioEl.duration
  }

  // Resolved seam-crossfade length: the per-sound override (null -> the app
  // default), clamped to a quarter of the loop region so it can't misbehave
  // on a short region, and 0 whenever the loop end isn't known yet. An
  // explicit 0 (slider at 0ms) returns 0, which _tick() reads as "hard
  // seek-back, no crossfade" - the pre-crossfade behavior, kept as a real
  // opt-out.
  _crossfadeSeconds() {
    const end = this._loopEnd()
    if (!Number.isFinite(end)) return 0
    const region = end - this.loopStart
    if (!(region > 0)) return 0
    const raw = this.crossfadeSeconds ?? DEFAULT_STREAM_CROSSFADE_SECONDS
    return Math.max(0, Math.min(raw, region / 4))
  }

  _tick() {
    if (!this.playing) return
    const end = this._loopEnd()
    if (Number.isFinite(end)) {
      const fade = this._crossfadeSeconds()
      if (fade > 0) {
        // `fade` is wall-clock; at a non-default Speed the active element
        // covers `speed * fade` media-seconds while the ramp runs, so start
        // that much earlier to keep the swap centred on loopEnd.
        if (!this._crossfading && this.audioEl.currentTime >= end - fade * this._rate) {
          this._startCrossfade(fade)
        }
      } else if (this.audioEl.currentTime >= end - LOOP_EPSILON_SECONDS) {
        this.audioEl.currentTime = this.loopStart
      }
    }
    this._rafId = requestAnimationFrame(() => this._tick())
  }

  // Blends the active voice's tail into the standby voice's head over `fade`
  // seconds, then swaps their roles (see _finalizeCrossfade). The standby is
  // started from loopStart right now - its first few ms may be near-silent
  // if the element hasn't resumed yet, but under a ramp that starts at gain
  // 0 that contribution is inaudible, and on every loop after the first the
  // standby is a warm, already-buffered element.
  _startCrossfade(fade) {
    this._crossfading = true
    const ctx = this.engine.context
    const now = ctx.currentTime
    const standby = this._standbyEl
    try {
      standby.currentTime = this.loopStart
    } catch {
      // not loaded yet - extremely unlikely this deep into playback; the
      // ramp below still runs and the element catches up
    }
    standby.playbackRate = this._rate
    standby.play().catch(() => {})

    const activeGain = this._activeXfadeGain
    const standbyGain = this._standbyXfadeGain
    rampEqualPower(activeGain, now, fade, activeGain.value, 0)
    rampEqualPower(standbyGain, now, fade, standbyGain.value, 1)

    if (this._crossfadeTimeoutId) clearTimeout(this._crossfadeTimeoutId)
    this._crossfadeTimeoutId = setTimeout(() => {
      this._crossfadeTimeoutId = null
      this._finalizeCrossfade()
    }, fade * 1000 + 40)
  }

  // Completes a crossfade: the standby voice becomes active, the old active
  // voice is paused, rewound to loopStart, and becomes the new standby.
  // Also called synchronously from pause() when a crossfade is in flight, so
  // a pause mid-seam resumes cleanly from just after the loop point rather
  // than from a half-faded state.
  _finalizeCrossfade() {
    const ctx = this.engine.context
    const now = ctx.currentTime
    const retiring = this.audioEl

    this._active = 1 - this._active

    // Snap to exact end-state gains regardless of where the ramps landed.
    this._activeXfadeGain.cancelScheduledValues(now)
    this._activeXfadeGain.setValueAtTime(1, now)
    this._standbyXfadeGain.cancelScheduledValues(now)
    this._standbyXfadeGain.setValueAtTime(0, now)

    try {
      retiring.pause()
    } catch {
      // ignore
    }
    try {
      retiring.currentTime = this.loopStart
    } catch {
      // ignore
    }
    this._crossfading = false
  }

  async play() {
    if (this.playing) return
    if (this._pauseTimeoutId) {
      clearTimeout(this._pauseTimeoutId)
      this._pauseTimeoutId = null
    }

    const ctx = this.engine.context
    // A prior pause may have interrupted a crossfade and left the gains
    // mid-ramp - reset to the clean active/standby state before resuming.
    if (this._crossfadeTimeoutId) {
      clearTimeout(this._crossfadeTimeoutId)
      this._crossfadeTimeoutId = null
    }
    this._crossfading = false
    const resetAt = ctx.currentTime
    this._activeXfadeGain.cancelScheduledValues(resetAt)
    this._activeXfadeGain.setValueAtTime(1, resetAt)
    this._standbyXfadeGain.cancelScheduledValues(resetAt)
    this._standbyXfadeGain.setValueAtTime(0, resetAt)

    this._applyPlaybackRate()
    try {
      if (this._standbyEl.paused) this._standbyEl.currentTime = this.loopStart
    } catch {
      // ignore - re-seeked at the next crossfade
    }

    const end = this._loopEnd()
    if (this.audioEl.currentTime < this.loopStart || (Number.isFinite(end) && this.audioEl.currentTime >= end)) {
      this.audioEl.currentTime = this.loopStart
    }
    await this.audioEl.play()
    const now = ctx.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(this.volume, now + RAMP_SECONDS)
    this.playing = true
    this._fluctuation.sync(true)
    this.noiseGate.sync(true)
    this._tick()
  }

  pause() {
    if (!this.playing) return
    const now = this.engine.context.currentTime
    this.gainNode.gain.cancelScheduledValues(now)
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now)
    this.gainNode.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS)
    this.playing = false
    this._fluctuation.stop()
    this.noiseGate.sync(false)
    if (this._rafId) cancelAnimationFrame(this._rafId)
    if (this._pauseTimeoutId) clearTimeout(this._pauseTimeoutId)
    if (this._stallTimeoutId) {
      clearTimeout(this._stallTimeoutId)
      this._stallTimeoutId = null
    }
    if (this._crossfadeTimeoutId) {
      clearTimeout(this._crossfadeTimeoutId)
      this._crossfadeTimeoutId = null
      this._finalizeCrossfade()
    }
    this._pauseTimeoutId = setTimeout(() => {
      this._pauseTimeoutId = null
      for (const el of this._els) el.pause()
    }, RAMP_SECONDS * 1000 + 20)
  }

  setVolume(volume) {
    this.volume = volume
    if (this.playing) {
      const now = this.engine.context.currentTime
      this.gainNode.gain.cancelScheduledValues(now)
      this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.05)
    }
  }

  dispose() {
    this.playing = false
    this._disposed = true
    this._fluctuation.dispose()
    if (this._rafId) cancelAnimationFrame(this._rafId)
    if (this._pauseTimeoutId) clearTimeout(this._pauseTimeoutId)
    if (this._stallTimeoutId) clearTimeout(this._stallTimeoutId)
    if (this._crossfadeTimeoutId) {
      clearTimeout(this._crossfadeTimeoutId)
      this._crossfadeTimeoutId = null
    }
    for (const el of this._els) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    for (const node of this._srcNodes) node.disconnect()
    for (const gain of this._xfadeGains) gain.disconnect()
    this.voiceBus.disconnect()
    this._pitchCorrection?.disconnect()
    this.noiseGate.dispose()
    this.highpassNode.disconnect()
    this.lowpassNode.disconnect()
    for (const node of this.eqNodes) node.disconnect()
    this.filterGainNode.disconnect()
    this.echoDelayNode.disconnect()
    this.echoSendGain.disconnect()
    this.echoFeedbackGain.disconnect()
    this.reverbSendGain.disconnect()
    this.reverbConvolver.disconnect()
    this.fluctuationGain.disconnect()
    this.panStage.dispose()
    this.driftPanStage.dispose()
    this.gainNode.disconnect()
  }
}
