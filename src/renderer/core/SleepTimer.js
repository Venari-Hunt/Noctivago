import { formatDuration } from '../util/time.js'
import { targetFromTimeOfDay, durationInWords } from '../../shared/sleepTimerTime.js'
import { setToolbarHandlers, updateToolbar } from '../toolbar/index.jsx'
import { mockIconSvg } from '../components/mockIcons.jsx'
import { clampMinutes, splitMinutes, roll, minutesFromFields, endClock, ACTION_THEN } from '../../shared/sleepWheel.js'
import { installWheel } from './ridgedWheel.js'

// Sleep timer - toolbar button + ruler popover (approved mock "sleep"). After a set duration the main
// process (src/main/sleepTimer.js, which owns the actual setTimeout so it
// survives the window being minimised to the tray) fires an event; a
// non-destructive "stop all sounds" is handled here, while "sleep" /
// "shutdown" first pop a 30-second warning modal that can still cancel it.

const WARNING_SECONDS = 30

let els = null
let displayInterval = null
let warningInterval = null
let noticeInterval = null
let firesAt = null
// What the ruler shows while setting: minutes, how they were set ('in' =
// ruler/scroll, 'at' = typed end time), the typed time, and the action.
let setup = { minutes: 30, mode: 'in', timeOfDay: '', action: 'stop', unit: 'min' }
let wheel = null

function showModal(el) {
  el.classList.remove('hidden')
}

// The popover's tail points at the moon button, which stays lit while it is open.
function pointAtMoon() {
  const btn = document.getElementById('sleep-timer-button')
  if (!btn || els.modal.classList.contains('hidden')) return
  const pop = els.pop.getBoundingClientRect()
  const b = btn.getBoundingClientRect()
  const x = Math.min(pop.width - 24, Math.max(24, b.left + b.width / 2 - pop.left))
  els.pop.style.setProperty('--arrow-x', x + 'px')
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

function renderSetup(force = false) {
  const { minutes, mode } = setup
  const { d, h, min } = splitMinutes(minutes)
  // A field being typed in keeps its text until it loses focus.
  if (force || document.activeElement !== els.dInput) els.dInput.value = d || ''
  if (force || document.activeElement !== els.hInput) els.hInput.value = h || ''
  if (force || document.activeElement !== els.minInput) els.minInput.value = min || ''
  els.dInput.closest('.sleep-unit').classList.toggle('active', setup.unit === 'd')
  els.hInput.closest('.sleep-unit').classList.toggle('active', setup.unit === 'h')
  els.minInput.closest('.sleep-unit').classList.toggle('active', setup.unit === 'min')
  if (mode === 'at') {
    els.atInput.value = setup.timeOfDay
  } else if (document.activeElement !== els.atInput) {
    els.atInput.value = endClock(minutes)
  }
  for (const btn of els.presets) btn.setAttribute('aria-pressed', String(Number(btn.dataset.min) === minutes))
  for (const btn of els.acts) btn.setAttribute('aria-pressed', String(btn.dataset.action === setup.action))
}

function setAutoStartSwitch(on) {
  els.autoStart.setAttribute('aria-checked', String(on))
  els.autoStart.classList.toggle('on', on)
}

function applyState(state) {
  const active = Boolean(state && state.active)
  firesAt = active ? state.firesAt : null

  updateToolbar({ sleepActive: active })
  els.pop.classList.toggle('running', active)
  els.setup.classList.toggle('hidden', active)
  els.activeBox.classList.toggle('hidden', !active)
  els.startBtn.classList.toggle('hidden', active)
  els.addBtn.classList.toggle('hidden', !active)
  els.cancelBtn.classList.toggle('hidden', !active)

  clearInterval(displayInterval)
  displayInterval = null
  if (active) {
    const endsAt = new Date(state.firesAt)
    const clock = String(endsAt.getHours()).padStart(2, '0') + ':' + String(endsAt.getMinutes()).padStart(2, '0')
    els.activeAction.textContent = `then ${ACTION_THEN[state.action] || ACTION_THEN.stop}, at ${clock}`
    refreshDisplay()
    displayInterval = setInterval(refreshDisplay, 1000)
  } else {
    renderSetup()
  }
  pointAtMoon()
}

// Typed end time -> minutes from now (and the time to remember). Bad text
// leaves the ruler as it was and puts the old time back.
function applyTypedEnd() {
  const target = targetFromTimeOfDay(els.atInput.value)
  if (!target) {
    renderSetup()
    return
  }
  const minutes = clampMinutes(Math.ceil((target.getTime() - Date.now()) / 60000))
  const hh = String(target.getHours()).padStart(2, '0')
  const mm = String(target.getMinutes()).padStart(2, '0')
  setup = { ...setup, mode: 'at', minutes, timeOfDay: hh + ':' + mm }
  renderSetup()
}

// Reads the chosen mode into { durationSeconds } (+ prefs to remember), or
// null if the input is invalid (and focuses it).
function readDuration() {
  if (setup.mode === 'at') {
    const target = targetFromTimeOfDay(setup.timeOfDay)
    if (!target) {
      els.atInput.focus()
      return null
    }
    return {
      durationSeconds: Math.max(1, Math.round((target.getTime() - Date.now()) / 1000)),
      mode: 'at',
      timeOfDay: setup.timeOfDay
    }
  }
  return { durationSeconds: setup.minutes * 60, mode: 'in', minutes: setup.minutes }
}

async function start() {
  const dur = readDuration()
  if (!dur) return
  const state = await window.noctivago.sleepTimer.start({ ...dur, action: setup.action })
  applyState(state)
}

// Adds 15 minutes to the running timer: restarts it for what is left plus 15,
// resending the remembered prefs unchanged.
async function addFifteen() {
  const [state, settings] = await Promise.all([window.noctivago.sleepTimer.get(), window.noctivago.settings.get()])
  if (!state.active) return
  const left = Math.max(1, (state.firesAt - Date.now()) / 1000)
  applyState(
    await window.noctivago.sleepTimer.start({
      durationSeconds: left + 15 * 60,
      action: state.action,
      minutes: settings.sleepTimerMinutes,
      mode: settings.sleepTimerMode,
      timeOfDay: settings.sleepTimerTimeOfDay
    })
  )
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
  const modal = document.getElementById('sleep-timer-modal')
  for (const slot of modal.querySelectorAll('[data-icon]')) {
    slot.outerHTML = mockIconSvg(slot.dataset.icon, Number(slot.dataset.size) || 16)
  }
  els = {
    modal,
    pop: modal.querySelector('.sleep-pop'),
    setup: document.getElementById('sleep-timer-setup'),
    activeBox: document.getElementById('sleep-timer-active'),
    dInput: document.getElementById('sleep-timer-d'),
    hInput: document.getElementById('sleep-timer-h'),
    minInput: document.getElementById('sleep-timer-min'),
    wheel: document.getElementById('sleep-timer-wheel'),
    less: document.getElementById('sleep-timer-less'),
    more: document.getElementById('sleep-timer-more'),
    presets: [...modal.querySelectorAll('#sleep-timer-presets button')],
    acts: [...modal.querySelectorAll('.sleep-acts button')],
    atInput: document.getElementById('sleep-timer-at'),
    countdownValue: document.getElementById('sleep-timer-countdown-value'),
    activeAction: document.getElementById('sleep-timer-active-action'),
    startBtn: document.getElementById('sleep-timer-start'),
    addBtn: document.getElementById('sleep-timer-add'),
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

  const close = () => {
    hideModal(els.modal)
    updateToolbar({ sleepOpen: false })
  }

  const open = async () => {
    const [state, settings] = await Promise.all([
      window.noctivago.sleepTimer.get(),
      window.noctivago.settings.get()
    ])
    if (!state.active) {
      const at = settings.sleepTimerMode === 'at' ? targetFromTimeOfDay(settings.sleepTimerTimeOfDay) : null
      setup = {
        mode: at ? 'at' : 'in',
        timeOfDay: at ? settings.sleepTimerTimeOfDay : '',
        minutes: at ? clampMinutes(Math.ceil((at.getTime() - Date.now()) / 60000)) : clampMinutes(settings.sleepTimerMinutes ?? 30),
        action: settings.sleepTimerAction ?? 'stop',
        unit: 'min'
      }
    }
    setAutoStartSwitch(Boolean(settings.sleepTimerAutoStart))
    applyState(state)
    showModal(els.modal)
    updateToolbar({ sleepOpen: true })
    pointAtMoon()
    wheel.redraw()
  }

  setToolbarHandlers({ onOpenSleepTimer: open })
  els.closeBtn.addEventListener('click', close)
  // A click on the empty area around the popover closes it.
  els.modal.addEventListener('mousedown', (e) => {
    if (e.target === els.modal) close()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) close()
  })
  els.startBtn.addEventListener('click', start)
  els.addBtn.addEventListener('click', addFifteen)
  els.cancelBtn.addEventListener('click', cancel)
  els.autoStart.addEventListener('click', () => {
    const on = els.autoStart.getAttribute('aria-checked') !== 'true'
    setAutoStartSwitch(on)
    window.noctivago.settings.setSleepTimerAutoStartEnabled(on)
  })

  // Setting the time: roll the wheel (drag it, side-scroll over the popover,
  // Shift+wheel, arrow keys, minus/plus), type the hours and minutes, pick a
  // preset, or type the end time. Wheel, fields and presets set minutes;
  // typing the end time sets a time of day.
  const tick = (up) => {
    const r = roll(setup.minutes, setup.unit, up)
    if (!r) return false
    setup = { ...setup, mode: 'in', minutes: r.minutes, unit: r.unit }
    renderSetup()
    return true
  }
  wheel = installWheel(els.wheel, tick, els.pop)
  els.wheel.addEventListener('pointerdown', () => document.activeElement?.blur?.())
  els.less.addEventListener('click', () => wheel.nudge(false))
  els.more.addEventListener('click', () => wheel.nudge(true))
  // Side-scroll works anywhere over the setup area, not only on the wheel.
  els.setup.addEventListener('wheel', (e) => wheel.wheel(e), { passive: false })
  for (const input of [els.dInput, els.hInput, els.minInput]) {
    input.addEventListener('focus', () => {
      setup = { ...setup, unit: input.dataset.unit }
      input.select()
      renderSetup()
    })
    const commitFields = () => {
      const minutes = minutesFromFields(els.dInput.value, els.hInput.value, els.minInput.value)
      if (minutes != null) setup = { ...setup, mode: 'in', minutes }
      renderSetup(true) // both fields show the tidied-up numbers, so a second commit adds nothing
    }
    input.addEventListener('change', commitFields)
    input.addEventListener('blur', commitFields)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur()
    })
  }
  for (const btn of els.presets) {
    btn.addEventListener('click', () => {
      setup = { ...setup, mode: 'in', minutes: Number(btn.dataset.min), unit: 'min' }
      renderSetup()
    })
  }
  els.atInput.addEventListener('focus', () => els.atInput.select())
  els.atInput.addEventListener('change', applyTypedEnd)
  els.atInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyTypedEnd()
  })
  for (const btn of els.acts) {
    btn.addEventListener('click', () => {
      setup = { ...setup, action: btn.dataset.action }
      renderSetup()
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
