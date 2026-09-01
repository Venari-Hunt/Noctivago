import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { runFfmpegToFile } from './runFfmpeg.js'
import { renderClipToPath } from './loopClip.js'

// The Composite feature (a new tab, per the owner's own direction): bakes
// two or more existing sounds - each already trimmed/filtered/speed-shaped
// per their own real, current Remix settings - into ONE new physical audio
// file, each placed at its own relative delay. Per the owner's explicit
// framing ("it is in fact a new audio file... so the existing
// infrastructure is still valid for it"), the result isn't a live multi-
// source playback rig - it's baked once, then handed to library.addSound
// like any normal import, so every existing piece of machinery (Loop/
// Random Interval/Scheduled, filters, EQ, Export, Save as copy...) just
// works on it unchanged, with zero new playback code.
//
// Reuses loopClip.js's renderClipToPath (built for the Export plugin) for
// each member's own bake - same reasoning as exportMix.js's per-sound
// tracks - then combines with plain adelay+amix. Unlike Export's per-shot
// placement (many *copies of the same* short clip, hence asplit), a
// composite's members are a handful of genuinely *different* files, so a
// plain multiple-input filter graph is simpler and sufficient - no
// realistic composite has hundreds of members the way a multi-hour export
// has hundreds of scatter shots.
function tempPath(dir, ext) {
  return path.join(dir, `${crypto.randomUUID()}.${ext}`)
}

// Channel count from a canonical PCM WAV header (which is exactly what
// renderClipToPath writes - RIFF/WAVE/fmt with no chunks before fmt, so
// NumChannels is always at byte offset 22). Falls back to 2 if the header
// isn't what we expect, since treating an unknown as stereo just skips the
// mono-upmix step below (worst case a genuine mono clip stays mono in the
// mix, which amix still handles).
function readWavChannels(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(24)
    fs.readSync(fd, buf, 0, 24, 0)
    fs.closeSync(fd)
    if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return 2
    const ch = buf.readUInt16LE(22)
    return ch >= 1 && ch <= 8 ? ch : 2
  } catch {
    return 2
  }
}

export async function renderComposite({ members, outputPath }) {
  const tmpDir = path.dirname(outputPath)
  fs.mkdirSync(tmpDir, { recursive: true })
  const memberFiles = []
  try {
    for (const member of members) {
      const shotPath = tempPath(tmpDir, 'wav')
      const result = await renderClipToPath({
        inputPath: member.inputPath,
        loopStart: member.loopStart,
        loopEnd: member.loopEnd,
        filters: member.filters,
        // A composite member is a one-shot placement, never looped back-to-
        // back against itself - same reasoning Scatter/Scheduled/Doppler
        // already force crossfade to 0 for.
        crossfadeSeconds: 0,
        speedPitch: member.speedPitch,
        outputPath: shotPath
      })
      if (!result.ok) throw new Error(result.error ?? 'composite member render failed')
      memberFiles.push({
        path: shotPath,
        delayMs: Math.max(0, Math.round(member.delayMs ?? 0)),
        // Per-member weld volume, set on the Composite timeline. Linear gain;
        // 1 = unchanged. Clamped to a sane ceiling so a fat-fingered value
        // can't blow the mix out.
        volume: Math.max(0, Math.min(4, member.volume ?? 1)),
        channels: readWavChannels(shotPath)
      })
    }

    const n = memberFiles.length
    const inputArgs = memberFiles.flatMap((m) => ['-i', m.path])
    const graphParts = []
    const mixLabels = []
    memberFiles.forEach((m, i) => {
      // Bring every branch to stereo/44.1k before the mix. Rate is normalized
      // with aformat=sample_rates (which, unlike aformat=channel_layouts, is
      // level-safe). A mono clip is upmixed with an explicit duplicate
      // (pan ... c1=c0) rather than aformat=channel_layouts=stereo, which in
      // this ffmpeg build does a -3 dB power-split upmix that would silently
      // undercut the per-member volume - and wouldn't match how the live
      // Mixer (Web Audio) plays a mono source, which is a full-level
      // duplicate. adelay=...:all=1 delays every channel; volume is the weld
      // level.
      const toStereo = m.channels === 1 ? ',pan=stereo|c0=c0|c1=c0' : ''
      graphParts.push(
        `[${i}:a]aformat=sample_rates=44100${toStereo},volume=${m.volume.toFixed(4)},adelay=${m.delayMs}:all=1[d${i}]`
      )
      mixLabels.push(`[d${i}]`)
    })
    // normalize=0 = honest summing, matching the live Mixer's own AudioContext
    // and the Export pipeline (v0.1.99). The default normalize=1 would divide
    // every member by n, making the per-member volume control meaningless.
    // alimiter (limit 0.95, level=disabled so it never *boosts*) is a safety
    // brick-wall: honest summing means a composite of several members
    // overlapping at high volume can exceed 0 dBFS and hard-clip the
    // pcm_s16le encoder, and unlike Export this tab has no whole-mix Gain to
    // pull it back. It only acts on peaks that would clip anyway - inaudible
    // below threshold (verified on the bundled binary: a quiet mix passes
    // through untouched, an over-unity mix is pulled to ~-0.4 dB).
    graphParts.push(
      `${mixLabels.join('')}amix=inputs=${n}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=disabled[out]`
    )

    // -f wav is required here (not needed when writing straight to a real
    // .wav path elsewhere in this codebase) because the .tmp-then-rename
    // safety pattern means ffmpeg's own output path ends in ".tmp", not
    // ".wav" - without an explicit format, ffmpeg tries to infer the
    // container from the file extension and fails outright on an
    // unrecognized one. Caught live: the first real bake attempt failed
    // with "Unable to choose an output format" before this was added.
    const tmpOutPath = `${outputPath}.tmp`
    await runFfmpegToFile([
      '-y', ...inputArgs,
      '-filter_complex', graphParts.join(';'),
      '-map', '[out]',
      '-c:a', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-f', 'wav',
      tmpOutPath
    ])
    fs.renameSync(tmpOutPath, outputPath)
    return { ok: true }
  } catch (err) {
    console.error('renderComposite failed', err)
    return { ok: false, error: err.message }
  } finally {
    for (const m of memberFiles) {
      try {
        if (fs.existsSync(m.path)) fs.unlinkSync(m.path)
      } catch {
        // best-effort cleanup
      }
    }
  }
}
