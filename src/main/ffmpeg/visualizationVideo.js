import { runFfmpegToFile } from './runFfmpeg.js'

// Export tab's last open wishlist item (Board #next): "generate a
// customizable audio-reactive visualization video (spectrogram/waveform,
// colors/size/background) to couple with the export." The owner's own note
// flagged speed/optimization as a hard requirement, so this was researched
// against the real bundled ffmpeg before any of it was built (per
// [[feedback_research_before_complex_tasks]]):
//
// - ffmpeg ships real audio-visualization filters (A->V): showwaves,
//   showspectrum, avectorscope - no external tool/dependency needed.
// - Benchmarked on a real 5-minute synthetic file (pink noise + tone, mimics
//   ambient content) at 1920x1080/15fps: showwaves ~5x realtime, avectorscope
//   ~15x, showspectrum (the heaviest - it's doing a real STFT) ~7x. All
//   comfortably faster than the audio DSP phases already in this pipeline,
//   so a multi-hour export adds well under an hour even at the largest size.
// - A custom (non-black) BACKGROUND color needs compositing on top of that,
//   since none of these filters take a background-color option (only
//   showwaves takes a foreground `colors` option). Two approaches were
//   measured: a colorkey+overlay alpha composite (format=yuva420p,colorkey,
//   overlay) measured close to 1x realtime and one real run of it failed
//   outright - rejected, never shipped. A screen-blend composite (two opaque
//   RGB frames, no alpha channel: `color=bg[bg];...[wave];[bg][wave]
//   blend=all_mode=screen[v]`) measured ~2x realtime at 1080p - real but
//   meaningfully slower than the plain-black path. Given the owner's own
//   hard speed requirement, black stays the fast default (skips compositing
//   entirely) and a custom background is opt-in, with the Export tab UI
//   saying plainly that it renders slower.
//
// fps was originally fixed at 15 (not exposed as a UI knob) on the theory
// that it's smooth enough for an ambient background visual. Owner feedback
// after actually trying all three styles on a real export (2026-09-05
// inbox): "works fine but i think you should leave the option to choose
// between 15, 30 and 60 fps... if you can find a way to speed up the
// process... that would be nice." 15 stays the default (fastest, matches the
// original benchmarks in the comment below), 30/60 are opt-in and cost
// proportionally more encode time - the Export tab UI says so directly
// rather than silently making it slower.
const DEFAULT_VIZ_FPS = 15
const VIZ_FPS_OPTIONS = [15, 30, 60]

function resolveFps(fps) {
  return VIZ_FPS_OPTIONS.includes(fps) ? fps : DEFAULT_VIZ_FPS
}

// Also investigated for "speed this up further": bumping libx264's own
// -preset from veryfast to ultrafast. Benchmarked directly against the real
// bundled ffmpeg (a 30s 1080p showwaves render) - real, but only ~40% faster
// while the output file ballooned ~2.6x (26MB -> 69MB at 15fps for just 30s;
// at real export scale that's a multi-GB difference). Not worth it for a
// background visual - rejected, veryfast stays. The fps selector above is
// the real speed/quality trade-off knob this feature needed.

const SIZE_PRESETS = {
  small: '854x480',
  medium: '1280x720',
  large: '1920x1080'
}

const SPECTRUM_PALETTES = ['intensity', 'rainbow', 'fire', 'magma', 'cool', 'moreland']

function hexToFfmpegColor(hex) {
  const clean = String(hex ?? '').trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(clean) ? `0x${clean}` : '0x000000'
}

function isBlack(hex) {
  return hexToFfmpegColor(hex) === '0x000000'
}

function buildVizFilter(type, size, colorHex, palette, fps) {
  if (type === 'spectrum') {
    const pal = SPECTRUM_PALETTES.includes(palette) ? palette : 'intensity'
    return `showspectrum=s=${size}:slide=scroll:mode=combined:color=${pal},fps=${fps}`
  }
  if (type === 'vectorscope') {
    return `avectorscope=s=${size}:rate=${fps}:draw=aaline:zoom=1.5`
  }
  return `showwaves=s=${size}:mode=cline:colors=${hexToFfmpegColor(colorHex)}:rate=${fps}`
}

// Same mux shape as loopClip.js/exportMix.js's other video renderers
// (renderBlackScreenVideo/renderLoopedVideoFromFile): one .mkv next to the
// audio, audio stream-copied so it stays bit-identical, `-t durationSeconds`
// pins the exact length. Unlike those two, there's no separate "generate a
// tiny clip, then loop/mux it" step here - the visualization is genuinely
// driven by the real audio the whole way through, so one pass does
// everything (decode audio -> generate video frames from it -> encode ->
// mux back with the same audio, copied not re-decoded).
export async function renderVisualizationVideo(audioPath, durationSeconds, options, reporter) {
  const {
    type = 'waveform',
    color = '#9ece6a',
    bgColor = '#000000',
    palette = 'intensity',
    size: sizeKey = 'medium',
    fps: fpsOption
  } = options || {}
  const size = SIZE_PRESETS[sizeKey] || SIZE_PRESETS.medium
  const fps = resolveFps(fpsOption)
  reporter?.step(`Rendering ${type} visualization video (${fps}fps)…`)
  const videoPath = audioPath.replace(/\.[^./\\]+$/, '') + '.mkv'
  const vizFilter = buildVizFilter(type, size, color, palette, fps)
  const filterComplex = isBlack(bgColor)
    ? `[0:a]${vizFilter}[v]`
    : `color=c=${hexToFfmpegColor(bgColor)}:s=${size}:r=${fps}:d=${durationSeconds.toFixed(3)}[bg];` +
      `[0:a]${vizFilter}[wave];[bg][wave]blend=all_mode=screen[v]`
  await runFfmpegToFile(
    [
      '-y',
      '-i', audioPath,
      '-filter_complex', filterComplex,
      '-map', '[v]', '-map', '0:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-shortest',
      '-t', durationSeconds.toFixed(3),
      videoPath
    ],
    { onProgress: (sec) => reporter?.tick(sec, durationSeconds) }
  )
  reporter?.completePhase(durationSeconds)
  return videoPath
}

export { SIZE_PRESETS, SPECTRUM_PALETTES, VIZ_FPS_OPTIONS, DEFAULT_VIZ_FPS }
