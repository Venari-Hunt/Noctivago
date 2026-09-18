// Paints the Mixer's level/clip meters from the engine's ClipMeter taps (see
// audio/clipMeter.js). Elements opt in with a data attribute, so rows can be
// re-rendered freely - the clip latch lives on the meter, not the element:
//   data-meter-sound="<soundId>" - a row's level bar; click resets its light
//   data-meter-group="<groupId>" - a Sound Group badge; turns red on a clip
//   data-meter-master            - the whole-mix bar; click resets every light

const FLOOR_DB = -60
const FALL_DB_PER_SECOND = 30
const FRAME_MS = 33

const SOUND_TITLE = 'Level. Turns red if this sound reaches 0 dB (clipping) and stays red until you click it.'
const MASTER_TITLE = 'Whole-mix level. Turns red if the mix reaches 0 dB (clipping) and stays red until you click it (clears every clip light).'

function toDb(peak) {
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

function formatDb(peak) {
  const db = toDb(peak)
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`
}

export function startLevelMeters(engine) {
  const shownDb = new WeakMap()

  function levelPercent(meter, dt, running) {
    const target = running ? Math.max(toDb(meter.peak), FLOOR_DB) : FLOOR_DB
    const prev = shownDb.get(meter) ?? FLOOR_DB
    // Rise instantly, fall smoothly - the usual peak-meter ballistics.
    const db = target >= prev ? target : Math.max(target, prev - FALL_DB_PER_SECOND * dt)
    shownDb.set(meter, db)
    return Math.min(100, ((db - FLOOR_DB) / -FLOOR_DB) * 100)
  }

  function paintBar(el, meter, dt, running, clippedTitle, baseTitle) {
    el.style.setProperty('--level', `${meter ? levelPercent(meter, dt, running) : 0}%`)
    const clipped = Boolean(meter?.clipped)
    el.classList.toggle('clipped', clipped)
    const title = clipped ? clippedTitle(meter) : baseTitle
    if (el.title !== title) el.title = title
  }

  let last = performance.now()
  function tick(now) {
    requestAnimationFrame(tick)
    if (now - last < FRAME_MS) return
    const dt = (now - last) / 1000
    last = now
    const running = engine.context.state === 'running'

    for (const el of document.querySelectorAll('[data-meter-sound]')) {
      paintBar(el, engine.soundMeters.get(el.dataset.meterSound), dt, running,
        (m) => `Clipping: this sound peaked at ${formatDb(m.maxPeak)}. Lower its volume, then click to reset.`, SOUND_TITLE)
    }
    for (const el of document.querySelectorAll('[data-meter-master]')) {
      paintBar(el, engine.masterMeter, dt, running,
        (m) => `Clipping: the whole mix peaked at ${formatDb(m.maxPeak)}. Lower the volume, then click to reset every clip light.`, MASTER_TITLE)
    }
    for (const el of document.querySelectorAll('[data-meter-group]')) {
      const meter = engine.groupMeters.get(el.dataset.meterGroup)
      const clipped = Boolean(meter?.clipped)
      if (el.dataset.baseTitle === undefined) el.dataset.baseTitle = el.title
      el.classList.toggle('clipped', clipped)
      const title = clipped
        ? `This sound group clipped (peaked at ${formatDb(meter.maxPeak)}). Lower its volume in Remix; click the mix meter up top to reset.`
        : el.dataset.baseTitle
      if (el.title !== title) el.title = title
    }
  }
  requestAnimationFrame(tick)

  // Capture phase so the click resets the light without also reaching the
  // row's own handlers (selection, drag).
  document.addEventListener('click', (evt) => {
    const el = evt.target.closest?.('[data-meter-sound], [data-meter-master]')
    if (!el) return
    // The master meter sits inside the volume <label>; don't let the click
    // also activate its slider.
    evt.preventDefault()
    evt.stopPropagation()
    if (el.dataset.meterSound !== undefined) engine.soundMeters.get(el.dataset.meterSound)?.reset()
    else engine.resetAllMeters()
  }, true)
}
