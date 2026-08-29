import { formatDuration } from '../util/time.js'

// Sleep timer - toolbar button + modal. After a set duration the main
// process (src/main/sleepTimer.js, which owns the actual setTimeout so it
// survives the window being minimised to the tray) fires an event; a
// non-destructive "stop all sounds" is handled here, while "sleep" /
// "shutdown" first pop a 30-second warning modal that can still cancel it.

const ACTION_ACTIVE_TEXT = {
  stop: 'All sounds will stop when the timer ends.',
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

async function start() {
  const minutes = Number(els.minutesInput.value)
  if (!Number.isFinite(minutes) || minutes < 1) {
    els.minutesInput.focus()
    return
  }
  const action = chosenAction()
  const state = await window.noctivago.sleepTimer.start({
    durationSeconds: minutes * 60,
    minutes,
    action
  })
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
      const radio = els.setup.querySelector(
        `input[name="sleep-timer-action"][value="${settings.sleepTimerAction ?? 'stop'}"]`
      )
      if (radio) radio.checked = true
    }
    applyState(state)
    showModal(els.modal)
  }

  els.openBtn.addEventListener('click', open)
  els.toolbarRemaining.addEventListener('click', open)
  els.closeBtn.addEventListener('click', () => hideModal(els.modal))
  els.startBtn.addEventListener('click', start)
  els.cancelBtn.addEventListener('click', cancel)

  for (const btn of els.setup.querySelectorAll('.sleep-timer-presets button')) {
    btn.addEventListener('click', () => {
      els.minutesInput.value = btn.dataset.min
    })
  }

  window.noctivago.sleepTimer.onElapsed(({ action }) => {
    applyState({ active: false })
    if (action === 'stop') {
      window.dispatchEvent(new CustomEvent('noctivago:stop-all-playback'))
    } else {
      beginWarning(action)
    }
  })

  // Restore the countdown display if the renderer reloaded while a timer
  // was running (dev; harmless in production).
  window.noctivago.sleepTimer.get().then(applyState)
}
