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
// in resamples that same array (nearest-neighbor) rather than fetching
// finer-grained peaks from ffmpeg, the simpler of the two options noted
// when this feature was scoped. Trade-off: the waveform gets visibly
// blockier the further you zoom in, since there's no more real detail to
// show past the original resolution - accepted for v1.
export function drawWaveform(canvas, duration, { loopStart, loopEnd, playhead, peaks, viewStart = 0, viewEnd = duration }) {
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

  if (peaks && peaks.length > 0) {
    ctx.strokeStyle = '#7aa2f7'
    ctx.beginPath()
    for (let x = 0; x < width; x++) {
      const t = viewStart + (x / width) * viewSpan
      const peakIndex = Math.min(peaks.length - 1, Math.max(0, Math.floor((t / duration) * peaks.length)))
      const [min, max] = peaks[peakIndex]
      ctx.moveTo(x + 0.5, mid + min * mid * 0.9)
      ctx.lineTo(x + 0.5, mid + max * mid * 0.9)
    }
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
