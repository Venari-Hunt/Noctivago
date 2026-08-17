// Draggable-node parametric EQ editor - a scoped-down take on FL Studio's
// "Fruity Parametric EQ 2" (the reference the user showed a screenshot of,
// see noctivago_remix_eq_future memory): fixed band count (matches
// library.js's defaultEqBands - no add/remove-node UI, a deliberate scope
// cut to keep this buildable in one pass rather than a fully dynamic node
// system), each band draggable by frequency (X, log scale) and gain (Y),
// with Q adjustable via mouse wheel while hovering a node. The connecting
// line between nodes is a straight polyline through each band's own
// (freq, gain) point, not the true composite biquad response curve (that
// needs evaluating each peaking filter's transfer function and summing in
// dB - a real enhancement, deliberately skipped for this pass) - still an
// honest, useful visual of what the six control points are doing, just not
// pixel-accurate to the actual filtered sound.

const FREQ_MIN = 20
const FREQ_MAX = 20000
const GAIN_MIN = -24
const GAIN_MAX = 24
export const Q_MIN = 0.1
export const Q_MAX = 10
const HIT_PX = 14
const Q_WHEEL_STEP = 0.08

function freqToX(freqHz, width) {
  const logMin = Math.log10(FREQ_MIN)
  const logMax = Math.log10(FREQ_MAX)
  const t = (Math.log10(Math.max(FREQ_MIN, freqHz)) - logMin) / (logMax - logMin)
  return t * width
}

function xToFreq(x, width) {
  const logMin = Math.log10(FREQ_MIN)
  const logMax = Math.log10(FREQ_MAX)
  const t = Math.min(Math.max(x / width, 0), 1)
  return Math.pow(10, logMin + t * (logMax - logMin))
}

// GAIN_MAX maps to y=0 (top of canvas) - canvas y grows downward, dB grows
// upward, so this is deliberately inverted from a naive linear map.
function gainToY(gainDb, height) {
  const t = (gainDb - GAIN_MAX) / (GAIN_MIN - GAIN_MAX)
  return t * height
}

function yToGain(y, height) {
  const t = Math.min(Math.max(y / height, 0), 1)
  return GAIN_MAX + t * (GAIN_MIN - GAIN_MAX)
}

function formatFreqLabel(freqHz) {
  return freqHz >= 1000 ? `${freqHz / 1000}k` : String(freqHz)
}

// BUG FIX: the canvas's internal bitmap resolution (its width/height
// attributes, 640x140) and its actual rendered CSS size (getBoundingClientRect,
// ~1319x140 here since #editor-eq-canvas is styled `width: 100%`) don't
// match - the browser stretches the smaller bitmap to fill the larger CSS
// box, non-uniformly (only horizontally, in this case). Interaction math was
// already fixed to work in CSS-pixel space (see nearestBandIndex/pointerMove
// above), but drawEq was still drawing in raw bitmap-pixel space, so every
// circular node rendered as a stretched ellipse and every text label came
// out visibly distorted too - reported directly by the user ("why does it
// seem like the nodes are stretched vertically? And also the numbers").
// Fixed by resizing the canvas's actual bitmap resolution to match its
// rendered CSS size (times devicePixelRatio, for crisp non-blurry drawing on
// high-DPI displays) before every draw, then scaling the context by that
// same ratio so all the drawing code below can keep working in plain
// CSS-pixel coordinates - eliminates the stretch entirely rather than
// working around it.
function resizeCanvasForDisplay(canvas) {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const targetWidth = Math.max(1, Math.round(rect.width * dpr))
  const targetHeight = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }
  return { width: rect.width, height: rect.height, dpr }
}

// Backdrop bars showing roughly how much energy the sound actually has
// around a handful of fixed reference frequencies (see index.js's
// loadSound(), which computes this once via a bandpass-filtered ffmpeg pass
// per frequency - src/main/ffmpeg/bandEnergy.js). A static, load-time-only
// reference - shown whenever the live spectrum below isn't (i.e. whenever
// nothing is actively playing), so there's still useful visual context
// before ever pressing Play. Drawn at FIXED positions (whatever frequencies
// were passed to setBandEnergy, independent of where the user later drags
// any EQ node) so there's no ambiguity about a bar "belonging" to a
// draggable node.
function drawBandEnergyBackdrop(ctx, width, height, freqs, energies) {
  if (!freqs || !energies || freqs.length === 0) return
  const maxEnergy = Math.max(...energies, 0.0001)
  const barWidth = 28
  ctx.fillStyle = 'rgba(122, 162, 247, 0.16)'
  freqs.forEach((freqHz, i) => {
    const x = freqToX(freqHz, width)
    const normalized = Math.min(1, energies[i] / maxEnergy)
    const barHeight = normalized * height * 0.92
    ctx.fillRect(x - barWidth / 2, height - barHeight, barWidth, barHeight)
  })
}

// The real, live-reacting spectrum analyzer (what the user was actually
// referencing by "the frequencies light up in pink" - the static backdrop
// above was a reasonable-looking but fundamentally different thing, a
// one-time snapshot rather than something that responds to playback).
// freqData is a Uint8Array from AnalyserNode.getByteFrequencyData() - each
// bin already dB-scaled to 0-255 by the Web Audio API itself (mapped from
// the analyser's minDecibels/maxDecibels), so no extra scaling is needed
// here for it to look perceptually reasonable, unlike a raw linear FFT
// magnitude array. Bins are linearly spaced in frequency (unlike this
// graph's log-frequency X axis) - drawn as a filled area connecting each
// bin's (freq, magnitude) point via freqToX, which naturally compresses
// many high-frequency bins into few pixels and spreads low-frequency bins
// out, same as any real log-frequency spectrum display built from a linear
// FFT. Pink/red (var(--danger) elsewhere in this app) to match the FL
// Studio reference this was modeled on.
function drawLiveSpectrum(ctx, width, height, freqData, sampleRate) {
  if (!freqData) return
  const binHz = sampleRate / 2 / freqData.length
  ctx.beginPath()
  ctx.moveTo(0, height)
  for (let i = 0; i < freqData.length; i++) {
    const freqHz = (i + 0.5) * binHz
    if (freqHz < FREQ_MIN) continue
    if (freqHz > FREQ_MAX) break
    const x = freqToX(freqHz, width)
    const magnitude = freqData[i] / 255
    const y = height - magnitude * height * 0.92
    ctx.lineTo(x, y)
  }
  ctx.lineTo(width, height)
  ctx.closePath()
  ctx.fillStyle = 'rgba(247, 118, 142, 0.4)'
  ctx.fill()
}

function drawEq(canvas, bands, selectedIndex, bandEnergy, liveSpectrum) {
  const { width, height, dpr } = resizeCanvasForDisplay(canvas)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  ctx.font = '10px sans-serif'
  ctx.textBaseline = 'middle'

  for (const g of [-24, -12, 0, 12, 24]) {
    const y = gainToY(g, height)
    ctx.strokeStyle = g === 0 ? '#3b3f58' : 'rgba(59, 63, 88, 0.5)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
    ctx.fillStyle = '#8892b0'
    ctx.fillText(`${g > 0 ? '+' : ''}${g}`, 4, Math.min(Math.max(y, 8), height - 8))
  }

  for (const f of [100, 1000, 10000]) {
    const x = freqToX(f, width)
    ctx.strokeStyle = 'rgba(59, 63, 88, 0.5)'
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
    ctx.fillStyle = '#8892b0'
    ctx.fillText(formatFreqLabel(f), x + 3, height - 10)
  }

  // Live spectrum takes over from the static backdrop whenever it's
  // actually available (i.e. something's playing) - it's strictly more
  // informative once there's real signal to show, matching the FL Studio
  // reference behavior directly rather than leaving the static bars up
  // during playback too.
  if (liveSpectrum) drawLiveSpectrum(ctx, width, height, liveSpectrum.freqData, liveSpectrum.sampleRate)
  else if (bandEnergy) drawBandEnergyBackdrop(ctx, width, height, bandEnergy.freqs, bandEnergy.energies)

  if (bands.length > 0) {
    const sorted = [...bands].sort((a, b) => a.freqHz - b.freqHz)
    ctx.strokeStyle = '#7aa2f7'
    ctx.lineWidth = 2
    ctx.beginPath()
    sorted.forEach((band, i) => {
      const x = freqToX(band.freqHz, width)
      const y = gainToY(band.gainDb, height)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  bands.forEach((band, i) => {
    const x = freqToX(band.freqHz, width)
    const y = gainToY(band.gainDb, height)
    ctx.beginPath()
    ctx.arc(x, y, i === selectedIndex ? 8 : 6, 0, Math.PI * 2)
    ctx.fillStyle = i === selectedIndex ? '#f7768e' : '#7aa2f7'
    ctx.fill()
    ctx.strokeStyle = '#1a1b26'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })
}

export function createEqEditorController(canvas) {
  let bands = []
  let selectedIndex = -1
  let dragging = false
  let bandEnergy = null
  let liveSpectrum = null
  let freqDataBuffer = null
  let onChange = () => {}
  let onDoubleClick = () => {}

  function redraw() {
    drawEq(canvas, bands, selectedIndex, bandEnergy, liveSpectrum)
  }

  // Interaction math (hit-testing, drag, wheel) works in the canvas's
  // *rendered CSS pixel* space (getBoundingClientRect), not its internal
  // bitmap resolution (canvas.width/height, used only by drawEq for actual
  // drawing) - the two differ whenever CSS stretches the canvas (here,
  // #editor-eq-canvas is `width: 100%`), exactly the same displayWidth-vs-
  // canvas.width split LoopEditor.js's xToTime/timeToX already establish.
  // Mixing the two spaces (an earlier version of this file did) makes every
  // mouse coordinate land in the wrong place relative to where nodes are
  // actually drawn - caught via a real CDP drag test before this shipped,
  // not by code review alone.
  function nearestBandIndex(x, y, width, height) {
    let best = -1
    let bestDist = Infinity
    bands.forEach((band, i) => {
      const bx = freqToX(band.freqHz, width)
      const by = gainToY(band.gainDb, height)
      const dist = Math.hypot(x - bx, y - by)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    return bestDist <= HIT_PX ? best : -1
  }

  function eventPos(evt) {
    const rect = canvas.getBoundingClientRect()
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top, width: rect.width, height: rect.height }
  }

  function pointerDown(evt) {
    const { x, y, width, height } = eventPos(evt)
    const idx = nearestBandIndex(x, y, width, height)
    if (idx === -1) return
    selectedIndex = idx
    dragging = true
    redraw()
    onChange(getBands(), selectedIndex)
  }

  function pointerMove(evt) {
    if (!dragging || selectedIndex === -1) return
    const { x, y, width, height } = eventPos(evt)
    const band = bands[selectedIndex]
    band.freqHz = Math.round(xToFreq(x, width))
    band.gainDb = Math.round(yToGain(y, height) * 10) / 10
    redraw()
    onChange(getBands(), selectedIndex)
  }

  function pointerUp() {
    dragging = false
  }

  // Mirrors the app-wide "double-click a slider resets it to default"
  // convention (src/renderer/core/sliderReset.js) - requested directly by
  // the user for EQ nodes specifically, since they're custom canvas-drawn
  // shapes rather than real <input type="range"> elements, so that
  // delegated document-level listener can't reach them. A native `dblclick`
  // rather than manually tracking click timing - the two mousedown/mouseup
  // pairs it's built from already ran through pointerDown/pointerMove/
  // pointerUp above (possibly nudging the node very slightly from real-world
  // click jitter), but the reset below overwrites that regardless, so it
  // doesn't matter. What "default" means is intentionally left to the
  // caller (see index.js's onDoubleClick wiring) - this controller has no
  // opinion on where a band "started."
  function handleDoubleClick(evt) {
    const { x, y, width, height } = eventPos(evt)
    const idx = nearestBandIndex(x, y, width, height)
    if (idx === -1) return
    onDoubleClick(idx)
  }

  // Q has no natural drag axis (both X and Y are already spoken for by
  // freq/gain) - mouse wheel while hovering a node is the same convention
  // several real DAW EQ UIs use for exactly this reason.
  function handleWheel(evt) {
    const { x, y, width, height } = eventPos(evt)
    const idx = nearestBandIndex(x, y, width, height)
    if (idx === -1) return
    evt.preventDefault()
    const band = bands[idx]
    const factor = evt.deltaY < 0 ? 1 + Q_WHEEL_STEP : 1 / (1 + Q_WHEEL_STEP)
    band.q = Math.min(Q_MAX, Math.max(Q_MIN, Math.round(band.q * factor * 100) / 100))
    selectedIndex = idx
    redraw()
    onChange(getBands(), selectedIndex)
  }

  function getBands() {
    return bands.map((b) => ({ ...b }))
  }

  // Redraws (which also re-syncs the canvas's bitmap resolution to its
  // current rendered size - see resizeCanvasForDisplay) whenever the panel's
  // own size might have changed, so the graph doesn't drift back out of
  // sync with its box after a window resize.
  function handleResize() {
    redraw()
  }

  canvas.addEventListener('mousedown', pointerDown)
  window.addEventListener('mousemove', pointerMove)
  window.addEventListener('mouseup', pointerUp)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  canvas.addEventListener('dblclick', handleDoubleClick)
  window.addEventListener('resize', handleResize)

  return {
    load(newBands) {
      bands = newBands.map((b) => ({ ...b }))
      selectedIndex = bands.length > 0 ? 0 : -1
      // A fresh sound's band-energy analysis hasn't arrived yet (it's an
      // async ffmpeg round-trip, see index.js's loadSound()) - clear any
      // previous sound's backdrop immediately rather than leaving it up
      // showing stale data until the new one resolves.
      bandEnergy = null
      liveSpectrum = null
      redraw()
    },
    getBands,
    // freqs/energies are parallel arrays - see bandEnergy.js's
    // computeBandEnergy for where energies comes from. Passing freqs
    // alongside rather than assuming they match the current bands keeps
    // this backdrop decoupled from whatever the user has dragged nodes to.
    setBandEnergy(freqs, energies) {
      bandEnergy = freqs && energies ? { freqs, energies } : null
      redraw()
    },
    // Called once per frame from index.js's existing tickPreviewPlayhead()
    // rAF loop while the preview is actually playing - reads the live
    // AnalyserNode tapped off PreviewSource's combined output (see
    // PreviewSource.js) and redraws. Reuses a single Uint8Array across calls
    // rather than allocating a fresh one every frame.
    tickSpectrum(analyserNode) {
      if (!analyserNode) return
      if (!freqDataBuffer || freqDataBuffer.length !== analyserNode.frequencyBinCount) {
        freqDataBuffer = new Uint8Array(analyserNode.frequencyBinCount)
      }
      analyserNode.getByteFrequencyData(freqDataBuffer)
      liveSpectrum = { freqData: freqDataBuffer, sampleRate: analyserNode.context.sampleRate }
      redraw()
    },
    // Falls back to the static band-energy backdrop (if any) - called when
    // playback stops, so the graph doesn't freeze on the last live frame
    // forever.
    clearSpectrum() {
      if (!liveSpectrum) return
      liveSpectrum = null
      redraw()
    },
    getSelectedIndex() {
      return selectedIndex
    },
    setSelectedIndex(index) {
      if (index < -1 || index >= bands.length) return
      selectedIndex = index
      redraw()
    },
    // Precision entry path (numeric fields in index.js), mirrors how
    // LoopEditor's Start/End/Length text inputs complement its own
    // draggable handles - a directly-typed value updates the same band the
    // canvas drag would, then redraws so the node visibly jumps to match.
    setSelectedBand(patch) {
      if (selectedIndex === -1 || !bands[selectedIndex]) return
      Object.assign(bands[selectedIndex], patch)
      redraw()
    },
    onChange(cb) {
      onChange = cb
    },
    onDoubleClick(cb) {
      onDoubleClick = cb
    },
    destroy() {
      window.removeEventListener('mousemove', pointerMove)
      window.removeEventListener('mouseup', pointerUp)
      window.removeEventListener('resize', handleResize)
      canvas.removeEventListener('dblclick', handleDoubleClick)
    }
  }
}
