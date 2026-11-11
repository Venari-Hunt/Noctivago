import { mockIconSvg } from '../components/mockIcons.jsx'
import { presetPill } from './domain/toolbar.js'

// The preset pill in the title bar (Desktop 2.0 step 13d; the approved mock is
// Global Management design-system/mocks/noctivago-presets-modal.mjs, setPill).
// It names the loaded preset (click: Presets) and carries the save states:
//   Save changes as I go ON:  made (pulsing dot) > saving (spinner) > saved (drawn check) > norm
//   OFF: prompt ("Unsaved changes" with Cancel and Save) > saving > saved, or canceled
// The Mixer owns the save logic and calls showPresetPill(); this file only
// draws. Each state is its own centered, absolutely placed row, so while the
// width animates the content stays in the middle and the old row fades out
// under the new one.

const PILL_CLASS = { norm: 'norm', prompt: 'prompt', made: 'busy', saving: 'busy', saved: 'done', canceled: 'undone' }
// How long "Changes saved" and "Changes canceled" stay before the preset comes back.
const HOLD_MS = { saved: 1400, canceled: 1400 }
const FADE_MS = 180

let pill = null
let handlers = {}
let current = 'norm'
let preset = { name: null, count: 0 }
let holdTimer = null

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function rowHtml(state) {
  const icon = (name, size = 16) => mockIconSvg(name, size)
  const { label, count } = presetPill(preset.name, preset.count)
  if (state === 'prompt') {
    return (
      '<i class="pill-dot live"></i>Unsaved changes' +
      `<button type="button" class="pill-btn neg" data-pill-cancel title="Drop these edits and go back to the saved preset">${icon('x', 14)}Cancel</button>` +
      `<button type="button" class="pill-btn pos" data-pill-save title="Save these edits to ${preset.name ? esc(preset.name) : 'the preset'}">${icon('check', 14)}Save</button>`
    )
  }
  if (state === 'canceled') return `${icon('undo-2')}Changes canceled`
  if (state === 'made') return '<i class="pill-dot live"></i>Changes made'
  if (state === 'saving') return '<i class="pill-spin"></i>Saving'
  if (state === 'saved') return '<svg class="pill-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>Changes saved'
  return `${icon('bookmark')}<span><b>${esc(label)}</b> <small>${esc(count)}</small></span>${icon('chevron-down')}`
}

function draw(state, force) {
  if (!pill) return
  if (state === current && !force && pill.querySelector('.pill-row:not(.out)')) return
  current = state
  pill.className = 'preset-pill ' + PILL_CLASS[state]
  pill.tabIndex = state === 'norm' ? 0 : -1
  pill.title = state === 'norm' ? presetPill(preset.name, preset.count).title : ''
  const old = [...pill.querySelectorAll('.pill-row')]
  const row = document.createElement('span')
  row.className = 'pill-row in' + (state === 'prompt' ? ' has-btn' : '')
  row.innerHTML = rowHtml(state)
  pill.appendChild(row)
  const to = row.offsetWidth
  if (!pill.style.width) pill.style.width = to + 'px'
  else {
    void pill.offsetWidth
    pill.style.width = to + 'px'
  }
  requestAnimationFrame(() => row.classList.remove('in'))
  for (const o of old) {
    o.classList.add('out')
    setTimeout(() => o.remove(), FADE_MS)
  }
  row.querySelector('[data-pill-cancel]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers.onCancel?.()
  })
  row.querySelector('[data-pill-save]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    handlers.onSave?.()
  })
}

export function mountPresetPill(slot, pillHandlers) {
  handlers = pillHandlers
  pill = document.createElement('div')
  pill.setAttribute('role', 'status')
  pill.setAttribute('aria-live', 'polite')
  pill.addEventListener('click', () => {
    if (current === 'norm') handlers.onOpen?.()
  })
  pill.addEventListener('keydown', (e) => {
    if (current !== 'norm' || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    handlers.onOpen?.()
  })
  slot.appendChild(pill)
  draw('norm', true)
}

// The loaded preset's name and how many sounds the mix has.
export function setPresetPillPreset(name, count) {
  if (preset.name === name && preset.count === count) return
  preset = { name, count }
  if (current === 'norm') draw('norm', true)
}

export function showPresetPill(state) {
  clearTimeout(holdTimer)
  holdTimer = null
  draw(state)
  if (HOLD_MS[state]) {
    holdTimer = setTimeout(() => {
      holdTimer = null
      if (current === state) draw('norm')
    }, HOLD_MS[state])
  }
}

export function presetPillState() {
  return current
}
