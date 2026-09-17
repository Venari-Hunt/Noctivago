// Sound Group drift rules (v0.1.218) - which drift settings a group's bus
// and each of its member sounds actually use. Shared by the live Mixer
// (tabs/mixer/index.js, SoundGroupChain.js) and the export
// (src/main/ffmpeg/exportMix.js). plugins/export/simulate.js keeps its own
// copy of applyGroupShotOverride (the plugin sandbox can't import this) -
// keep them in sync.
//
// A group drift axis (volume, pitch, pan) is either:
//   - shared (perSound off): the group's bus drifts, all members together -
//     and, so a member doesn't also wander on its own and fall out of sync
//     with the group it's supposedly moving with, a shared volume or pan
//     drift switches off that same axis's own per-sound drift (originally
//     only done for pan in v0.1.217; volume never got the equivalent fix
//     until v0.1.231, an inconsistency caught from a direct question about
//     whether members drift together, not a report of an audible bug).
//     Pitch can't be shared (a bus is a sum of sounds, nothing to detune).
//   - per sound (perSound on): the bus leaves that axis alone and every
//     member runs the group's settings on its own - a looping member gets
//     them as its own drift (its own random walk, so members differ); a
//     Random Interval / Scheduled member uses the same min/max/bias as its
//     per-play random range for that axis.

export const DRIFT_AXES = ['volume', 'pitch', 'pan']
// Axes a group's bus can actually drift on its own (pitch never can - see
// above) - shared, non-per-sound bus drift on one of these switches off a
// member's own drift on that same axis.
export const BUS_CAPABLE_AXES = ['volume', 'pan']

// Drift pitch roams +/-6 st (Modulator.js's FLUCTUATION_PITCH_RANGE).
const DRIFT_FULL_RANGE = { volume: [0, 1], pitch: [-6, 6], pan: [-1, 1] }

// Per-play field names in a scatter/schedule config, per axis.
export const SHOT_AXIS_FIELDS = {
  volume: { min: 'minVolume', max: 'maxVolume', bias: 'volumeBias', biasEnabled: 'volumeBiasEnabled', fullyRandom: 'volumeFullyRandom' },
  pitch: { min: 'minPitchSemitones', max: 'maxPitchSemitones', bias: 'pitchBiasSemitones', biasEnabled: 'pitchBiasEnabled', fullyRandom: 'pitchFullyRandom' },
  pan: { min: 'minPan', max: 'maxPan', bias: 'panBias', biasEnabled: 'panBiasEnabled', fullyRandom: 'panFullyRandom' }
}

function perSoundAxis(groupFluctuation, axis) {
  const a = groupFluctuation?.[axis]
  return a?.enabled && (a.perSound || axis === 'pitch') ? a : null
}

// What the group's bus itself drifts: shared axes only.
export function busFluctuation(groupFluctuation) {
  if (!groupFluctuation) return null
  const out = {}
  for (const axis of ['volume', 'pan']) {
    const a = groupFluctuation[axis]
    if (a?.enabled && !a.perSound) out[axis] = a
  }
  return Object.keys(out).length ? out : null
}

// A looping member's effective drift.
export function effectiveMemberFluctuation(fluctuation, groupFluctuation) {
  if (!groupFluctuation) return fluctuation ?? null
  let out = fluctuation ?? null
  for (const axis of DRIFT_AXES) {
    const shared = groupFluctuation[axis]
    const own = perSoundAxis(groupFluctuation, axis)
    if (own) {
      out = { ...(out ?? {}), [axis]: { ...own, enabled: true } }
    } else if (BUS_CAPABLE_AXES.includes(axis) && shared?.enabled && out?.[axis]?.enabled) {
      out = { ...out, [axis]: { ...out[axis], enabled: false } }
    }
  }
  return out
}

// A Random Interval / Scheduled member's effective per-play config (its
// `scatter` or `schedule` object).
export function applyGroupShotOverride(config, groupFluctuation) {
  if (!groupFluctuation) return config
  let out = config
  for (const axis of DRIFT_AXES) {
    const a = perSoundAxis(groupFluctuation, axis)
    if (!a) continue
    const f = SHOT_AXIS_FIELDS[axis]
    const [lo, hi] = DRIFT_FULL_RANGE[axis]
    const fully = Boolean(a.fullyRandom)
    const min = fully ? lo : Math.min(a.min, a.max)
    const max = fully ? hi : Math.max(a.min, a.max)
    out = {
      ...(out ?? {}),
      [f.min]: min,
      [f.max]: max,
      [f.bias]: Math.min(max, Math.max(min, Number.isFinite(a.bias) ? a.bias : (min + max) / 2)),
      [f.biasEnabled]: !fully && a.biasEnabled !== false,
      // Pitch's own per-play "fully random" spans +/-12 st, wider than drift's
      // +/-6 - so the drift range is spelled out as min/max instead.
      [f.fullyRandom]: false
    }
  }
  return out
}

// True when the group changes anything about its members (used by the Mixer
// to decide when a live group edit needs every member reconciled).
export function groupDriftMemberKey(groupFluctuation) {
  return JSON.stringify(
    DRIFT_AXES.map((axis) => {
      const a = groupFluctuation?.[axis]
      if (!a?.enabled) return null
      return perSoundAxis(groupFluctuation, axis) ? a : BUS_CAPABLE_AXES.includes(axis) ? 'shared' : null
    })
  )
}
