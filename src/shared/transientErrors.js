// Which plugin-store failures are worth retrying, and how long to wait
// between tries. Electron-free so it can be unit-tested (test/transientErrors.test.js).
//
// Why this exists: on 2026-09-21 a background auto-update check hit a single
// GitHub 504 on a manifest.json and raised a red "Couldn't update
// automatically" notification at the owner. The URL was fine seconds later.
// A blip GitHub recovers from on its own shouldn't reach the user at all -
// it should be retried, and if it still fails, quietly waited out until the
// next check.

// 408 request timeout, 425 too early, 429 rate limited, and the 5xx family:
// all of them mean "ask again", not "this will never work".
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 507, 509])

export function isTransientStatus(status) {
  return TRANSIENT_STATUSES.has(status)
}

// Waits before each retry. Two retries: a blip is usually over within a
// second, and a manual install must not feel like it hung - this adds at
// most two seconds before the failure is reported either way.
export const RETRY_DELAYS_MS = [400, 1600]

// Marks an error as "the network's fault, try later" so a background job can
// stay quiet about it while a user-initiated one still reports it.
export function markTransient(err) {
  err.transient = true
  return err
}

export function isTransient(err) {
  return Boolean(err?.transient)
}
