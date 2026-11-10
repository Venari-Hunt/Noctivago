// Where the sound comes out. The choice is remembered per machine in
// localStorage (device ids only mean something on this PC) and applies live
// to every registered AudioContext.
//   'auto'    - a dev build uses the owner's headphone-monitor mic (Yeti) so
//               testing doesn't disturb the household; a packaged build uses
//               the system default. Matches by device *label*, since an id
//               can drift across driver reinstalls.
//   'default' - the system default output.
//   <id>      - that exact device; if it is unplugged, falls back to default.
// Best-effort throughout: any failure leaves output on the system default
// rather than breaking real playback.
const STORAGE_KEY = 'audioOutputDevice'
const DEV_OUTPUT_LABEL_MATCH = /yeti/i

const contexts = new Set()

export function getAudioOutputChoice() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

export async function listAudioOutputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Audio device' }))
  } catch {
    return []
  }
}

async function resolveSinkId(choice) {
  if (choice === 'default') return ''
  const outputs = await listAudioOutputs()
  if (choice === 'auto') {
    if (await window.noctivago.isPackaged()) return ''
    return outputs.find((d) => DEV_OUTPUT_LABEL_MATCH.test(d.label))?.id ?? ''
  }
  return outputs.find((d) => d.id === choice)?.id ?? ''
}

async function applyTo(context, choice) {
  try {
    await context.setSinkId?.(await resolveSinkId(choice))
  } catch {
    // Best-effort - see the header comment.
  }
}

// Called by every AudioContext owner; keeps it following the setting.
export function registerAudioOutput(context) {
  contexts.add(context)
  return applyTo(context, getAudioOutputChoice())
}

export async function setAudioOutputChoice(choice) {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Not remembered, but still applied below.
  }
  await Promise.all([...contexts].map((context) => applyTo(context, choice)))
}
