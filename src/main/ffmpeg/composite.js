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
      memberFiles.push({ path: shotPath, delayMs: Math.max(0, Math.round(member.delayMs ?? 0)) })
    }

    const n = memberFiles.length
    const inputArgs = memberFiles.flatMap((m) => ['-i', m.path])
    const graphParts = []
    const mixLabels = []
    memberFiles.forEach((m, i) => {
      graphParts.push(`[${i}:a]adelay=${m.delayMs}|${m.delayMs}[d${i}]`)
      mixLabels.push(`[d${i}]`)
    })
    graphParts.push(`${mixLabels.join('')}amix=inputs=${n}:duration=longest:dropout_transition=0[out]`)

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
      '-c:a', 'pcm_s16le', '-ar', '44100', '-f', 'wav',
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
