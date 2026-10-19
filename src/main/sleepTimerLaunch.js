// Whether launch offers the sleep timer's auto-start (the 20 s notice). No
// Electron, so the tests load it directly.
//
// An update's install-and-restart continues the session (owner, 2026-10-19:
// after an update the timer started even though "Don't start" was clicked
// before it). So right after one, the notice only comes back if it was still
// counting down when the update hit. A running timer is restored either way
// (restoreSleepTimer).

// The silent install plus relaunch takes well under this; a later launch is
// a new session.
export const UPDATE_RESTART_WINDOW_MS = 10 * 60 * 1000

// restart: { at, autoStartPending } saved right before the update restart,
// or null.
export function shouldOfferAutoStart({ autoStartEnabled, restored, restart, now }) {
  if (!autoStartEnabled || restored) return false
  if (restart && now - restart.at >= 0 && now - restart.at < UPDATE_RESTART_WINDOW_MS) return Boolean(restart.autoStartPending)
  return true
}
