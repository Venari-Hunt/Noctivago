function formatTick(seconds, showHours) {
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60) % 60
  if (showHours) {
    const h = Math.floor(seconds / 3600)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function pickTickStep(span, width) {
  const targetTicks = Math.max(2, Math.floor(width / 80))
  const rawStep = span / targetTicks
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
  return steps.find((s) => s >= rawStep) ?? steps[steps.length - 1]
}

// BUG FIX: this canvas's internal bitmap resolution (its width/height HTML
// attributes, 640x160) didn't match its actual rendered CSS size
// (getBoundingClientRect - #editor-canvas is styled `width: 100%`, so it
// stretches to fill the panel, well past 640px on any normal window width).
// The browser scales the smaller bitmap up non-uniformly to fill the larger
// box, which is exactly what "stretched and blurry" looks like - reported
// directly by the user. Same root cause and same fix as the EQ graph's own
// identical bug (see EqEditor.js's resizeCanvasForDisplay, added first) -
// this canvas just never got the equivalent fix when the EQ one shipped,
// since it predates that work and nobody had reported it yet. Resizes the
// canvas's actual bitmap resolution to its rendered CSS size (times
// devicePixelRatio, for crisp non-blurry drawing on high-DPI displays too,
// not just non-stretched) before every draw, then scales the context so all
// the drawing code below keeps working in plain CSS-pixel coordinates
// unchanged. A useful side effect: the per-column waveform loop below now
// draws one segment per real screen pixel instead of per bitmap pixel, so
// the line is measurably smoother/more detailed on a wide window too, not
// just non-stretched.
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

// viewStart/viewEnd (defaulting to the full [0, duration] range) let the
// zoomed-in LoopEditor draw just a window of the waveform instead of the
// whole file. peaks itself stays a fixed-resolution array spanning the
// *full* duration (one entry per pixel column at full zoom-out) - zooming
// in resamples that same array rather than fetching finer-grained peaks
// from ffmpeg (a bigger, separately-tracked backlog item: real detail past
// the original resolution needs new data, not just a smarter draw). What
// changed here (researched against how DAWs/waveform libraries actually
// render - see CLAUDE.md's Status entry) is *how* that resampling is drawn:
// linearly interpolating between neighboring peak points (instead of
// flooring to the nearest one) and connecting them as one continuous filled
// polygon (instead of independent per-column line segments) removes the
// visible staircase/blocky look at high zoom. This is honestly cosmetic
// smoothing of the same coarse data, not new precision - past the original
// resolution there's still no more *real* detail to show, it just no longer
// looks like discrete blocks while there isn't.
// peaksStart/peaksEnd describe what time range `peaks` itself spans - default
// [0, duration] for the base full-file array, but a finer-grained detail
// fetch (see waveformPeaks.js) covers just a narrow zoomed window instead,
// so the caller passes that window's own bounds here rather than this
// function assuming peaks always covers the whole file.
export function drawWaveform(canvas, duration, { loopStart, loopEnd, playhead, peaks, viewStart = 0, viewEnd = duration, peaksStart = 0, peaksEnd = duration, dopplerEnabled = false }) {
  const { width, height, dpr } = resizeCanvasForDisplay(canvas)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const mid = height / 2

  ctx.clearRect(0, 0, width, height)

  if (!Number.isFinite(duration) || duration <= 0) return

  const viewSpan = viewEnd - viewStart
  const timeToX = (t) => ((t - viewStart) / viewSpan) * width

  const startX = timeToX(loopStart)
  const endX = timeToX(loopEnd)

  ctx.fillStyle = 'rgba(122, 162, 247, 0.35)'
  ctx.fillRect(startX, 0, endX - startX, height)

  // Doppler visual: the loop region's own midpoint is the "closest" point
  // (pitch bends back to natural exactly there), Start/End are both
  // "furthest" (maximally pitch-shifted, up at Start, down at End) - a soft
  // warm glow peaking at the midpoint and fading toward both edges reads as
  // "closeness" at a glance, backed by an explicit marker line + pin so it's
  // unambiguous even without the gradient. Drawn under the waveform fill (so
  // the waveform stays fully legible on top) but over the plain trim tint.
  if (dopplerEnabled && loopEnd > loopStart) {
    const gradient = ctx.createLinearGradient(startX, 0, endX, 0)
    gradient.addColorStop(0, 'rgba(224, 175, 104, 0)')
    gradient.addColorStop(0.5, 'rgba(224, 175, 104, 0.45)')
    gradient.addColorStop(1, 'rgba(224, 175, 104, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(startX, 0, endX - startX, height)
  }

  if (peaks && peaks.length > 0) {
    const peaksSpan = peaksEnd - peaksStart
    const maxY = new Array(width)
    const minY = new Array(width)
    for (let x = 0; x < width; x++) {
      const t = viewStart + (x / width) * viewSpan
      const idx = Math.min(peaks.length - 1, Math.max(0, ((t - peaksStart) / peaksSpan) * peaks.length))
      const i0 = Math.min(peaks.length - 1, Math.floor(idx))
      const i1 = Math.min(peaks.length - 1, i0 + 1)
      const frac = idx - i0
      const [min0, max0] = peaks[i0]
      const [min1, max1] = peaks[i1]
      const min = min0 + (min1 - min0) * frac
      const max = max0 + (max1 - max0) * frac
      maxY[x] = mid + max * mid * 0.9
      minY[x] = mid + min * mid * 0.9
    }
    ctx.beginPath()
    ctx.moveTo(0.5, maxY[0])
    for (let x = 1; x < width; x++) ctx.lineTo(x + 0.5, maxY[x])
    for (let x = width - 1; x >= 0; x--) ctx.lineTo(x + 0.5, minY[x])
    ctx.closePath()
    ctx.fillStyle = 'rgba(122, 162, 247, 0.55)'
    ctx.fill()
    ctx.strokeStyle = '#7aa2f7'
    ctx.lineWidth = 1
    ctx.stroke()
  } else {
    ctx.strokeStyle = '#3b3f58'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(width, mid)
    ctx.stroke()
  }

  ctx.fillStyle = '#8892b0'
  ctx.font = '11px sans-serif'
  ctx.textBaseline = 'top'
  const showHours = duration >= 3600
  const step = pickTickStep(viewSpan, width)
  // Ticks are computed over the visible span, not [0, duration] - otherwise
  // a zoomed-in view far from t=0 on a long file would iterate thousands of
  // off-screen ticks for nothing (or show none at all).
  const firstTick = Math.ceil(viewStart / step) * step
  for (let t = firstTick; t <= viewEnd; t += step) {
    const x = timeToX(t)
    ctx.strokeStyle = 'rgba(59, 63, 88, 0.7)'
    ctx.beginPath()
    ctx.moveTo(x + 0.5, mid - 6)
    ctx.lineTo(x + 0.5, mid + 6)
    ctx.stroke()
    ctx.fillText(formatTick(t, showHours), x + 3, height - 14)
  }

  ctx.strokeStyle = '#f7768e'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(startX, 0)
  ctx.lineTo(startX, height)
  ctx.moveTo(endX, 0)
  ctx.lineTo(endX, height)
  ctx.stroke()

  if (dopplerEnabled && loopEnd > loopStart) {
    const midX = timeToX((loopStart + loopEnd) / 2)
    ctx.strokeStyle = '#e0af68'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(midX, 0)
    ctx.lineTo(midX, height)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(midX, 8, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#e0af68'
    ctx.fill()
  }

  if (Number.isFinite(playhead)) {
    const playX = timeToX(Math.min(Math.max(playhead, 0), duration))
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(playX, 0)
    ctx.lineTo(playX, height)
    ctx.stroke()
  }
}
