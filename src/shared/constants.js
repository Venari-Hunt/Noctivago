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
