function formatTick(seconds, showHours) {
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60) % 60
  if (showHours) {
    const h = Math.floor(seconds / 3600)
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function pickTickStep(duration, width) {
  const targetTicks = Math.max(2, Math.floor(width / 80))
  const rawStep = duration / targetTicks
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
  return steps.find((s) => s >= rawStep) ?? steps[steps.length - 1]
}

export function computePeaksFromChannelData(channelData, targetWidth) {
  const samplesPerPixel = Math.max(1, Math.floor(channelData.length / targetWidth))
  const peaks = []
  for (let i = 0; i < targetWidth; i++) {
    const start = i * samplesPerPixel
    const end = Math.min(start + samplesPerPixel, channelData.length)
    let min = 0
    let max = 0
    for (let j = start; j < end; j++) {
      const v = channelData[j]
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks.push([min, max])
  }
  return peaks
}

export function drawWaveform(canvas, duration, { loopStart, loopEnd, playhead, peaks }) {
  const ctx = canvas.getContext('2d')
  const width = canvas.width
  const height = canvas.height
  const mid = height / 2

  ctx.clearRect(0, 0, width, height)

  if (!Number.isFinite(duration) || duration <= 0) return

  const startX = (loopStart / duration) * width
  const endX = (loopEnd / duration) * width

  ctx.fillStyle = 'rgba(122, 162, 247, 0.18)'
  ctx.fillRect(startX, 0, endX - startX, height)

  if (peaks && peaks.length > 0) {
    ctx.strokeStyle = '#7aa2f7'
    ctx.beginPath()
    for (let x = 0; x < peaks.length && x < width; x++) {
      const [min, max] = peaks[x]
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
  const step = pickTickStep(duration, width)
  for (let t = 0; t <= duration; t += step) {
    const x = (t / duration) * width
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
    const playX = (Math.min(Math.max(playhead, 0), duration) / duration) * width
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(playX, 0)
    ctx.lineTo(playX, height)
    ctx.stroke()
  }
}
