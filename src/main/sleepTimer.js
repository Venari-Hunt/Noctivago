import { spawn } from 'node:child_process'
import log from 'electron-log/main'
import { setSleepTimerRunState, getSleepTimerRunState } from './settings.js'

// Sleep timer: after a set duration (or at a chosen time of day), either
// stop all sounds, turn the displays off (leaving the sound playing), put
// the computer to sleep, or shut it down. The main
// process owns the actual timer (a plain setTimeout is never throttled the
// way a hidden renderer's timers are - matters since the window is often
// minimised to the tray while this runs), and runs the OS power command.
// The renderer owns the countdown display and the "about to shut down -
// cancel?" warning; for the destructive actions main only fires the OS
// command once the renderer has asked it to (via runEndAction), so the
// warning can always intervene.
//
// v0.1.170: the running timer is also persisted (electron-store, via
// settings.js) so it survives an app restart / auto-update - owner: "Timer
// shouldn't be stopped nor lost when you close the app and reopens it." On
// launch restoreSleepTimer() re-arms it for the time still remaining. If it
// already elapsed while the app was closed, it only still acts if that was
// recent (RESTORE_GRACE_MS - covers a quick crash/update restart); a timer
// whose moment passed long ago is treated as stale and dropped rather than,
// say, shutting the machine down the instant the app is reopened hours later.

const RESTORE_GRACE_MS = 5 * 60 * 1000

let timeout = null
let current = null // { firesAt, action }
let mainWindow = null

export function initSleepTimer(win) {
  mainWindow = win
  restoreSleepTimer()
}

export function getSleepTimer() {
  return current ? { active: true, firesAt: current.firesAt, action: current.action } : { active: false }
}

// Sends the elapsed event to the renderer, waiting for it to finish loading
// first if it hasn't yet (the restore path can run before the window's page
// is ready).
function fireElapsed(action) {
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sleep-timer:elapsed', { action })
    }
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

function armFor(ms) {
  timeout = setTimeout(() => {
    const fired = current
    current = null
    timeout = null
    setSleepTimerRunState(null)
    log.info(`Sleep timer elapsed, action: ${fired.action}`)
    fireElapsed(fired.action)
  }, Math.max(1, ms))
}

export function startSleepTimer(durationSeconds, action) {
  cancelSleepTimer()
  const ms = Math.max(1, Math.round(durationSeconds * 1000))
  current = { firesAt: Date.now() + ms, action }
  setSleepTimerRunState(current)
  armFor(ms)
  return getSleepTimer()
}

export function cancelSleepTimer() {
  if (timeout) clearTimeout(timeout)
  timeout = null
  current = null
  setSleepTimerRunState(null)
  return { active: false }
}

// Called once at startup (from initSleepTimer) - re-arms a timer that was
// running when the app last closed.
export function restoreSleepTimer() {
  const saved = getSleepTimerRunState()
  if (!saved) return
  const remaining = saved.firesAt - Date.now()
  if (remaining > 0) {
    current = { firesAt: saved.firesAt, action: saved.action }
    armFor(remaining)
    log.info(`Sleep timer restored, ${Math.round(remaining / 1000)}s left, action: ${saved.action}`)
    return
  }
  // Already elapsed while the app was closed.
  setSleepTimerRunState(null)
  // 'displays' is never fired from the restore path: if it elapsed while the
  // app was closed, the user is now actively at the machine (they just
  // reopened the app), so blanking their screen would be a nuisance, not the
  // sleeping-hours convenience it's meant to be.
  if (saved.action === 'displays') {
    log.info('Sleep timer (turn off displays) elapsed while closed, dropped')
    return
  }
  if (remaining > -RESTORE_GRACE_MS) {
    log.info(`Sleep timer elapsed while closed (recently), acting: ${saved.action}`)
    fireElapsed(saved.action)
  } else {
    log.info('Sleep timer elapsed while the app was closed (stale), dropped')
  }
}

// Called by the renderer once its own warning countdown has run out (or the
// user hit "do it now"). 'stop' is handled entirely renderer-side and never
// reaches here. 'displays' comes straight here with no warning - it's
// non-destructive and reversible (any mouse move or key press wakes the
// screen), and the sound keeps playing.
export function runSleepTimerEndAction(action) {
  try {
    if (action === 'displays') {
      // Turn off all monitors via WM_SYSCOMMAND / SC_MONITORPOWER broadcast,
      // the standard Windows way (what nircmd and the well-known one-liner
      // do). No bundled tool or native module needed - PowerShell compiles
      // the tiny P/Invoke shim inline. PostMessage (not SendMessage) so a
      // stuck listener can't hang the call. lParam 2 = power off.
      const ps = [
        '$m = Add-Type -MemberDefinition',
        "'[DllImport(\"user32.dll\")] public static extern int PostMessage(int hWnd, int Msg, int wParam, int lParam);'",
        '-Name MonitorPower -Namespace NoctivagoNative -PassThru;',
        '$m::PostMessage(-1, 0x0112, 0xF170, 2) | Out-Null'
      ].join(' ')
      spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        windowsHide: true,
        detached: true
      }).unref()
    } else if (action === 'shutdown') {
      spawn('shutdown', ['/s', '/t', '0'], { windowsHide: true, detached: true }).unref()
    } else if (action === 'sleep') {
      // Puts the machine to sleep (S3). Note: on a system with hibernation
      // enabled, Windows may hibernate instead - an accepted limitation, no
      // clean bundled-tool-free way around it.
      spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], {
        windowsHide: true,
        detached: true
      }).unref()
    }
    return { ok: true }
  } catch (err) {
    log.error('Sleep timer end action failed', err)
    return { ok: false, error: String(err?.message || err) }
  }
}
