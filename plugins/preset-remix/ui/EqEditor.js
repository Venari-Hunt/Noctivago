// A compact draggable-node parametric EQ for the Preset Remix whole-mix
// chain. Deliberately scoped down from the core Remix plugin's EqEditor
// (plugins/editor/ui/EqEditor.js) - no live spectrum analyzer, no band
// energy backdrop, no A/B, no mute/solo (there's no single preview source
// for the whole mix, and those extras aren't the point here). Kept: the
// draggable nodes, the real composite response curve, per-band type, add on
// empty-click, wheel for Q, right-click to remove, double-click to flatten.
//
// Bands are plain objects { freqHz, gainDb, q, type, slope, muted } matching
// a sound's own filters.eq shape, so the same WholeMixChain / presets.js
// plumbing reads them. `onChange(bands)` fires on every edit.

const FREQ_MIN = 20
const FREQ_MAX = 20000
const GAIN_MIN = -18
const GAIN_MAX = 18
const Q_MIN = 0.1
const Q_MAX = 20
const Q_WHEEL_STEP = 0.08
const HIT_PX = 14
const NODE_RADIUS = 8
const NODE_RADIUS_SELECTED = 10
const MAX_BANDS = 12
const NEW_BAND = { gainDb: 0, q: 1, type: 'peaking', slope: 'gentle', muted: false }

export const EQ_TYPES = ['peaking', 'lowshelf', 'highshelf', 'lowpass', 'highpass', 'bandpass', 'notch', 'off']
const TYPE_COLORS = {
  peaking: '#7aa2f7',
  lowshelf: '#a78bfa',
  highshelf: '#22d3ee',
  lowpass: '#2dd4bf',
  highpass: '#ef4444',
  bandpass: '#34d399',
  notch: '#fbbf24',
  off: 'rgba(122, 137, 176, 0.4)'
}
const SLOPE_CAPABLE = ['lowpass', 'highpass', 'bandpass', 'notch']

function freqToX(f, w) {
  const lo = Math.log10(FREQ_MIN)
  const hi = Math.log10(FREQ_MAX)
  return ((Math.log10(Math.max(FREQ_MIN, f)) - lo) / (hi - lo)) * w
}
function xToFreq(x, w) {
  const lo = Math.log10(FREQ_MIN)
  const hi = Math.log10(FREQ_MAX)
  const t = Math.min(Math.max(x / w, 0), 1)
  return Math.pow(10, lo + t * (hi - lo))
}
function gainToY(g, h) {
  return ((g - GAIN_MAX) / (GAIN_MIN - GAIN_MAX)) * h
}
function yToGain(y, h) {
  const t = Math.min(Math.max(y / h, 0), 1)
  return GAIN_MAX + t * (GAIN_MIN - GAIN_MAX)
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

let responseContext = null
function computeResponseCurve(bands, width) {
  const active = bands.filter((b) => !b.muted && b.type !== 'off')
  if (active.length === 0) return null
  const n = Math.max(2, Math.round(width))
  const freqs = new Float32Array(n)
  for (let i = 0; i < n; i++) freqs[i] = xToFreq((i / (n - 1)) * width, width)
  if (!responseContext) responseContext = new OfflineAudioContext(1, 1, 44100)
  const total = new Float32Array(n)
  const mag = new Float32Array(n)
  const phase = new Float32Array(n)
  for (const band of active) {
    const node = responseContext.createBiquadFilter()
    node.type = band.type ?? 'peaking'
    node.frequency.value = band.freqHz
    node.Q.value = band.q
    node.gain.value = band.gainDb
    node.getFrequencyResponse(freqs, mag, phase)
    const stages = band.slope === 'steep' && SLOPE_CAPABLE.includes(band.type) ? 4 : 1
    for (let i = 0; i < n; i++) total[i] += stages * 20 * Math.log10(Math.max(mag[i], 1e-6))
  }
  return total
}

function resizeCanvasForDisplay(canvas) {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(rect.width * dpr))
  const h = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  return { width: rect.width, height: rect.height, dpr }
}

export class WholeMixEqEditor {
  constructor(canvas, onChange) {
    this.canvas = canvas
    this.onChange = onChange
    this.bands = []
    this.selectedIndex = -1
    this._dragIndex = -1

    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e))
    window.addEventListener('pointermove', (e) => this._onPointerMove(e))
    window.addEventListener('pointerup', () => this._onPointerUp())
    canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false })
    canvas.addEventListener('contextmenu', (e) => this._onContextMenu(e))
    canvas.addEventListener('dblclick', (e) => this._onDoubleClick(e))
    this._resizeObserver = new ResizeObserver(() => this.draw())
    this._resizeObserver.observe(canvas)
  }

  destroy() {
    this._resizeObserver?.disconnect()
  }

  setBands(bands) {
    this.bands = (bands ?? []).map((b) => ({ ...NEW_BAND, ...b }))
    if (this.selectedIndex >= this.bands.length) this.selectedIndex = this.bands.length - 1
    this.draw()
  }

  getSelectedBand() {
    return this.selectedIndex >= 0 ? this.bands[this.selectedIndex] : null
  }

  updateSelectedBand(patch) {
    const band = this.getSelectedBand()
    if (!band) return
    Object.assign(band, patch)
    this._emit()
  }

  removeSelectedBand() {
    if (this.selectedIndex < 0) return
    this.bands.splice(this.selectedIndex, 1)
    this.selectedIndex = Math.min(this.selectedIndex, this.bands.length - 1)
    this._emit()
  }

  clear() {
    this.bands = []
    this.selectedIndex = -1
    this._emit()
  }

  _rect() {
    return this.canvas.getBoundingClientRect()
  }

  _localPoint(e) {
    const rect = this._rect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height }
  }

  _hitTest(x, y, w, h) {
    for (let i = this.bands.length - 1; i >= 0; i--) {
      const b = this.bands[i]
      const bx = freqToX(b.freqHz, w)
      const by = gainToY(b.gainDb, h)
      if (Math.hypot(x - bx, y - by) <= HIT_PX) return i
    }
    return -1
  }

  _onPointerDown(e) {
    if (e.button !== 0) return
    const { x, y, w, h } = this._localPoint(e)
    if (x < 0 || y < 0 || x > w || y > h) return
    const hit = this._hitTest(x, y, w, h)
    if (hit !== -1) {
      this.selectedIndex = hit
      this._dragIndex = hit
      this.draw()
      this._emitSelectOnly()
      return
    }
    if (this.bands.length >= MAX_BANDS) return
    const band = { ...NEW_BAND, freqHz: Math.round(xToFreq(x, w)), gainDb: Math.round(yToGain(y, h) * 10) / 10 }
    this.bands.push(band)
    this.selectedIndex = this.bands.length - 1
    this._dragIndex = this.selectedIndex
    this._emit()
  }

  _onPointerMove(e) {
    if (this._dragIndex === -1) return
    const { x, y, w, h } = this._localPoint(e)
    const band = this.bands[this._dragIndex]
    band.freqHz = Math.round(clamp(xToFreq(x, w), FREQ_MIN, FREQ_MAX))
    band.gainDb = Math.round(clamp(yToGain(y, h), GAIN_MIN, GAIN_MAX) * 10) / 10
    this._emit()
  }

  _onPointerUp() {
    this._dragIndex = -1
  }

  _onWheel(e) {
    const { x, y, w, h } = this._localPoint(e)
    const hit = this._hitTest(x, y, w, h)
    if (hit === -1) return
    e.preventDefault()
    const band = this.bands[hit]
    const dir = e.deltaY > 0 ? -1 : 1
    band.q = Math.round(clamp(band.q + dir * Q_WHEEL_STEP * Math.max(1, band.q), Q_MIN, Q_MAX) * 100) / 100
    this.selectedIndex = hit
    this._emit()
  }

  _onContextMenu(e) {
    e.preventDefault()
    const { x, y, w, h } = this._localPoint(e)
    const hit = this._hitTest(x, y, w, h)
    if (hit === -1) return
    this.bands.splice(hit, 1)
    if (this.selectedIndex === hit) this.selectedIndex = -1
    else if (this.selectedIndex > hit) this.selectedIndex--
    this._emit()
  }

  _onDoubleClick(e) {
    const { x, y, w, h } = this._localPoint(e)
    const hit = this._hitTest(x, y, w, h)
    if (hit === -1) return
    this.bands[hit].gainDb = 0
    this.selectedIndex = hit
    this._emit()
  }

  _emit() {
    this.draw()
    this.onChange?.(this.bands.map((b) => ({ ...b })))
  }

  _emitSelectOnly() {
    this.onChange?.(this.bands.map((b) => ({ ...b })), { selectionOnly: true })
  }

  draw() {
    const { width, height, dpr } = resizeCanvasForDisplay(this.canvas)
    const ctx = this.canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.font = '10px sans-serif'
    ctx.textBaseline = 'middle'

    for (const g of [-12, -6, 0, 6, 12]) {
      const yy = gainToY(g, height)
      ctx.strokeStyle = g === 0 ? 'rgba(120,130,170,0.55)' : 'rgba(120,130,170,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, yy)
      ctx.lineTo(width, yy)
      ctx.stroke()
      ctx.fillStyle = 'rgba(136,146,176,0.9)'
      ctx.fillText(`${g > 0 ? '+' : ''}${g}`, 3, clamp(yy, 8, height - 8))
    }
    for (const f of [100, 1000, 10000]) {
      const xx = freqToX(f, width)
      ctx.strokeStyle = 'rgba(120,130,170,0.22)'
      ctx.beginPath()
      ctx.moveTo(xx, 0)
      ctx.lineTo(xx, height)
      ctx.stroke()
      ctx.fillStyle = 'rgba(136,146,176,0.9)'
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), xx + 3, height - 9)
    }

    const curve = computeResponseCurve(this.bands, width)
    if (curve) {
      ctx.strokeStyle = '#7aa2f7'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let px = 0; px < curve.length; px++) {
        const yy = gainToY(clamp(curve[px], GAIN_MIN, GAIN_MAX), height)
        if (px === 0) ctx.moveTo(px, yy)
        else ctx.lineTo(px, yy)
      }
      ctx.stroke()
    } else if (this.bands.length === 0) {
      ctx.fillStyle = 'rgba(136,146,176,0.9)'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Click anywhere to add an EQ band', width / 2, height / 2)
      ctx.textAlign = 'left'
    }

    this.bands.forEach((b, i) => {
      const type = b.type ?? 'peaking'
      const bypassed = b.muted || type === 'off'
      const bx = freqToX(b.freqHz, width)
      const by = gainToY(b.gainDb, height)
      const color = TYPE_COLORS[type] ?? TYPE_COLORS.peaking
      const selected = i === this.selectedIndex
      const r = selected ? NODE_RADIUS_SELECTED : NODE_RADIUS
      ctx.beginPath()
      ctx.arc(bx, by, r, 0, Math.PI * 2)
      ctx.fillStyle = bypassed ? 'rgba(122,137,176,0.35)' : color
      ctx.fill()
      ctx.strokeStyle = selected ? '#f7768e' : '#1a1b26'
      ctx.lineWidth = selected ? 2.5 : 1.5
      ctx.stroke()
    })
  }
}
