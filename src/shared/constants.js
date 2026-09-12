// A trimmed loop region up to this length gets rendered by ffmpeg into its own
// small clip, then fully decoded client-side for native, click-free looping.
// Above this, the region is still played by streaming the original file with
// an approximate seek-back loop — decoding it into memory would risk the same
// crash/multi-GB-RAM problem long files hit before this app streamed instead
// of decoding. Renderer checks this before ever asking main to render a clip;
// main enforces it too so the two can't drift.
export const MAX_BUFFER_CLIP_SECONDS = 600

// A fresh sound's volume. The volume sliders are bipolar - their center is
// unity gain (the sound at its own recorded level), so a new sound sits dead
// center. Was 0.7 (an arbitrary slight attenuation) before the bipolar
// sliders. Imported by both the renderer (core/volumeScale.js) and main
// (library.js) so the default can't drift between them.
export const DEFAULT_SOUND_VOLUME = 1

// Sound Group "occlusion" (v0.1.182): a single 0..1 knob approximating "this
// group is behind a wall/door from the listener". Real game-audio occlusion
// isn't just quieter - it's muffled AND echoey (lowpass pulled down while
// reverb wet is pushed up at the same time; a muffled-but-echoey signal
// reads as "behind something", muffled alone just reads as "quieter").
// Researched from general audio-occlusion technique writeups plus Ambiance
// Architect's own zone-occlusion feature before picking this direction (see
// CLAUDE.md / noctivago_audacity_research memory). Combines with a group's
// own manual lowpass/reverb sliders by taking whichever is MORE occluded
// (min lowpass cutoff, max reverb size/mix), so this only ever adds
// muffling on top of a deliberate manual setting, never undoes one.
// Exported as one function so the renderer's live SoundGroupChain and
// main's export bake (exportMix.js) can't drift apart the way a
// hand-duplicated field list has bitten this codebase before (see the
// "flattened field list, edit by hand" comment in plugins/editor/index.js).
export const OCCLUSION_LOWPASS_HZ = 700
export const OCCLUSION_REVERB_SIZE_MS = 900
export const OCCLUSION_REVERB_MIX_MAX = 0.4

export function applyOcclusionToFilters(filters) {
  const f = filters ?? {}
  const occlusion = Math.min(1, Math.max(0, Number(f.occlusion) || 0))
  if (occlusion <= 0) return f
  const baseLowpassHz = f.lowpassHz ?? 20000
  // Log-space interpolation (not linear) since cutoff frequency is
  // perceived logarithmically - a linear ramp from 20000 to 700 would spend
  // most of the slider's range sounding nearly identical to "off".
  const occludedLowpassHz = 20000 * Math.pow(OCCLUSION_LOWPASS_HZ / 20000, occlusion)
  return {
    ...f,
    lowpassHz: Math.min(baseLowpassHz, occludedLowpassHz),
    reverbSizeMs: Math.max(f.reverbSizeMs ?? 0, OCCLUSION_REVERB_SIZE_MS * occlusion),
    reverbMix: Math.max(f.reverbMix ?? 0, OCCLUSION_REVERB_MIX_MAX * occlusion)
  }
}
