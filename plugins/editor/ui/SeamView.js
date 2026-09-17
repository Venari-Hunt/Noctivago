import { resizeCanvasForDisplay } from '../audio/waveform.js'
import { loopLayout, clipToSource } from '../audio/loopLayout.js'

// "Loop seam" strip (v0.1.222): the loop drawn the way it actually plays,
// laid out like a DAW's overlapping-tail crossfade (the owner's reference):
//
//   [ second half of the trim ][ X crossfade X ][ first half of the trim ]
//
// The clip starts and ends mid-trim on one continuous recording, so the
// only edit is the original end -> start join, under the crossfade in the
// middle (loopLayout.js / loopClip.js). Inside the overlap both sides are
// drawn with their equal-power gain applied. Dragging either overlap edge
// sets the crossfade length (both edges move together, around the center),
// double-clicking an edge resets it, and pressing anywhere else scrubs.
// Times handed in and out are clip times (0..layout.length).

const EDGE_HIT_PX = 8
const CURVE_STEPS = 32
const COLORS = {
  background: '#161a2b',
  secondHalf: 'rgba(122, 162, 247, 0.10)',
  firstHalf: 'rgba(158, 206, 106, 0.08)',
  wave: 'rgba(122, 162, 247, 0.65)',
  tailWave: 'rgba(122, 162, 247, 0.55)',
  headWave: 'rgba(158, 206, 106, 0.55)',
  hatch: 'rgba(255, 255, 255, 0.07)',
  overlap: 'rgba(255, 255, 255, 0.05)',
  edge: 'rgba(255, 255, 255, 0.85)',
  tailCurve: '#7aa2f7',
  headCurve: '#9ece6a',
  label: '#c0caf5',
  dim: '#8892b0',
  playhead: '#ff9e64'
}

export function createSeamViewController(canvas) {
  let loopStart = 0
  let loopEnd = 0
  let fadeSec = 0
  let maxSec = 2
  let stepSec = 0.01
  let defaultSec = 0.2
  let enabled = true
  let peaks = null
  let peaksStart = 0
  let peaksEnd = 0
  let playhead = null
  let dragging = null
  let onChange = () => {}
  let onScrub = () => {}

  const layout = () => loopLayout(loopStart, loopEnd, enabled ? fadeSec : 0)

  function peakAt(t) {
    if (!peaks || peaks.length === 0 || peaksEnd <= peaksStart) return [0, 0]
    const idx = Math.floor(((t - peaksStart) / (peaksEnd - peaksStart)) * peaks.length)
    return peaks[Math.min(peaks.length - 1, Math.max(0, idx))]
  }

  function fillWave(ctx, x0, x1, width, mid, sample, color) {
    const from = Math.max(0, Math.floor(x0))
    const to = Math.min(width, Math.ceil(x1))
    if (to <= from) return
    ctx.beginPath()
    for (let x = from; x <= to; x++) ctx.lineTo(x, mid - sample(x)[1] * mid * 0.85)
    for (let x = to; x >= from; x--) ctx.lineTo(x, mid - sample(x)[0] * mid * 0.85)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }

  function label(ctx, text, x, align, color = COLORS.label) {
    ctx.fillStyle = color
    ctx.font = '10px sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign = align
    ctx.fillText(text, x, 4)
  }

  function redraw() {
    const { width, height, dpr } = resizeCanvasForDisplay(canvas)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, width, height)
    const L = layout()
    if (!(L.length > 0)) return
    const mid = height / 2
    const xOf = (t) => (t / L.length) * width
    const tOf = (x) => (x / width) * L.length
    const bx0 = xOf(L.blendStart)
    const bx1 = xOf(L.blendEnd)

    ctx.fillStyle = COLORS.secondHalf
    ctx.fillRect(0, 0, bx0, height)
    ctx.fillStyle = COLORS.firstHalf
    ctx.fillRect(bx1, 0, width - bx1, height)

    const plain = (x) => {
      const [min, max] = peakAt(clipToSource(L, tOf(x)))
      return [min, max]
    }
    if (L.fade > 0) {
      fillWave(ctx, 0, bx0, width, mid, plain, COLORS.wave)
      fillWave(ctx, bx1, width, width, mid, plain, COLORS.wave)

      // Overlap: hatched, both sides drawn at their equal-power gain.
      ctx.fillStyle = COLORS.overlap
      ctx.fillRect(bx0, 0, bx1 - bx0, height)
      ctx.save()
      ctx.beginPath()
      ctx.rect(bx0, 0, bx1 - bx0, height)
      ctx.clip()
      ctx.strokeStyle = COLORS.hatch
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = bx0 - height; x < bx1; x += 6) {
        ctx.moveTo(x, height)
        ctx.lineTo(x + height, 0)
      }
      ctx.stroke()
      const phase = (x) => Math.min(Math.max((tOf(x) - L.blendStart) / L.fade, 0), 1) * (Math.PI / 2)
      const scaled = (source, gain) => (x) => {
        const [min, max] = peakAt(source(x))
        const g = gain(x)
        return [min * g, max * g]
      }
      const tail = (x) => L.loopEnd - L.fade + (tOf(x) - L.blendStart)
      const head = (x) => L.loopStart + (tOf(x) - L.blendStart)
      fillWave(ctx, bx0, bx1, width, mid, scaled(tail, (x) => Math.cos(phase(x))), COLORS.tailWave)
      fillWave(ctx, bx0, bx1, width, mid, scaled(head, (x) => Math.sin(phase(x))), COLORS.headWave)

      // The X: the end of the trim fading out (blue) and its start fading in
      // (green). Equal-power curves cross at ~71% rather than halfway.
      const curve = (gain, color) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let i = 0; i <= CURVE_STEPS; i++) {
          const a = (i / CURVE_STEPS) * (Math.PI / 2)
          const x = bx0 + (bx1 - bx0) * (i / CURVE_STEPS)
          const y = height - gain(a) * (height - 2)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      curve(Math.cos, COLORS.tailCurve)
      curve(Math.sin, COLORS.headCurve)
      ctx.restore()

      ctx.strokeStyle = COLORS.edge
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(bx0, 0)
      ctx.lineTo(bx0, height)
      ctx.moveTo(bx1, 0)
      ctx.lineTo(bx1, height)
      ctx.stroke()

      label(ctx, '2nd half of trim', 5, 'left')
      label(ctx, '1st half of trim', width - 5, 'right')
      if (bx0 > 90) label(ctx, `${L.fade.toFixed(2)} s`, (bx0 + bx1) / 2, 'center')
    } else {
      fillWave(ctx, 0, width, width, mid, plain, COLORS.wave)
      label(ctx, 'Start of trim', 5, 'left')
      label(ctx, 'End of trim', width - 5, 'right')
      label(ctx, enabled ? 'Crossfade off: the loop restarts with a hard cut. Drag from the middle to add one.' : 'Doppler is on: no crossfade', width / 2, 'center', COLORS.dim)
      if (enabled) {
        ctx.strokeStyle = COLORS.edge
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(width / 2, 18)
        ctx.lineTo(width / 2, height)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    if (Number.isFinite(playhead)) {
      const x = xOf(Math.min(Math.max(playhead, 0), L.length))
      ctx.strokeStyle = COLORS.playhead
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
  }

  function edgeHit(x, width) {
    if (!enabled) return false
    const L = layout()
    if (!(L.length > 0)) return false
    const center = width / 2
    if (L.fade <= 0) return Math.abs(x - center) <= EDGE_HIT_PX
    const half = ((L.fade / 2) / L.length) * width
    return Math.abs(Math.abs(x - center) - half) <= EDGE_HIT_PX
  }

  // The overlap is always centered, so its half-width d (px) fixes the fade:
  // d / width = (f / 2) / (trim - f)  =>  f = 2 d trim / (width + 2 d).
  function fadeForX(x, width) {
    const trim = Math.max(0, loopEnd - loopStart)
    const d = Math.abs(x - width / 2)
    const raw = (2 * d * trim) / (width + 2 * d)
    const cap = Math.min(maxSec, trim / 4)
    const snapped = Math.round(Math.min(raw, cap) / stepSec) * stepSec
    return Math.min(Math.max(snapped, 0), cap)
  }

  function scrubAt(x, width) {
    const L = layout()
    playhead = Math.min(Math.max((x / width) * L.length, 0), L.length)
    redraw()
    onScrub(playhead)
  }

  function pointerDown(evt) {
    if (evt.button !== 0 || !(loopEnd > loopStart)) return
    const rect = canvas.getBoundingClientRect()
    const x = evt.clientX - rect.left
    dragging = edgeHit(x, rect.width) ? 'edge' : 'scrub'
    if (dragging === 'scrub') scrubAt(x, rect.width)
  }

  function pointerMove(evt) {
    const rect = canvas.getBoundingClientRect()
    const x = evt.clientX - rect.left
    if (!dragging) {
      if (evt.target === canvas) canvas.style.cursor = edgeHit(x, rect.width) ? 'ew-resize' : 'pointer'
      return
    }
    if (dragging === 'scrub') {
      scrubAt(Math.min(Math.max(x, 0), rect.width), rect.width)
      return
    }
    const next = fadeForX(x, rect.width)
    if (next !== fadeSec) {
      fadeSec = next
      redraw()
      onChange(fadeSec)
    }
  }

  function pointerUp() {
    dragging = null
  }

  function doubleClick(evt) {
    const rect = canvas.getBoundingClientRect()
    if (!edgeHit(evt.clientX - rect.left, rect.width)) return
    fadeSec = defaultSec
    redraw()
    onChange(fadeSec)
  }

  canvas.addEventListener('mousedown', pointerDown)
  canvas.addEventListener('dblclick', doubleClick)
  window.addEventListener('mousemove', pointerMove)
  window.addEventListener('mouseup', pointerUp)
  window.addEventListener('resize', redraw)

  return {
    setLoop(newStart, newEnd) {
      loopStart = newStart
      loopEnd = newEnd
      redraw()
    },
    setCrossfade(seconds) {
      fadeSec = Math.max(0, seconds || 0)
      redraw()
    },
    setLimits({ maxSeconds, stepSeconds, defaultSeconds }) {
      maxSec = maxSeconds
      stepSec = stepSeconds
      defaultSec = defaultSeconds
    },
    // false while Doppler is on - its bake has no crossfade.
    setEnabled(value) {
      enabled = Boolean(value)
      redraw()
    },
    // peaks: [min, max] pairs spanning [rangeStart, rangeEnd] of the source.
    setPeaks(newPeaks, rangeStart, rangeEnd) {
      peaks = newPeaks
      peaksStart = rangeStart
      peaksEnd = rangeEnd
      redraw()
    },
    setPlayhead(clipTime) {
      playhead = clipTime
      redraw()
    },
    getLayout: layout,
    redraw,
    onCrossfadeChange(fn) {
      onChange = fn
    },
    onScrub(fn) {
      onScrub = fn
    },
    destroy() {
      canvas.removeEventListener('mousedown', pointerDown)
      canvas.removeEventListener('dblclick', doubleClick)
      window.removeEventListener('mousemove', pointerMove)
      window.removeEventListener('mouseup', pointerUp)
      window.removeEventListener('resize', redraw)
    }
  }
}
