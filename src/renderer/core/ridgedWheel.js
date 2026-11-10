import { WHEEL_PX, RIDGE_PX, wheelDirection } from '../../shared/sleepWheel.js'

// The ridged wheel from the design system (`.roller`, Rouse "How long before"):
// a cylinder seen from the side. Drag it sideways, coast on release, or use a
// mouse side-wheel / Shift+wheel / arrow keys. `onTick(up)` returns false when
// the value is at an end, which stops the wheel dead. A drag ends (and never
// coasts) the moment the button is up, the pointer leaves `boundary` (the
// popover), or the window loses focus, so a click held while wandering off
// never keeps rolling.

export function drawWheel(el, shift) {
  const canvas = el.querySelector('canvas')
  const ratio = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w) return
  if (canvas.width !== Math.round(w * ratio)) {
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
  }
  const g = canvas.getContext('2d')
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.clearRect(0, 0, w, h)
  g.fillStyle = getComputedStyle(el).getPropertyValue('--text').trim() || '#fff'
  const radius = w / 2
  const gap = RIDGE_PX / radius
  const offset = (((shift / radius) % gap) + gap) % gap
  for (let a = offset - Math.ceil(Math.PI / 2 / gap) * gap; a < Math.PI / 2; a += gap) {
    if (a <= -Math.PI / 2) continue
    const facing = Math.cos(a)
    const width = Math.max(0.5, 2 * facing)
    g.globalAlpha = 0.04 + 0.4 * facing ** 2
    g.fillRect(radius + radius * Math.sin(a) - width / 2, 8, width, h - 16)
  }
}

export function installWheel(el, onTick, boundary = null) {
  let last = null
  let spare = 0
  let shift = 0
  let speed = 0
  let spin = 0

  const turn = (px) => {
    spare += px
    let blocked = false
    while (Math.abs(spare) >= WHEEL_PX) {
      const up = spare > 0
      spare -= up ? WHEEL_PX : -WHEEL_PX
      if (!onTick(up)) blocked = true
    }
    if (blocked) {
      spare = 0
      speed = 0
    } else {
      shift += px
      drawWheel(el, shift)
    }
  }
  const nudge = (up) => {
    if (onTick(up)) shift += up ? RIDGE_PX : -RIDGE_PX
    drawWheel(el, shift)
  }
  const stopCoast = () => {
    cancelAnimationFrame(spin)
    speed = 0
  }

  el.addEventListener('pointerdown', (e) => {
    stopCoast()
    el.setPointerCapture(e.pointerId)
    el.classList.add('held')
    last = e.clientX
  })
  const outside = (e) => {
    if (!boundary) return false
    const r = boundary.getBoundingClientRect()
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
  }
  const drop = () => {
    last = null
    speed = 0
    spare = 0
    cancelAnimationFrame(spin)
    el.classList.remove('held')
  }
  el.addEventListener('pointermove', (e) => {
    if (last === null) return
    if (e.buttons === 0 || outside(e)) {
      drop()
      return
    }
    speed = e.clientX - last
    last = e.clientX
    turn(speed)
  })
  const coast = () => {
    speed *= 0.94
    if (Math.abs(speed) < 0.5) return
    turn(speed)
    spin = requestAnimationFrame(coast)
  }
  const release = () => {
    if (last === null) return
    last = null
    el.classList.remove('held')
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) spin = requestAnimationFrame(coast)
  }
  el.addEventListener('pointerup', release)
  el.addEventListener('pointercancel', drop)
  el.addEventListener('lostpointercapture', () => {
    if (last !== null) drop()
  })
  window.addEventListener('blur', drop)
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    nudge(e.key === 'ArrowRight')
  })

  return {
    nudge,
    stopCoast,
    redraw: () => drawWheel(el, shift),
    // A mouse side-wheel notch: one tick. Returns true when it handled the event.
    wheel(e) {
      const dir = wheelDirection(e)
      if (dir === 0) return false
      e.preventDefault()
      nudge(dir > 0)
      return true
    }
  }
}
