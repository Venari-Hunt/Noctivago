import { mockIconSvg } from '../components/mockIcons.jsx'
import { MORPH_TIMING, morphLabel } from './domain/morphStates.js'

// The micro-interaction state set from the preset pill, for any button
// (approved mock: Global Management design-system/dist/tool/mock-noctivago-micro.html).
// The button keeps its own look at rest; while it works it morphs in place:
//   working  - spinner + words, only after 400 ms so quick jobs never flash it
//   progress - thin amber bar + words + percent
//   done     - drawn green check, held 1.4 s, then back to rest
//   fail     - soft red x + the reason; back to rest after 4.2 s
//   canceled - gray undo arrow, held 1.4 s
// Each state is its own centered row, so while the width animates the content
// stays in the middle and the old row fades out under the new one.

const STATE_CLASS = { rest: '', working: 'busy', progress: 'busy', done: 'done', fail: 'fail', canceled: 'undone' }
const FADE_MS = 180

const CHECK = '<svg class="pill-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>'

function rowHtml(state, text, percent) {
  const t = morphLabel(text)
  if (state === 'working') return `<i class="pill-spin"></i>${t}`
  if (state === 'progress') return `<span class="morph-bar" style="--v:${percent}%"><i></i></span>${t} ${Math.round(percent)}%`
  if (state === 'done') return `${CHECK}${t}`
  if (state === 'fail') return `<span class="morph-bad">${mockIconSvg('x', 16)}</span>${t}`
  if (state === 'canceled') return `${mockIconSvg('undo-2', 16)}${t}`
  return text // rest: the button's own markup, already safe
}

export function morphButton(btn) {
  btn.classList.add('morph')
  let restHtml = btn.innerHTML
  btn.innerHTML = ''
  let state = null
  let timers = []
  const clear = () => {
    for (const t of timers) clearTimeout(t)
    timers = []
  }
  const later = (fn, ms) => timers.push(setTimeout(fn, ms))
  // Rows are absolutely placed, so the button cannot size itself: a button built while hidden
  // measures 0 and is sized here the first time it is laid out.
  let unsized = false
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (!unsized) return
      const row = btn.querySelector(':scope > .morph-row:not(.out)')
      const w = row ? Math.ceil(row.offsetWidth) : 0
      if (!w) return
      unsized = false
      btn.style.width = w + 'px'
    }).observe(btn)
  }

  function draw(next, text = '', percent = 0) {
    state = next
    for (const c of Object.values(STATE_CLASS)) if (c) btn.classList.remove(c)
    if (STATE_CLASS[next]) btn.classList.add(STATE_CLASS[next])
    btn.setAttribute('aria-busy', String(next === 'working' || next === 'progress'))
    const old = [...btn.querySelectorAll(':scope > .morph-row')]
    const row = document.createElement('span')
    row.className = 'morph-row in'
    row.innerHTML = rowHtml(next, next === 'rest' ? restHtml : text, percent)
    btn.appendChild(row)
    const to = Math.ceil(row.offsetWidth)
    if (!to) {
      // Not on screen yet (a hidden tab or panel): size it once it shows (the observer below).
      btn.style.width = ''
      unsized = true
    } else {
      if (btn.style.width) void btn.offsetWidth // let the old width paint so the change animates
      btn.style.width = to + 'px'
    }
    requestAnimationFrame(() => row.classList.remove('in'))
    for (const o of old) {
      o.classList.add('out')
      setTimeout(() => o.remove(), FADE_MS)
    }
  }

  // Progress updates in place while it is already showing a bar, so the bar slides instead of re-fading.
  function setProgress(text, percent) {
    const row = btn.querySelector(':scope > .morph-row:not(.out)')
    if (state === 'progress' && row) {
      row.querySelector('.morph-bar')?.style.setProperty('--v', percent + '%')
      row.lastChild.textContent = `${String(text ?? '').trim()} ${Math.round(percent)}%` // a text node: no escaping needed
      btn.style.width = Math.ceil(row.offsetWidth) + 'px'
      return
    }
    draw('progress', text, percent)
  }

  const api = {
    get state() {
      return state
    },
    rest() {
      clear()
      draw('rest')
    },
    // New rest markup (e.g. a label that switches between Share and Update); redrawn now if at rest.
    setRest(html) {
      restHtml = html
      if (state === 'rest') draw('rest')
    },
    working(text) {
      clear()
      later(() => draw('working', text), MORPH_TIMING.workingDelay)
    },
    progress(text, percent) {
      clear()
      setProgress(text, Math.max(0, Math.min(100, percent)))
    },
    done(text) {
      clear()
      draw('done', text)
      later(() => draw('rest'), MORPH_TIMING.doneHold)
    },
    fail(text) {
      clear()
      draw('fail', text)
      later(() => draw('rest'), MORPH_TIMING.failHold)
    },
    canceled(text) {
      clear()
      draw('canceled', text)
      later(() => draw('rest'), MORPH_TIMING.doneHold)
    }
  }
  draw('rest')
  return api
}
