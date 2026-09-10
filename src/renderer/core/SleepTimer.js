import { formatDuration } from '../util/time.js'

// Sleep timer - toolbar button + modal. After a set duration the main
// process (src/main/sleepTimer.js, which owns the actual setTimeout so it
// survives the window being minimised to the tray) fires an event; a
// non-destructive "stop all sounds" is handled here, while "sleep" /
// "shutdown" first pop a 30-second warning modal that can still cancel it.

const ACTION_ACTIVE_TEXT = {
  stop: 'All sounds will stop when the timer ends.',
  displays: 'Your displays will turn off when the timer ends — the sound keeps playing. Move the mouse or press a key to wake them.',
  sleep: 'The computer will go to sleep when the timer ends — you can still cancel then.',
  shutdown: 'The computer will shut down when the timer ends — you can still cancel then.'
}
const WARNING_SECONDS = 30

let els = null
let displayInterval = null
let warningInterval = null
let firesAt = null

function showModal(el) {
  el.classList.remove('hidden')
}
function hideModal(el) {
  el.classList.add('hidden')
}

function refreshDisplay() {
  if (firesAt == null) return
  const text = formatDuration(Math.max(0, Math.ceil((firesAt - Date.now()) / 1000)))
  els.countdownValue.textContent = text
  els.toolbarRemaining.textContent = text
}

function applyState(state) {
  const active = Boolean(state && state.active)
  firesAt = active ? state.firesAt : null

  els.toolbarRemaining.classList.toggle('hidden', !active)
  els.openBtn.classList.toggle('btn-svg-icon-active', active)
  els.openBtn.title = active ? 'Sleep timer (running)' : 'Sleep timer'
  els.setup.classList.toggle('hidden', active)
  els.activeBox.classList.toggle('hidden', !active)
  els.startBtn.classList.toggle('hidden', active)
  els.cancelBtn.classList.toggle('hidden', !active)

  clearInterval(displayInterval)
  displayInterval = null
  if (active) {
    els.activeAction.textContent = ACTION_ACTIVE_TEXT[state.action] || ''
    refreshDisplay()
    displayInterval = setInterval(refreshDisplay, 1000)
  }
}

function chosenAction() {
  const checked = els.setup.querySelector('input[name="sleep-timer-action"]:checked')
  return checked ? checked.value : 'stop'
}

function chosenMode() {
  const checked = els.setup.querySelector('input[name="sleep-timer-mode"]:checked')
  return checked ? checked.value : 'in'
}

// "HH:MM" -> the next Date that matches it (today if still ahead, else
// tomorrow), or null if the string isn't a valid time.
function targetFromTimeOfDay(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  const now = new Date()
  const target = new Date(now)
  target.setHours(h, min, 0, 0)
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
  return target
}

// Shows/hides the minutes vs. time-of-day inputs and keeps the "that's in
// about …" hint current for the 'at' mode.
function updateModeUI() {
  const at = chosenMode() === 'at'
  els.minutesField.classList.toggle('hidden', at)
  els.presets.classList.toggle('hidden', at)
  els.atField.classList.toggle('hidden', !at)
  els.atHint.classList.toggle('hidden', !at)
  if (at) {
    const target = targetFromTimeOfDay(els.atInput.value)
    if (!target) {
      els.atHint.textContent = 'Pick a time.'
    } else {
      const secs = Math.round((target.getTime() - Date.now()) / 1000)
      const when = target.getDate() === new Date().getDate() ? 'today' : 'tomorrow'
      els.atHint.textContent = `That's in ${formatDuration(secs)} — ${when}.`
    }
  }
}

// Reads the chosen mode into { durationSeconds } (+ prefs to remember), or
// null if the input is invalid (and focuses it).
function readDuration() {
  if (chosenMode() === 'at') {
    const target = targetFromTimeOfDay(els.atInput.value)
    if (!target) {
      els.atInput.focus()
      return null
    }
    return {
      durationSeconds: Math.max(1, Math.round((target.getTime() - Date.now()) / 1000)),
      mode: 'at',
      timeOfDay: els.atInput.value
    }
  }
  const minutes = Number(els.minutesInput.value)
  if (!Number.isFinite(minutes) || minutes < 1) {
    els.minutesInput.focus()
    return null
  }
  return { durationSeconds: minutes * 60, mode: 'in', minutes }
}

async function start() {
  const dur = readDuration()
  if (!dur) return
  const state = await window.noctivago.sleepTimer.start({ ...dur, action: chosenAction() })
  applyState(state)
}

async function cancel() {
  applyState(await window.noctivago.sleepTimer.cancel())
}

function finishWarning(action, proceed) {
  clearInterval(warningInterval)
  warningInterval = null
  hideModal(els.warning)
  if (proceed) window.noctivago.sleepTimer.runEndAction(action)
}

function beginWarning(action) {
  const verb = action === 'sleep' ? 'put your computer to sleep' : 'shut down your computer'
  els.warningTitle.textContent = action === 'sleep' ? 'Going to sleep' : 'Shutting down'
  let left = WARNING_SECONDS
  const tick = () => {
    if (left <= 0) {
      finishWarning(action, true)
      return
    }
    els.warningMessage.textContent = `Noctívago will ${verb} in ${left} second${left === 1 ? '' : 's'}.`
    left -= 1
  }
  tick()
  warningInterval = setInterval(tick, 1000)
  els.warningCancel.onclick = () => finishWarning(action, false)
  els.warningNow.onclick = () => finishWarning(action, true)
  showModal(els.warning)
}

export function installSleepTimer() {
  els = {
    openBtn: document.getElementById('open-sleep-timer'),
    toolbarRemaining: document.getElementById('sleep-timer-remaining'),
    modal: document.getElementById('sleep-timer-modal'),
    setup: document.getElementById('sleep-timer-setup'),
    activeBox: document.getElementById('sleep-timer-active'),
    minutesInput: document.getElementById('sleep-timer-minutes'),
    minutesField: document.getElementById('sleep-timer-minutes-field'),
    presets: document.getElementById('sleep-timer-presets'),
    atField: document.getElementById('sleep-timer-at-field'),
    atInput: document.getElementById('sleep-timer-at'),
    atHint: document.getElementById('sleep-timer-at-hint'),
    countdownValue: document.getElementById('sleep-timer-countdown-value'),
    activeAction: document.getElementById('sleep-timer-active-action'),
    startBtn: document.getElementById('sleep-timer-start'),
    cancelBtn: document.getElementById('sleep-timer-cancel'),
    closeBtn: document.getElementById('sleep-timer-close'),
    warning: document.getElementById('sleep-timer-warning'),
    warningTitle: document.getElementById('sleep-timer-warning-title'),
    warningMessage: document.getElementById('sleep-timer-warning-message'),
    warningCancel: document.getElementById('sleep-timer-warning-cancel'),
    warningNow: document.getElementById('sleep-timer-warning-now')
  }

  const open = async () => {
    const [state, settings] = await Promise.all([
      window.noctivago.sleepTimer.get(),
      window.noctivago.settings.get()
    ])
    if (!state.active) {
      els.minutesInput.value = settings.sleepTimerMinutes ?? 30
      els.atInput.value = settings.sleepTimerTimeOfDay ?? ''
      const actionRadio = els.setup.querySelector(
        `input[name="sleep-timer-action"][value="${settings.sleepTimerAction ?? 'stop'}"]`
      )
      if (actionRadio) actionRadio.checked = true
      const modeRadio = els.setup.querySelector(
        `input[name="sleep-timer-mode"][value="${settings.sleepTimerMode ?? 'in'}"]`
      )
      if (modeRadio) modeRadio.checked = true
      updateModeUI()
    }
    applyState(state)
    showModal(els.modal)
  }

  els.openBtn.addEventListener('click', open)
  els.toolbarRemaining.addEventListener('click', open)
  els.closeBtn.addEventListener('click', () => hideModal(els.modal))
  els.startBtn.addEventListener('click', start)
  els.cancelBtn.addEventListener('click', cancel)

  for (const radio of els.setup.querySelectorAll('input[name="sleep-timer-mode"]')) {
    radio.addEventListener('change', updateModeUI)
  }
  els.atInput.addEventListener('input', updateModeUI)

  for (const btn of els.presets.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      els.minutesInput.value = btn.dataset.min
    })
  }

  window.noctivago.sleepTimer.onElapsed(({ action }) => {
    applyState({ active: false })
    if (action === 'stop') {
      window.dispatchEvent(new CustomEvent('noctivago:stop-all-playback'))
    } else if (action === 'displays') {
      // Non-destructive and reversible (any input wakes the screen) - no
      // warning countdown, just do it. Playback is untouched.
      window.noctivago.sleepTimer.runEndAction('displays')
    } else {
      beginWarning(action)
    }
  })

  // Restore the countdown display if the renderer reloaded while a timer
  // was running (dev; harmless in production).
  window.noctivago.sleepTimer.get().then(applyState)
}
