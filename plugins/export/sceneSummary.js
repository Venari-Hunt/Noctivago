// "How the scene is set up" and "Credits" for the export's info.txt
// (v0.1.224, owner inbox: so a person or an AI can write a YouTube
// description with proper credits and an accurate picture of the mix).
// Plain text, one line per fact, only listing what differs from neutral.
// Pure - unit-tested in test/exportSceneSummary.test.js.
import { creditLine, describeLicense } from './credits.js'

const pct = (value) => `${Math.round(value * 100)}%`
const round = (value, digits = 1) => Number(value.toFixed(digits))
const signed = (value, unit) => `${value > 0 ? '+' : ''}${round(value)} ${unit}`

function panLabel(pan) {
  const p = Number(pan) || 0
  if (Math.abs(p) < 0.005) return 'center'
  return `${pct(Math.abs(p))} ${p < 0 ? 'left' : 'right'}`
}

function hzLabel(hz) {
  return hz >= 1000 ? `${round(hz / 1000)} kHz` : `${Math.round(hz)} Hz`
}

function secondsRange(min, max) {
  return round(min) === round(max) ? `${round(min)} s` : `${round(min)}-${round(max)} s`
}

// Sound or bus filters -> short phrases.
export function describeFilters(filters) {
  if (!filters) return []
  const parts = []
  if (filters.highpassHz > 0) parts.push(`high-pass ${hzLabel(filters.highpassHz)}`)
  if (filters.lowpassHz > 0 && filters.lowpassHz < 20000) parts.push(`low-pass ${hzLabel(filters.lowpassHz)}`)
  if (filters.gainDb) parts.push(`gain ${signed(filters.gainDb, 'dB')}`)
  const eqBands = (filters.eq ?? []).filter((band) => band.type && band.type !== 'off' && !(['peaking', 'lowshelf', 'highshelf'].includes(band.type) && !band.gainDb))
  if (eqBands.length) parts.push(`EQ (${eqBands.length} band${eqBands.length === 1 ? '' : 's'})`)
  if (filters.echoDelayMs > 0 && filters.echoDecay > 0) parts.push(`echo ${Math.round(filters.echoDelayMs)} ms`)
  if (filters.reverbMix > 0 && filters.reverbSizeMs > 0) parts.push(`reverb ${pct(filters.reverbMix)} (${round(filters.reverbSizeMs / 1000)} s)`)
  if (filters.occlusion > 0) parts.push(`occlusion ${pct(filters.occlusion)} (sounds like it's behind a wall)`)
  if (filters.gateThresholdDb > -80 && filters.gateRangeDb > 0) parts.push('noise gate')
  if (filters.denoiseEnabled) parts.push('noise reduction')
  if (filters.volumeEnvelope?.enabled) parts.push('volume envelope')
  if (filters.pan && Math.abs(filters.pan) >= 0.005) parts.push(`panned ${panLabel(filters.pan)}`)
  return parts
}

const DRIFT_FORMAT = {
  volume: { fullRange: 'anywhere from silent to full', range: (a) => `${pct(a.min)}-${pct(a.max)}` },
  pitch: { fullRange: 'anywhere within ±6 st', range: (a) => `${signed(a.min, 'st')} to ${signed(a.max, 'st')}` },
  pan: { fullRange: 'anywhere left to right', range: (a) => `${panLabel(a.min)} to ${panLabel(a.max)}` }
}

// Slow random drift (Fluctuation) axes -> "volume drifts 50%-100% (every 6-14 s)".
export function describeDrift(fluctuation) {
  const parts = []
  for (const axis of ['volume', 'pitch', 'pan']) {
    const a = fluctuation?.[axis]
    if (!a?.enabled) continue
    const format = DRIFT_FORMAT[axis]
    const range = a.fullyRandom ? format.fullRange : format.range(a)
    const timing = a.changeMinSeconds != null ? ` (changes every ${secondsRange(a.changeMinSeconds, a.changeMaxSeconds ?? a.changeMinSeconds)})` : ''
    const perSound = a.perSound ? ', each sound on its own' : ''
    parts.push(`${axis} drifts ${range}${timing}${perSound}`)
  }
  return parts
}

// Per-play randomization of a Random Interval / Scheduled sound.
function describeShots(config) {
  if (!config) return []
  const parts = []
  if (config.pitchFullyRandom) parts.push('pitch fully random each play')
  else if (config.minPitchSemitones || config.maxPitchSemitones) {
    parts.push(`pitch ${signed(config.minPitchSemitones ?? 0, 'st')} to ${signed(config.maxPitchSemitones ?? 0, 'st')} each play`)
  }
  if (config.volumeFullyRandom) parts.push('volume fully random each play')
  else if ((config.minVolume ?? 1) !== 1 || (config.maxVolume ?? 1) !== 1) {
    parts.push(`volume ${pct(config.minVolume ?? 1)}-${pct(config.maxVolume ?? 1)} each play`)
  }
  if (config.panFullyRandom) parts.push('random left/right position each play')
  else if (config.minPan || config.maxPan) parts.push(`position ${panLabel(config.minPan ?? 0)} to ${panLabel(config.maxPan ?? 0)} each play`)
  if ((config.minSpeed ?? 1) !== 1 || (config.maxSpeed ?? 1) !== 1) parts.push(`speed ${pct(config.minSpeed ?? 1)}-${pct(config.maxSpeed ?? 1)}`)
  if (config.fadeInMs > 0 || config.fadeOutMs > 0) parts.push(`fades ${Math.round(config.fadeInMs ?? 0)} ms in / ${Math.round(config.fadeOutMs ?? 0)} ms out`)
  if (config.syncGroup) parts.push(`always plays together with the "${config.syncGroup}" sounds`)
  return parts
}

function describePlayMode(entry) {
  if (entry.playMode === 'scatter') {
    const s = entry.scatter ?? {}
    const gap = s.gapFullyRandom ? 'at fully random intervals' : `every ${secondsRange(s.minGapSeconds ?? 0, s.maxGapSeconds ?? 0)} (random)`
    return `plays now and then, ${gap}`
  }
  if (entry.playMode === 'scheduled') {
    const s = entry.schedule ?? {}
    if (s.type === 'interval') return `plays on a clock, every ${s.intervalMinutes} min`
    const times = (s.times ?? []).join(', ')
    return times ? `plays on a clock, at ${times}` : 'plays on a clock'
  }
  return 'loops continuously'
}

function describeSpeedPitch(sp) {
  if (!sp) return []
  const parts = []
  if ((sp.speed ?? 1) !== 1) parts.push(`speed ${pct(sp.speed)}`)
  if (sp.pitchSemitones) parts.push(`pitch ${signed(sp.pitchSemitones, 'st')}`)
  if (sp.reversed) parts.push('played backwards')
  if (sp.dopplerEnabled) parts.push(sp.dopplerReversed ? 'Doppler (moves away then back)' : 'Doppler pass-by')
  return parts
}

// sounds: [{ entry (effective, with overrides), volume }]; groups: the
// preset's groups; wholeMix: the preset's whole-mix filters (or null).
export function buildSceneSection({ sounds, groups = [], wholeMix = null }) {
  const lines = ['How the scene is set up:']
  const nameById = new Map(sounds.map(({ entry }) => [entry.id, entry.name]))
  const groupBySound = new Map()
  for (const group of groups) for (const id of group.soundIds ?? []) groupBySound.set(id, group)

  for (const { entry, volume } of sounds) {
    const group = groupBySound.get(entry.id)
    const head = [`volume ${pct(volume)}`, describePlayMode(entry)]
    if (group) head.push(`in group "${group.name}"`)
    lines.push(`- ${entry.name}: ${head.join(', ')}`)
    const details = [
      ...describeSpeedPitch(entry.speedPitch),
      ...(entry.playMode === 'scatter' || entry.playMode === 'scheduled'
        ? describeShots(entry.playMode === 'scatter' ? entry.scatter : entry.schedule)
        : describeDrift(entry.fluctuation)),
      ...describeFilters(entry.filters)
    ]
    if (details.length) lines.push(`    ${details.join('; ')}`)
  }

  const describedGroups = groups.filter((g) => (g.soundIds ?? []).some((id) => nameById.has(id)))
  if (describedGroups.length) {
    lines.push('', 'Sound groups (processed together):')
    for (const group of describedGroups) {
      const members = group.soundIds.filter((id) => nameById.has(id)).map((id) => nameById.get(id))
      const details = [...describeFilters(group.filters), ...describeDrift(group.filters?.fluctuation)]
      lines.push(`- "${group.name}" (${members.join(', ')})${details.length ? `: ${details.join('; ')}` : ''}`)
    }
  }

  const mixDetails = [...describeFilters(wholeMix), ...describeDrift(wholeMix?.fluctuation)]
  if (mixDetails.length) lines.push('', `Whole mix: ${mixDetails.join('; ')}`)
  return lines
}

// credits: [{ name, source }] from library.resolveCredits.
export function buildCreditsSection(credits) {
  const credited = credits.map((c) => ({ ...c, line: creditLine(c.name, c.source) })).filter((c) => c.line)
  const lines = ['Credits:']
  if (!credited.length) {
    lines.push('- No third-party sounds with known sources (all sounds were added from local files).')
    return lines
  }
  for (const c of credited) lines.push(`- ${c.line}`)
  const needsAttribution = credited.some((c) => c.source?.type === 'freesound' && describeLicense(c.source.license).attribution)
  if (needsAttribution) {
    lines.push('Freesound sounds under Creative Commons Attribution licenses must be credited as above wherever the audio is published.')
  }
  const unknown = credited.filter((c) => c.source?.type === 'freesound' && !c.source.license)
  if (unknown.length) {
    lines.push(`License not found for: ${unknown.map((c) => c.name).join(', ')} - check each sound's Freesound page before publishing.`)
  }
  const extraContext = credited.filter((c) => c.source?.description)
  if (extraContext.length) {
    lines.push('', 'What the Freesound authors say about their sounds:')
    for (const c of extraContext) lines.push(`- ${c.name}: ${c.source.description}`)
  }
  return lines
}
