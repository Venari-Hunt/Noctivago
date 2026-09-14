import { runFfmpegToFile } from './runFfmpeg.js'

// Inbox (2026-09-05, flagged "veeeery optional... not very crucial"): "loop
// an image, with options to tweak it - start 0 opacity ends 100% or vice
// versa, image spins, image does the lil dvd animation." A fourth
// videoBackground alongside black/file/visualization (see exportMix.js's
// renderVideoOutput dispatcher) - same overall shape as the other two real
// encodes (renderLoopedVideoFromFile/renderVisualizationVideo): one .mkv,
// audio stream-copied so it stays bit-identical, `-t durationSeconds` pins
// the exact length.
//
// Verified all three filter graphs directly against the real bundled ffmpeg
// before writing this (per [[feedback_research_before_complex_tasks]]) -
// including sampling actual output pixels at the mathematically expected
// position/color, not just checking for a zero exit code:
// - fade: plain `fade=t=in/out` on the whole composited frame (canvas is
//   already black, so fading toward black is indistinguishable from only the
//   image itself fading) - confirmed the brightness ramp at 5 sample points
//   across a fade in and a fade out.
// - spin: image scaled+padded into a square (so an arbitrary-aspect source
//   doesn't distort), continuously `rotate`d, composited onto a black
//   canvas - confirmed with an asymmetric two-color test image that a fixed
//   sample point actually cycles between both colors over time (a
//   flat-colored test image can't prove rotation is happening at all, which
//   the first pass at this test got wrong).
// - bounce: classic "DVD logo" triangle-wave motion via
//   `abs(mod(t*speed,2*range)-range)` on both x and y (different speeds so
//   the path doesn't retrace a single diagonal forever) - confirmed the
//   overlay lands at the exact computed (x,y) at several timestamps by
//   sampling real output pixels there and at a background corner.
//
// Fixed at a single 1920x1080 black canvas rather than the size/background
// options visualizationVideo.js exposes - this feature is explicitly
// low-priority/optional per the owner's own note, and a custom background
// color would need the same "compositing costs real render time" tradeoff
// already flagged there; simplest version first.
const CANVAS_WIDTH = 1920
const CANVAS_HEIGHT = 1080
const MOTIONS = ['none', 'spin', 'bounce']

function buildImageFilter(motion) {
  if (motion === 'spin') {
    // Square box sized so the square's own diagonal (side*sqrt(2)) can never
    // exceed the canvas's shorter dimension while rotating - side*sqrt(2) <=
    // 1080 -> side <= ~763; 700 leaves a visible margin.
    const side = 700
    return (
      `[0:v]scale=${side}:${side}:force_original_aspect_ratio=decrease,` +
      `pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `rotate=a='2*PI*t/8':c=black:ow=${side}:oh=${side}[img];` +
      `color=c=black:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}[bg];` +
      `[bg][img]overlay=(W-w)/2:(H-h)/2[v]`
    )
  }
  if (motion === 'bounce') {
    const logoW = Math.round(CANVAS_WIDTH * 0.22)
    const logoH = Math.round(CANVAS_HEIGHT * 0.22)
    const rangeX = CANVAS_WIDTH - logoW
    const rangeY = CANVAS_HEIGHT - logoH
    return (
      `[0:v]scale=${logoW}:${logoH}:force_original_aspect_ratio=decrease,` +
      `pad=${logoW}:${logoH}:(ow-iw)/2:(oh-ih)/2:color=black[img];` +
      `color=c=black:s=${CANVAS_WIDTH}x${CANVAS_HEIGHT}[bg];` +
      `[bg][img]overlay=x='abs(mod(t*131,2*${rangeX})-${rangeX})':y='abs(mod(t*97,2*${rangeY})-${rangeY})':eval=frame[v]`
    )
  }
  // 'none' - static, fitted/padded to fill the canvas without distortion
  return (
    `[0:v]scale=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:force_original_aspect_ratio=decrease,` +
    `pad=${CANVAS_WIDTH}:${CANVAS_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black[v]`
  )
}

export async function renderImageLoopVideo(audioPath, durationSeconds, imagePath, options, reporter) {
  const { motion: motionOption, fadeInSeconds = 0, fadeOutSeconds = 0 } = options || {}
  const motion = MOTIONS.includes(motionOption) ? motionOption : 'none'
  reporter?.step(`Rendering ${motion === 'none' ? 'image' : motion} background video…`)
  const videoPath = audioPath.replace(/\.[^./\\]+$/, '') + '.mkv'
  let chain = buildImageFilter(motion)
  const fadeParts = []
  if (fadeInSeconds > 0) fadeParts.push(`fade=t=in:st=0:d=${fadeInSeconds.toFixed(3)}`)
  if (fadeOutSeconds > 0) {
    fadeParts.push(`fade=t=out:st=${Math.max(0, durationSeconds - fadeOutSeconds).toFixed(3)}:d=${fadeOutSeconds.toFixed(3)}`)
  }
  if (fadeParts.length) {
    chain = chain.replace('[v]', '[precanvas]') + `;[precanvas]${fadeParts.join(',')}[v]`
  }
  await runFfmpegToFile(
    [
      '-y',
      '-loop', '1', '-i', imagePath,
      '-i', audioPath,
      '-filter_complex', chain,
      '-map', '[v]', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
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

export { MOTIONS }
