import { formatDuration } from '../util/time.js'
import { targetFromTimeOfDay, durationInWords } from '../../shared/sleepTimerTime.js'
import { setToolbarHandlers, updateToolbar } from '../toolbar/index.jsx'

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
let noticeInterval = null
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
  updateToolbar({ sleepRemaining: text })
}

function applyState(state) {
  const active = Boolean(state && state.active)
  firesAt = active ? state.firesAt : null

  updateToolbar({ sleepActive: active })
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

const AUTO_START_ACTION_TEXT = {
  stop: 'stop all sounds',
  displays: 'turn off your displays',
  sleep: 'put the computer to sleep',
  shutdown: 'shut down the computer'
}

async function finishAutoStartNotice(start) {
  clearInterval(noticeInterval)
  noticeInterval = null
  hideModal(els.notice)
  const sleepTimer = window.noctivago.sleepTimer
  applyState(await (start ? sleepTimer.confirmAutoStart() : sleepTimer.skipAutoStart()))
}

// Launch with "Start this timer every time Noctívago opens" ticked: main
// holds the timer as pending (src/main/sleepTimer.js) until this notice
// runs out, so it never starts unannounced.
function beginAutoStartNotice({ startsAt, seconds, action }) {
  const what = AUTO_START_ACTION_TEXT[action] || AUTO_START_ACTION_TEXT.stop
  els.noticeMessage.textContent = `When it runs out, Noctívago will ${what}. The timer is set to ${durationInWords(seconds)}.`
  const tick = () => {
    const left = Math.ceil((startsAt - Date.now()) / 1000)
    if (left <= 0) {
      finishAutoStartNotice(true)
      return
    }
    els.noticeCountdown.textContent = `Starting in ${left} second${left === 1 ? '' : 's'}. You can turn this off in the sleep timer.`
  }
  tick()
  noticeInterval = setInterval(tick, 250)
  els.noticeNow.onclick = () => finishAutoStartNotice(true)
  els.noticeSkip.onclick = () => finishAutoStartNotice(false)
  showModal(els.notice)
}

export function installSleepTimer() {
  els = {
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
    warningNow: document.getElementById('sleep-timer-warning-now'),
    autoStart: document.getElementById('sleep-timer-autostart'),
    notice: document.getElementById('sleep-timer-autostart-notice'),
    noticeMessage: document.getElementById('sleep-timer-autostart-message'),
    noticeCountdown: document.getElementById('sleep-timer-autostart-countdown'),
    noticeNow: document.getElementById('sleep-timer-autostart-now'),
    noticeSkip: document.getElementById('sleep-timer-autostart-skip')
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
    els.autoStart.checked = Boolean(settings.sleepTimerAutoStart)
    applyState(state)
    showModal(els.modal)
  }

  setToolbarHandlers({ onOpenSleepTimer: open })
  els.closeBtn.addEventListener('click', () => hideModal(els.modal))
  els.startBtn.addEventListener('click', start)
  els.cancelBtn.addEventListener('click', cancel)
  els.autoStart.addEventListener('change', () => {
    window.noctivago.settings.setSleepTimerAutoStartEnabled(els.autoStart.checked)
  })

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
  // was running (dev; harmless in production), and announce a pending
  // auto-start.
  window.noctivago.sleepTimer.get().then((state) => {
    applyState(state)
    if (state.pendingAutoStart) beginAutoStartNotice(state.pendingAutoStart)
  })
}
