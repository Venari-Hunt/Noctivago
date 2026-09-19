// Format for audio the app produces and keeps in the library: recordings,
// link and Freesound downloads, Composite renders. These used to be 16-bit
// WAV. FLAC with the same 16-bit samples decodes to the exact same audio at
// roughly half the size ("heavy files should be made smaller", 2026-09-09).
// Chromium, the Web Audio decoder and ffmpeg all read FLAC natively.
export const STORED_AUDIO_EXT = '.flac'
export const STORED_AUDIO_ARGS = ['-c:a', 'flac', '-sample_fmt', 's16']
