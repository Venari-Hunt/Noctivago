import { spawn } from 'node:child_process'
import log from 'electron-log/main'

// Sleep timer: after a set duration, either stop all sounds, put the
// computer to sleep, or shut it down. The main process owns the actual
// timer (a plain setTimeout is never throttled the way a hidden renderer's
// timers are - matters since the window is often minimised to the tray
// while this runs), and runs the OS power command. The renderer owns the
// countdown display and the "about to shut down - cancel?" warning; for the
// destructive actions main only fires the OS command once the renderer has
// asked it to (via runEndAction), so the warning can always intervene.

let timeout = null
let current = null // { firesAt, action }
let mainWindow = null

export function initSleepTimer(win) {
  mainWindow = win
}

export function getSleepTimer() {
  return current ? { active: true, firesAt: current.firesAt, action: current.action } : { active: false }
}

export function startSleepTimer(durationSeconds, action) {
  cancelSleepTimer()
  const ms = Math.max(1, Math.round(durationSeconds * 1000))
  current = { firesAt: Date.now() + ms, action }
  timeout = setTimeout(() => {
    const fired = current
    current = null
    timeout = null
    log.info(`Sleep timer elapsed, action: ${fired.action}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sleep-timer:elapsed', { action: fired.action })
    }
  }, ms)
  return getSleepTimer()
}

export function cancelSleepTimer() {
  if (timeout) clearTimeout(timeout)
  timeout = null
  current = null
  return { active: false }
}

// Called by the renderer once its own warning countdown has run out (or the
// user hit "do it now"). 'stop' is handled entirely renderer-side and never
// reaches here.
export function runSleepTimerEndAction(action) {
  try {
    if (action === 'shutdown') {
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
