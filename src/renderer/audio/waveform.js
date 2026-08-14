function formatTick(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function pickTickStep(duration, width) {
  const targetTicks = Math.max(2, Math.floor(width / 80))
  const rawStep = duration / targetTicks
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
  return steps.find((s) => s >= rawStep) ?? steps[steps.length - 1]
}

export function drawWaveform(canvas, duration, { loopStart, loopEnd }) {
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

  ctx.strokeStyle = '#3b3f58'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, mid)
  ctx.lineTo(width, mid)
  ctx.stroke()

  ctx.fillStyle = '#8892b0'
  ctx.font = '11px sans-serif'
  ctx.textBaseline = 'top'
  const step = pickTickStep(duration, width)
  for (let t = 0; t <= duration; t += step) {
    const x = (t / duration) * width
    ctx.strokeStyle = '#3b3f58'
    ctx.beginPath()
    ctx.moveTo(x + 0.5, mid - 6)
    ctx.lineTo(x + 0.5, mid + 6)
    ctx.stroke()
    ctx.fillText(formatTick(t), x + 3, mid + 10)
  }

  ctx.strokeStyle = '#f7768e'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(startX, 0)
  ctx.lineTo(startX, height)
  ctx.moveTo(endX, 0)
  ctx.lineTo(endX, height)
  ctx.stroke()
}
