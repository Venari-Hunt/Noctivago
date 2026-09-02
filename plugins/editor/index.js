import { AudioEngine } from './audio/AudioEngine.js'
import { PreviewSource } from './audio/PreviewSource.js'
import { createLoopEditorController } from './ui/LoopEditor.js'
import { createEqEditorController, Q_MIN, Q_MAX, SLOPE_CAPABLE_EQ_TYPES } from './ui/EqEditor.js'
import { createWaveformScrollbar } from './ui/WaveformScrollbar.js'
import { formatDuration, parseDuration } from './util/time.js'

// Mirrors src/shared/constants.js's MAX_BUFFER_CLIP_SECONDS. Duplicated here
// since a plugin can't import files outside its own directory (see the
// path-traversal guard in src/main/plugins/protocol.js) — keep in sync with
// core if that value ever changes.
const MAX_BUFFER_CLIP_SECONDS = 600

// Mirrors src/main/ffmpeg/loopClip.js's DEFAULT_CROSSFADE_SECONDS (0.2s),
// in ms since the slider works in ms - same cross-directory duplication
// reason as MAX_BUFFER_CLIP_SECONDS above. Shown on the crossfade slider for
// any sound that's never had it explicitly overridden (entry.
// crossfadeSeconds is null).
const DEFAULT_CROSSFADE_MS = 200

// Undo/Redo: how long to wait after the last change before recording a
// history point, and how many points to keep. A live drag or a rapid burst
// of wheel/keyboard nudges keeps resetting this timer, so only the settled
// end state gets recorded - not every intermediate frame - matching how a
// text editor's own undo groups fast typing into one step rather than one
// per keystroke.
const HISTORY_COMMIT_DEBOUNCE_MS = 500
const HISTORY_LIMIT = 100

// Play (triangle) / Pause (two bars) - mirrors the Mixer's own identical
// icon pair (src/renderer/tabs/mixer/index.js), duplicated here for the same
// cross-directory-import reason as MAX_BUFFER_CLIP_SECONDS above.
const PLAY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const PAUSE_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'

// Speaker (unmuted) / speaker-with-X (muted) - same icon pair as the
// Mixer's own volume mute buttons (duplicated per this plugin's usual
// "bundle your own copies" convention).
const VOLUME_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>'
const MUTE_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>'

// Hover marquee for the selected-sound title (#editor-sound-name) when the
// window is too narrow to show the whole name - mirrors the Mixer's own
// .sound-row-name marquee (src/renderer/ui/SoundRow.js), duplicated here for
// the same "a plugin bundles its own copies" reason as the constants above.
// The <h3> is white-space:nowrap + overflow:hidden + text-overflow:ellipsis
// (styles.css), so scrollWidth > clientWidth is exactly "this name is cut off".
const MARQUEE_BASE_PX_PER_SEC = 45
const MARQUEE_SPEED_SCALE = 0.06
const MARQUEE_MAX_PX_PER_SEC = 140

function wireNameMarquee(el) {
  el.addEventListener('mouseenter', () => {
    const overflow = el.scrollWidth - el.clientWidth
    if (overflow <= 0) return
    const pxPerSec = Math.min(MARQUEE_MAX_PX_PER_SEC, MARQUEE_BASE_PX_PER_SEC + overflow * MARQUEE_SPEED_SCALE)
    const duration = (overflow / pxPerSec) * 2 + 0.6
    el.style.setProperty('--marquee-distance', `-${overflow}px`)
    el.style.setProperty('--marquee-duration', `${duration}s`)
    el.classList.add('editor-sound-name-marquee')
  })
  el.addEventListener('mouseleave', () => {
    el.classList.remove('editor-sound-name-marquee')
  })
}

// Mirrors library.js's defaultEqBands() exactly - a fresh/reset EQ starts
// with zero bands now (user-managed via the graph's own +/trash controls),
// not a fixed preset. Same cross-directory duplication reason as
// MAX_BUFFER_CLIP_SECONDS above. A fresh function call each time, never a
// shared array, since callers mutate the objects they get back (the EQ
// editor controller clones on load() too, but this is cheap insurance).
function defaultEqBands() {
  return []
}

const NEUTRAL_FILTERS = { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0, reverbSizeMs: 0, reverbMix: 0, eq: defaultEqBands() }

// Curated highpass/lowpass/gain/echo combos for the one-click preset
// buttons. "Underwater" needs the lowpass slider's range extended below its
// old 500Hz floor (see the HTML below) to sound convincing; everything else
// fits the controls' original range.
//
// "Echo" uses echoDelayMs/echoDecay (a feedback delay line - clear, separated
// slapback repeats). "Reverb" used to be just a short-delay/high-decay
// approximation of the same knobs, since this ffmpeg build has no dedicated
// `reverb` filter - it's now real convolution reverb (reverbSizeMs/
// reverbMix, a synthetic impulse response via afir/ConvolverNode - see
// reverbIR.js), owner-requested ("if you need to write a better way to work
// with echo and delay you should absolutely do it"). Echo and Reverb are
// independent, stackable effects now, not two presets sharing one engine.
const FILTER_PRESETS = {
  muffled: { label: 'Muffled', highpassHz: 0, lowpassHz: 700, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  phone: { label: 'Over the Phone', highpassHz: 300, lowpassHz: 3400, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  radio: { label: 'On the Radio', highpassHz: 150, lowpassHz: 6000, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  distant: { label: 'Distant', highpassHz: 0, lowpassHz: 2500, gainDb: -8, echoDelayMs: 0, echoDecay: 0 },
  underwater: { label: 'Underwater', highpassHz: 0, lowpassHz: 250, gainDb: -3, echoDelayMs: 0, echoDecay: 0 },
  echo: { label: 'Echo', highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 350, echoDecay: 0.4 },
  reverb: { label: 'Reverb', highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0, reverbSizeMs: 1500, reverbMix: 0.35 }
}

export default class EditorPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.engine = new AudioEngine()

    this.library = []
    this.currentEntry = null
    this.pickerQuery = ''
    this.pickerHighlightIndex = -1
    this.previewSource = null
    this.previewRafId = null
    this.loopEditorController = null
    this.waveformPeaksCache = new Map()
    this.detailPeaksDebounceTimer = null
    // Persists across sounds within one tab session (like the filter
    // sliders' values don't) since it's a preview-workflow preference, not
    // per-sound saved state - nothing about it is written to the library.
    this.looping = true
    this.previewVolume = 0.7
    // Layered on top of previewVolume, not destructive to it - unmuting
    // always restores exactly whatever the slider was already showing,
    // same convention as the Mixer's own volume mute buttons.
    this.previewMuted = false
    // Solo: mutes every other already-playing Mixer sound while this one is
    // open in Remix, so it's audible against silence instead of the full
    // mix. Scoped to "the sound currently being edited," same as the EQ
    // graph's own per-band Solo (EqEditor.js) - reset on every fresh load()
    // and on leaving the tab (onHide below), never persisted, so it can
    // never silently linger and leave other sounds muted after the fact.
    this.soloActive = false
    // A/B Compare - reworked per direct feedback from "two independent
    // editable snapshots" into "A = current session (live, editable),
    // B = last saved mix (immutable, display-only)". B is captured once in
    // loadSound() and never mutated for the rest of the session, even
    // across an in-session Save (deliberately - "last saved... before the
    // current session"). eqLiveBandsStash holds A's live bands while B is
    // being viewed, so switching back restores exactly where editing left
    // off. Per editing session only, not persisted with the sound.
    this.eqCompareViewing = 'A'
    this.savedEqSnapshot = []
    this.eqLiveBandsStash = null
    this.els = {}

    // Undo/Redo: a plain array of full-state snapshots (the exact same
    // normalized shape snapshotOf() already produces for the dirty-check,
    // just parsed back into an object) plus an index into it - Ctrl+Z/
    // Ctrl+Shift+Z move the index and reapply that entry's state to every
    // control. Pushed on a debounced "settled" checkpoint (see
    // scheduleHistoryCommit), not every drag frame - see its own comment for
    // why. Reset fresh on every loadSound(), never persisted - undo history
    // is a per-editing-session aid, same scope as A/B Compare.
    this.historyStack = []
    this.historyIndex = -1
    this._historyCommitTimer = null
    // Set while applyEditorState() is pushing a past/future snapshot back
    // onto the live controls, so that itself doesn't get recorded as a new
    // history entry (which would corrupt the stack - undoing would then
    // just push right back onto what it undid).
    this._restoringHistory = false
    // Cached from Settings once on load - the leave-confirmation prompt's
    // own "Don't ask again" button, not a general Settings toggle (per the
    // original request: the prompt itself carries the opt-out).
    this.skipLeaveConfirm = false
  }

  async onload() {
    this.api.settings
      .get()
      .then((settings) => {
        this.skipLeaveConfirm = Boolean(settings.skipRemixLeaveConfirm)
      })
      .catch((err) => console.error('Editor: failed to load settings', err))

    // Ctrl+Z/Ctrl+Shift+Z - document-scoped since the tab bar has no notion
    // of "this specific tab's own keyboard shortcuts," but gated on
    // _tabActive (set by onShow/onHide below) so it's a no-op while a
    // different tab is on screen, and on the focused element not being a
    // free-text field (Start/End/Length/Times/Sync group) so native text-
    // undo inside those still works as expected.
    this._onKeyDown = (evt) => {
      if (!this._tabActive || !this.currentEntry) return
      if (!evt.ctrlKey || (evt.key !== 'z' && evt.key !== 'Z')) return
      const active = document.activeElement
      if (active && active.tagName === 'INPUT' && active.type === 'text') return
      if (active && active.tagName === 'TEXTAREA') return
      evt.preventDefault()
      if (evt.shiftKey) this.redo()
      else this.undo()
    }
    document.addEventListener('keydown', this._onKeyDown)

    this.unregister = this.app.tabs.register({
      id: 'remix',
      title: 'Remix',
      mount: (container) => this.mount(container),
      mountSticky: (container) => this.mountSticky(container),
      onShow: () => {
        this._tabActive = true
        // Picks up sounds added/removed elsewhere (e.g. the Mixer) since
        // this tab last mounted — mount() only runs once per tab lifetime,
        // so without this the picker would silently go stale.
        if (this.els.soundSearch) this.refreshLibrary().catch((err) => console.error('Editor: failed to refresh library', err))
        this._syncScrollTopVisibility?.()
      },
      onBeforeHide: () => this.confirmLeaveIfDirty(),
      onHide: () => {
        this._tabActive = false
        this.previewSource?.pause()
        this.stopPreviewTicking()
        this.setPlayPauseIcon(false)
        this.setSolo(false)
      },
      onDestroy: () => this.disposePreview()
    })
  }

  async onunload() {
    if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown)
    this.disposePreview()
    this.unregister?.()
  }

  // Not async: TabHost calls mount() without awaiting it, so an async
  // failure here wouldn't be caught by its fail-soft try/catch — kick off
  // the async part with its own local error handling instead.
  mount(container) {
    container.innerHTML = `
      <div class="editor-tab">
        <div class="editor-picker">
          <input id="editor-sound-search" type="text" class="editor-sound-search" placeholder="Select a sound to edit…" autocomplete="off" />
          <ul id="editor-sound-options" class="editor-sound-options hidden"></ul>
        </div>
        <div id="editor-panel" class="editor-panel hidden">
          <h3 id="editor-sound-name"></h3>
          <canvas id="editor-canvas" width="640" height="160" title="Scroll to zoom, shift+scroll or middle-drag to pan. Right-click-drag inside the trimmed region to move it."></canvas>
          <div id="editor-scrollbar" class="editor-scrollbar">
            <div id="editor-scrollbar-thumb" class="editor-scrollbar-thumb"></div>
          </div>
          <p id="editor-waveform-status" class="editor-waveform-status"></p>
          <div class="editor-times">
            <label>Start <input id="editor-start-input" type="text" inputmode="numeric" placeholder="0:00" /></label>
            <label>End <input id="editor-end-input" type="text" inputmode="numeric" placeholder="0:00" /></label>
            <label>Length <input id="editor-length-input" type="text" inputmode="numeric" placeholder="0:00" /></label>
            <label class="editor-reverse-toggle">
              <input id="editor-doppler" type="checkbox" />
              Doppler (pass-by)
            </label>
          </div>
          <div class="editor-suggest-loop-row">
            <button id="editor-suggest-loop" class="btn btn-small btn-icon-text" type="button" title="Analyze the file and propose a seamless loop region. You can still adjust Start/End afterward.">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>
              Suggest a loop point
            </button>
            <span id="editor-suggest-status" class="editor-suggest-status"></span>
          </div>
          <div id="editor-doppler-options" class="editor-speed-pitch hidden">
            <label>
              <span>Intensity</span>
              <input id="editor-doppler-intensity" type="range" min="1" max="12" value="5" step="1" />
              <span id="editor-doppler-intensity-value" class="editor-filter-value">5 st</span>
            </label>
            <label>
              <span>Sharpness</span>
              <input id="editor-doppler-sharpness" type="range" min="0" max="100" value="50" step="1" />
              <span id="editor-doppler-sharpness-value" class="editor-filter-value">50%</span>
            </label>
            <label class="editor-reverse-toggle">
              <input id="editor-doppler-reversed" type="checkbox" />
              Reverse (peak = furthest point, not closest)
            </label>
          </div>
          <p id="editor-doppler-hint" class="editor-speed-pitch-hint hidden">Simulates a sound passing by: pitch rises approaching the closest point (the gold marker on the waveform - drag it to control how fast each side ramps, double-click to re-center), then falls as it recedes toward Start/End. Reverse flips that: Start/End become the natural-pitch points and the marker becomes the peak shift instead — a sharp close pass-by rather than an approach/recede. Intensity sets how many semitones the shift swings; Sharpness sets how abruptly it swings through the marker — low is a slow continuous glide, high sits flat and does the whole swing in a burst right at the marker (the real pass-by whoosh). Only takes effect once saved (loops under 10 minutes) - no live preview while dragging.</p>
          <div class="editor-playmode">
            <span class="editor-playmode-label">Playback mode</span>
            <label class="editor-playmode-option">
              <input type="radio" name="editor-playmode" id="editor-playmode-loop" value="loop" checked />
              Loop
            </label>
            <label class="editor-playmode-option">
              <input type="radio" name="editor-playmode" id="editor-playmode-scatter" value="scatter" />
              Random interval
            </label>
            <label class="editor-playmode-option">
              <input type="radio" name="editor-playmode" id="editor-playmode-scheduled" value="scheduled" />
              Scheduled
            </label>
            <p class="editor-playmode-hint">Random interval replays this clip at a random gap instead of looping it back-to-back — good for a short, event-like sound (a creak, a bird call) inside a longer ambient mix. Scheduled instead plays it once at real-world clock times you set — a church bell at noon, an hourly chime.</p>
          </div>
          <div id="editor-crossfade-section" class="editor-crossfade">
            <label>
              <span>Loop crossfade</span>
              <input id="editor-crossfade" type="range" min="0" max="2000" value="200" step="10" />
              <span id="editor-crossfade-value" class="editor-filter-value">200 ms</span>
            </label>
            <p class="editor-crossfade-hint">Blends the seam so the loop isn't audible. Longer helps busy, textured audio (rain, crowds) — 0 disables blending. Automatically capped for very short loops.</p>
          </div>
          <div id="editor-scatter-section" class="editor-scatter-controls hidden">
            <label>
              <span>Gap (min)</span>
              <input id="editor-scatter-gap-min" type="number" min="0" max="3600" step="1" value="5" />
              <span class="editor-filter-value">s</span>
            </label>
            <label>
              <span>Gap (max)</span>
              <input id="editor-scatter-gap-max" type="number" min="0" max="3600" step="1" value="35" />
              <span class="editor-filter-value">s</span>
            </label>
            <label class="editor-scatter-check">
              <input id="editor-scatter-gap-fully-random" type="checkbox" />
              <span>Fully random gap — a new random wait (0–2&nbsp;min) before every replay; ignores the min/max above</span>
            </label>
            <label>
              <span>Pitch (min)</span>
              <input id="editor-scatter-pitch-min" type="range" min="-12" max="12" value="0" step="1" />
              <span id="editor-scatter-pitch-min-value" class="editor-filter-value">0 st</span>
            </label>
            <label>
              <span>Pitch (max)</span>
              <input id="editor-scatter-pitch-max" type="range" min="-12" max="12" value="0" step="1" />
              <span id="editor-scatter-pitch-max-value" class="editor-filter-value">0 st</span>
            </label>
            <label class="editor-scatter-check">
              <input id="editor-scatter-pitch-fully-random" type="checkbox" />
              <span>Fully random pitch — a new random shift across the whole ±12&nbsp;st range every replay; ignores the min/max above</span>
            </label>
            <label>
              <span>Volume (min)</span>
              <input id="editor-scatter-volume-min" type="range" min="0" max="100" value="100" step="1" />
              <span id="editor-scatter-volume-min-value" class="editor-filter-value">100%</span>
            </label>
            <label>
              <span>Volume (max)</span>
              <input id="editor-scatter-volume-max" type="range" min="0" max="100" value="100" step="1" />
              <span id="editor-scatter-volume-max-value" class="editor-filter-value">100%</span>
            </label>
            <label>
              <span>Fade in</span>
              <input id="editor-scatter-fade-in" type="number" min="0" max="10000" step="50" value="0" />
              <span class="editor-filter-value">ms</span>
            </label>
            <label>
              <span>Fade out</span>
              <input id="editor-scatter-fade-out" type="number" min="0" max="10000" step="50" value="0" />
              <span class="editor-filter-value">ms</span>
            </label>
            <label>
              <span>Sync group</span>
              <input id="editor-scatter-sync-group" type="text" placeholder="e.g. door-effects" />
            </label>
            <p class="editor-scatter-hint">Each replay picks a random gap, pitch, and volume within these ranges — or check "Fully random" to roll the whole range regardless of the min/max. Both pitch bounds at 0 means no pitch variation; both volume bounds at 100% means no volume variation. Fade in/out eases each shot's start/end instead of a hard cut. Give two or more scatter sounds the same sync group name to make them always fire together - one starts, all start.</p>
          </div>
          <div id="editor-schedule-section" class="editor-scatter-controls hidden">
            <label class="editor-playmode-option">
              <input type="radio" name="editor-schedule-type" id="editor-schedule-type-times" value="times" checked />
              Fixed times
            </label>
            <label class="editor-playmode-option">
              <input type="radio" name="editor-schedule-type" id="editor-schedule-type-interval" value="interval" />
              Recurring interval
            </label>
            <label id="editor-schedule-times-row">
              <span>Times (24h, comma-separated)</span>
              <input id="editor-schedule-times" type="text" inputmode="numeric" placeholder="12:00, 00:00" />
            </label>
            <label id="editor-schedule-interval-row" class="hidden">
              <span>Every</span>
              <input id="editor-schedule-interval" type="number" min="1" max="1440" step="1" value="60" />
              <span class="editor-filter-value">minutes</span>
            </label>
            <label>
              <span>Pitch (min)</span>
              <input id="editor-schedule-pitch-min" type="range" min="-12" max="12" value="0" step="1" />
              <span id="editor-schedule-pitch-min-value" class="editor-filter-value">0 st</span>
            </label>
            <label>
              <span>Pitch (max)</span>
              <input id="editor-schedule-pitch-max" type="range" min="-12" max="12" value="0" step="1" />
              <span id="editor-schedule-pitch-max-value" class="editor-filter-value">0 st</span>
            </label>
            <label class="editor-scatter-check">
              <input id="editor-schedule-pitch-fully-random" type="checkbox" />
              <span>Fully random pitch — a new random shift across the whole ±12&nbsp;st range every trigger; ignores the min/max above</span>
            </label>
            <label>
              <span>Volume (min)</span>
              <input id="editor-schedule-volume-min" type="range" min="0" max="100" value="100" step="1" />
              <span id="editor-schedule-volume-min-value" class="editor-filter-value">100%</span>
            </label>
            <label>
              <span>Volume (max)</span>
              <input id="editor-schedule-volume-max" type="range" min="0" max="100" value="100" step="1" />
              <span id="editor-schedule-volume-max-value" class="editor-filter-value">100%</span>
            </label>
            <label>
              <span>Fade in</span>
              <input id="editor-schedule-fade-in" type="number" min="0" max="10000" step="50" value="0" />
              <span class="editor-filter-value">ms</span>
            </label>
            <label>
              <span>Fade out</span>
              <input id="editor-schedule-fade-out" type="number" min="0" max="10000" step="50" value="0" />
              <span class="editor-filter-value">ms</span>
            </label>
            <p class="editor-schedule-hint">Fixed times play once at each listed clock time (24h HH:MM), every day. Recurring interval plays every N minutes, aligned to midnight — 60 lands on the hour, 30 on the hour and half-hour, like a digital clock rather than counting from whenever the app started. Each trigger picks a random pitch and volume within these ranges, same as Random Interval — or check "Fully random pitch" to roll the whole ±12 st range regardless of the min/max. Both pitch bounds at 0 means no pitch variation; both volume bounds at 100% means no volume variation. Fade in/out eases each trigger's start/end instead of a hard cut.</p>
          </div>
          <div class="editor-speed-pitch">
            <label>
              <span>Speed</span>
              <input id="editor-speed" type="range" min="50" max="200" value="100" step="5" />
              <span id="editor-speed-value" class="editor-filter-value">100%</span>
            </label>
            <label>
              <span>Pitch</span>
              <input id="editor-pitch" type="range" min="-12" max="12" value="0" step="1" />
              <span id="editor-pitch-value" class="editor-filter-value">Off</span>
            </label>
            <label class="editor-reverse-toggle">
              <input id="editor-reverse" type="checkbox" />
              Reverse
            </label>
            <p class="editor-speed-pitch-hint">Speed applies live, even for sounds too long to bake into a clip. Pitch and Reverse only take effect once saved (loops under 10 minutes) — Pitch previews approximately while dragging (briefly affects tempo too); Reverse has no live preview at all.</p>
          </div>
          <div class="editor-filters">
            <label>
              <span>High-pass</span>
              <input id="editor-highpass" type="range" min="0" max="2000" value="0" step="10" />
              <span id="editor-highpass-value" class="editor-filter-value">Off</span>
            </label>
            <label>
              <span>Low-pass</span>
              <input id="editor-lowpass" type="range" min="150" max="20000" value="20000" step="50" />
              <span id="editor-lowpass-value" class="editor-filter-value">Off</span>
            </label>
            <label>
              <span>Gain</span>
              <input id="editor-gain" type="range" min="-24" max="24" value="0" step="0.5" />
              <span id="editor-gain-value" class="editor-filter-value">0 dB</span>
            </label>
            <label>
              <span>Echo delay</span>
              <input id="editor-echo-delay" type="range" min="0" max="1500" value="0" step="10" />
              <span id="editor-echo-delay-value" class="editor-filter-value">Off</span>
            </label>
            <label>
              <span>Echo decay</span>
              <input id="editor-echo-decay" type="range" min="0" max="0.85" value="0" step="0.01" />
              <span id="editor-echo-decay-value" class="editor-filter-value">Off</span>
            </label>
            <label>
              <span>Reverb size</span>
              <input id="editor-reverb-size" type="range" min="0" max="4000" value="0" step="100" />
              <span id="editor-reverb-size-value" class="editor-filter-value">Off</span>
            </label>
            <label>
              <span>Reverb mix</span>
              <input id="editor-reverb-mix" type="range" min="0" max="1" value="0" step="0.01" />
              <span id="editor-reverb-mix-value" class="editor-filter-value">Off</span>
            </label>
          </div>
          <div class="editor-eq">
            <div class="editor-eq-header">
              <span class="editor-eq-label">Parametric EQ</span>
              <div class="editor-eq-compare" role="group" aria-label="Compare current session vs. last saved">
                <button id="editor-eq-compare-a" class="editor-eq-compare-btn editor-eq-compare-btn-active" type="button" title="Current session (editable)">A</button>
                <button id="editor-eq-compare-b" class="editor-eq-compare-btn" type="button" title="Last saved mix (read-only)">B</button>
              </div>
              <button id="editor-eq-add-band" class="btn btn-svg-icon" type="button" title="Add a band">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button id="editor-eq-remove-band" class="btn btn-svg-icon" type="button" title="Delete the selected band (or drag a node here)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg>
              </button>
              <button id="editor-eq-reset" class="btn btn-small btn-icon-text" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                Reset EQ
              </button>
            </div>
            <button id="editor-eq-revert-banner" class="editor-eq-revert-banner hidden" type="button">Click to revert to previous session's mix</button>
            <canvas id="editor-eq-canvas" width="640" height="140" title="Drag a node to adjust frequency/gain (hold Ctrl while dragging for finer control). Scroll over a node to adjust its Q. Double-click a node to reset its gain; Alt+click for a full reset."></canvas>
            <div class="editor-eq-band-controls">
              <label>
                <span>Type</span>
                <select id="editor-eq-type">
                  <option value="off">Off</option>
                  <option value="lowpass">Low Pass</option>
                  <option value="highpass">High Pass</option>
                  <option value="bandpass">Band Pass</option>
                  <option value="notch">Notch</option>
                  <option value="lowshelf">Low Shelf</option>
                  <option value="highshelf">High Shelf</option>
                  <option value="peaking" selected>Peaking</option>
                </select>
              </label>
              <label id="editor-eq-slope-label">
                <span>Slope</span>
                <select id="editor-eq-slope">
                  <option value="gentle" selected>Gentle</option>
                  <option value="steep">Steep</option>
                </select>
              </label>
              <label>
                <span>Freq</span>
                <input id="editor-eq-freq" type="number" min="20" max="20000" step="1" />
                <span class="editor-filter-value">Hz</span>
              </label>
              <label>
                <span>Gain</span>
                <input id="editor-eq-gain" type="number" min="-24" max="24" step="0.1" />
                <span class="editor-filter-value">dB</span>
              </label>
              <label>
                <span>Q</span>
                <input id="editor-eq-q" type="number" min="0.1" max="20" step="0.1" />
              </label>
              <button id="editor-eq-mute" class="editor-eq-toggle-btn" type="button" title="Mute this band (keeps its settings, just stops applying it)">Mute</button>
              <button id="editor-eq-solo" class="editor-eq-toggle-btn" type="button" title="Solo this band (hear only its effect, for auditioning while tuning)">Solo</button>
            </div>
            <p class="editor-eq-hint">Click + to add a band, drag it to shape it (hold Ctrl while dragging for finer control), or type exact values above for the selected (highlighted) band. Scroll over a node to adjust its Q. Double-click resets just its gain; Alt+click fully resets it. The trash button (or dragging a node onto it) deletes the selected band. Mute silences a band without losing its settings; Solo hears only that band while tuning. The pink spectrum shows the sound's own content and doesn't change as you drag bands; the red-shaded regions show which frequencies your current bands would actually cut.</p>
          </div>
          <div class="editor-presets">
            <span class="editor-presets-label">Presets</span>
            <button class="btn btn-small" type="button" data-preset="muffled">Muffled</button>
            <button class="btn btn-small" type="button" data-preset="phone">Over the Phone</button>
            <button class="btn btn-small" type="button" data-preset="radio">On the Radio</button>
            <button class="btn btn-small" type="button" data-preset="distant">Distant</button>
            <button class="btn btn-small" type="button" data-preset="echo">Echo</button>
            <button class="btn btn-small" type="button" data-preset="reverb">Reverb</button>
            <button class="btn btn-small" type="button" data-preset="underwater">Underwater</button>
          </div>
          <div class="editor-actions">
            <button id="editor-reset-filters" class="btn btn-icon-text" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              Reset filters
            </button>
          </div>
          <p id="editor-save-status" class="editor-save-status"></p>
        </div>
        <p id="editor-empty" class="editor-empty">Select a sound above to trim and apply filters.</p>
      </div>
      <button id="editor-scroll-top" class="editor-scroll-top-btn hidden" type="button" title="Scroll to top">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19V5"/>
          <path d="M5 12l7-7 7 7"/>
        </svg>
      </button>
      <div id="editor-leave-confirm" class="modal hidden">
        <div class="modal-card">
          <h2>Leave with unsaved changes?</h2>
          <p class="modal-hint">Whatever's changed since you opened this sound in Remix hasn't been saved - leaving now discards it.</p>
          <div class="modal-actions">
            <button id="editor-leave-confirm-dont-ask" class="btn" type="button">Don't ask again</button>
            <button id="editor-leave-confirm-no" class="btn" type="button">No</button>
            <button id="editor-leave-confirm-yes" class="btn btn-primary" type="button">Yes</button>
          </div>
        </div>
      </div>
    `

    this.els = {
      soundSearch: container.querySelector('#editor-sound-search'),
      soundOptions: container.querySelector('#editor-sound-options'),
      panel: container.querySelector('#editor-panel'),
      empty: container.querySelector('#editor-empty'),
      soundName: container.querySelector('#editor-sound-name'),
      canvas: container.querySelector('#editor-canvas'),
      scrollbarTrack: container.querySelector('#editor-scrollbar'),
      scrollbarThumb: container.querySelector('#editor-scrollbar-thumb'),
      waveformStatus: container.querySelector('#editor-waveform-status'),
      startInput: container.querySelector('#editor-start-input'),
      endInput: container.querySelector('#editor-end-input'),
      lengthInput: container.querySelector('#editor-length-input'),
      suggestLoopBtn: container.querySelector('#editor-suggest-loop'),
      suggestStatus: container.querySelector('#editor-suggest-status'),
      playModeLoop: container.querySelector('#editor-playmode-loop'),
      playModeScatter: container.querySelector('#editor-playmode-scatter'),
      playModeScheduled: container.querySelector('#editor-playmode-scheduled'),
      crossfadeSection: container.querySelector('#editor-crossfade-section'),
      crossfade: container.querySelector('#editor-crossfade'),
      crossfadeValue: container.querySelector('#editor-crossfade-value'),
      scatterSection: container.querySelector('#editor-scatter-section'),
      scatterGapMin: container.querySelector('#editor-scatter-gap-min'),
      scatterGapMax: container.querySelector('#editor-scatter-gap-max'),
      scatterGapFullyRandom: container.querySelector('#editor-scatter-gap-fully-random'),
      scatterPitchMin: container.querySelector('#editor-scatter-pitch-min'),
      scatterPitchMinValue: container.querySelector('#editor-scatter-pitch-min-value'),
      scatterPitchMax: container.querySelector('#editor-scatter-pitch-max'),
      scatterPitchMaxValue: container.querySelector('#editor-scatter-pitch-max-value'),
      scatterPitchFullyRandom: container.querySelector('#editor-scatter-pitch-fully-random'),
      scatterVolumeMin: container.querySelector('#editor-scatter-volume-min'),
      scatterVolumeMinValue: container.querySelector('#editor-scatter-volume-min-value'),
      scatterVolumeMax: container.querySelector('#editor-scatter-volume-max'),
      scatterVolumeMaxValue: container.querySelector('#editor-scatter-volume-max-value'),
      scatterFadeIn: container.querySelector('#editor-scatter-fade-in'),
      scatterFadeOut: container.querySelector('#editor-scatter-fade-out'),
      scatterSyncGroup: container.querySelector('#editor-scatter-sync-group'),
      scheduleSection: container.querySelector('#editor-schedule-section'),
      scheduleTypeTimes: container.querySelector('#editor-schedule-type-times'),
      scheduleTypeInterval: container.querySelector('#editor-schedule-type-interval'),
      scheduleTimesRow: container.querySelector('#editor-schedule-times-row'),
      scheduleTimes: container.querySelector('#editor-schedule-times'),
      scheduleIntervalRow: container.querySelector('#editor-schedule-interval-row'),
      scheduleInterval: container.querySelector('#editor-schedule-interval'),
      schedulePitchMin: container.querySelector('#editor-schedule-pitch-min'),
      schedulePitchMinValue: container.querySelector('#editor-schedule-pitch-min-value'),
      schedulePitchMax: container.querySelector('#editor-schedule-pitch-max'),
      schedulePitchMaxValue: container.querySelector('#editor-schedule-pitch-max-value'),
      schedulePitchFullyRandom: container.querySelector('#editor-schedule-pitch-fully-random'),
      scheduleVolumeMin: container.querySelector('#editor-schedule-volume-min'),
      scheduleVolumeMinValue: container.querySelector('#editor-schedule-volume-min-value'),
      scheduleVolumeMax: container.querySelector('#editor-schedule-volume-max'),
      scheduleVolumeMaxValue: container.querySelector('#editor-schedule-volume-max-value'),
      scheduleFadeIn: container.querySelector('#editor-schedule-fade-in'),
      scheduleFadeOut: container.querySelector('#editor-schedule-fade-out'),
      speed: container.querySelector('#editor-speed'),
      speedValue: container.querySelector('#editor-speed-value'),
      pitch: container.querySelector('#editor-pitch'),
      pitchValue: container.querySelector('#editor-pitch-value'),
      reverse: container.querySelector('#editor-reverse'),
      doppler: container.querySelector('#editor-doppler'),
      dopplerHint: container.querySelector('#editor-doppler-hint'),
      dopplerOptions: container.querySelector('#editor-doppler-options'),
      dopplerIntensity: container.querySelector('#editor-doppler-intensity'),
      dopplerIntensityValue: container.querySelector('#editor-doppler-intensity-value'),
      dopplerSharpness: container.querySelector('#editor-doppler-sharpness'),
      dopplerSharpnessValue: container.querySelector('#editor-doppler-sharpness-value'),
      dopplerReversed: container.querySelector('#editor-doppler-reversed'),
      highpass: container.querySelector('#editor-highpass'),
      highpassValue: container.querySelector('#editor-highpass-value'),
      lowpass: container.querySelector('#editor-lowpass'),
      lowpassValue: container.querySelector('#editor-lowpass-value'),
      gain: container.querySelector('#editor-gain'),
      gainValue: container.querySelector('#editor-gain-value'),
      echoDelay: container.querySelector('#editor-echo-delay'),
      echoDelayValue: container.querySelector('#editor-echo-delay-value'),
      echoDecay: container.querySelector('#editor-echo-decay'),
      echoDecayValue: container.querySelector('#editor-echo-decay-value'),
      reverbSize: container.querySelector('#editor-reverb-size'),
      reverbSizeValue: container.querySelector('#editor-reverb-size-value'),
      reverbMix: container.querySelector('#editor-reverb-mix'),
      reverbMixValue: container.querySelector('#editor-reverb-mix-value'),
      eqCanvas: container.querySelector('#editor-eq-canvas'),
      eqReset: container.querySelector('#editor-eq-reset'),
      eqAddBand: container.querySelector('#editor-eq-add-band'),
      eqRemoveBand: container.querySelector('#editor-eq-remove-band'),
      eqCompareA: container.querySelector('#editor-eq-compare-a'),
      eqCompareB: container.querySelector('#editor-eq-compare-b'),
      eqRevertBanner: container.querySelector('#editor-eq-revert-banner'),
      eqType: container.querySelector('#editor-eq-type'),
      eqSlope: container.querySelector('#editor-eq-slope'),
      eqSlopeLabel: container.querySelector('#editor-eq-slope-label'),
      eqFreq: container.querySelector('#editor-eq-freq'),
      eqGain: container.querySelector('#editor-eq-gain'),
      eqQ: container.querySelector('#editor-eq-q'),
      eqMute: container.querySelector('#editor-eq-mute'),
      eqSolo: container.querySelector('#editor-eq-solo'),
      resetFilters: container.querySelector('#editor-reset-filters'),
      presetButtons: container.querySelectorAll('[data-preset]'),
      saveStatus: container.querySelector('#editor-save-status'),
      scrollTop: container.querySelector('#editor-scroll-top'),
      leaveConfirmDialog: container.querySelector('#editor-leave-confirm'),
      leaveConfirmYes: container.querySelector('#editor-leave-confirm-yes'),
      leaveConfirmNo: container.querySelector('#editor-leave-confirm-no'),
      leaveConfirmDontAsk: container.querySelector('#editor-leave-confirm-dont-ask')
    }

    this.loopEditorController = createLoopEditorController(this.els.canvas)
    this.loopEditorController.onLoopChange(({ loopStart, loopEnd }) => {
      this.updateLoopTimeInputs(loopStart, loopEnd)
      this.previewSource?.setLoopPoints(loopStart, loopEnd)
      this.updateSaveButtonState()
    })
    this.loopEditorController.onScrub((t) => {
      this.previewSource?.scrubTo(t)
    })
    // Dragging (or double-click-resetting) the Doppler "closest point"
    // marker - no live preview to update (Doppler is bake-only, see
    // speedPitch's own doc comment), just the dirty-check/history hook every
    // other field-change handler already ends with.
    this.loopEditorController.onDopplerChange(() => this.updateSaveButtonState())
    // Dragging a fade handle (see waveform.js's corner pins) writes straight
    // back into whichever numeric field is currently showing (scatter vs.
    // scheduled - the two can't both be active) so the precision text
    // inputs and the visual drag stay the same single source of truth in
    // both directions, same pattern onLoopChange already sets for Start/End.
    this.loopEditorController.onFadesChange(({ fadeInSec, fadeOutSec }) => {
      const fadeInMs = Math.round(fadeInSec * 1000)
      const fadeOutMs = Math.round(fadeOutSec * 1000)
      const playMode = this.currentPlayMode()
      if (playMode === 'scatter') {
        this.els.scatterFadeIn.value = String(fadeInMs)
        this.els.scatterFadeOut.value = String(fadeOutMs)
      } else if (playMode === 'scheduled') {
        this.els.scheduleFadeIn.value = String(fadeInMs)
        this.els.scheduleFadeOut.value = String(fadeOutMs)
      }
      this.updateSaveButtonState()
    })

    this.eqEditorController = createEqEditorController(this.els.eqCanvas)
    this.eqEditorController.onChange(() => this.applyEqControls())
    // Double-click and Alt+click used to fire the identical full reset -
    // split apart after direct feedback ("double clicking shouldn't reset
    // the node completely just position. Alt clicking should be the full
    // reset"). There's no longer a canonical "default" per node to reset
    // *back to* (bands are user-added now, not a fixed preset set - see
    // library.js's defaultEqBands()), so both are redefined as "what does
    // resetting a node mean when there's nothing to reset it back to":
    // double-click resets just gainDb to 0 (the node's vertical "position"
    // on the graph, the literal reading of "just position"); Alt+click is
    // the fuller reset - gainDb:0, q:1, type back to 'peaking' - while still
    // preserving the node's own frequency, its horizontal identity, not
    // something a reset should relocate.
    this.eqEditorController.onDoubleClick((index) => {
      this.eqEditorController.setSelectedIndex(index)
      this.eqEditorController.setSelectedBand({ gainDb: 0 })
      this.applyEqControls()
    })
    this.eqEditorController.onAltClick((index) => {
      this.eqEditorController.setSelectedIndex(index)
      this.eqEditorController.setSelectedBand({ gainDb: 0, q: 1, type: 'peaking', slope: 'gentle' })
      this.applyEqControls()
    })

    this.waveformScrollbar = createWaveformScrollbar(this.els.scrollbarTrack, this.els.scrollbarThumb)
    this.waveformScrollbar.onNavigate((start, end) => this.loopEditorController.setViewport(start, end))
    this.loopEditorController.onViewportChange(({ viewStart, viewEnd, duration }) => {
      this.waveformScrollbar.update(duration, viewStart, viewEnd)
      this.maybeFetchDetailPeaks(viewStart, viewEnd, duration)
    })

    wireNameMarquee(this.els.soundName)
    this.wireControls()
    this.wireScrollTop()
    this.wireLeaveConfirmDialog()
    this.refreshLibrary().catch((err) => console.error('Editor: failed to load library', err))
  }

  // Floating "scroll to top" button, requested directly since this panel has
  // grown long (waveform, times, playmode, crossfade/scatter, speed/pitch,
  // filters, 7-band EQ, presets) - a real trip back to the top otherwise
  // needs a lot of manual scrolling. #tab-content is the *shared* scroll
  // container every tab's panel lives inside (see main.css's `main {
  // overflow-y: auto }`) - only the active tab's own <section> is ever
  // visible at a time (TabHost.js toggles a hidden class on the rest), so
  // this button - appended inside Remix's own panel markup - automatically
  // hides itself whenever a different tab is active, the same way the rest
  // of this tab's content already does, with zero extra onShow/onHide
  // bookkeeping needed just for that.
  wireScrollTop() {
    const scrollContainer = document.getElementById('tab-content')
    const THRESHOLD_PX = 300
    const updateVisibility = () => {
      this.els.scrollTop.classList.toggle('hidden', scrollContainer.scrollTop < THRESHOLD_PX)
    }
    scrollContainer.addEventListener('scroll', updateVisibility)
    this.els.scrollTop.addEventListener('click', () => {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
    })
    // Re-syncs on every tab switch back to Remix - the shared container's
    // scrollTop reflects whatever the previously-active tab's content left
    // it at, not necessarily anything meaningful for this tab's own layout.
    this._syncScrollTopVisibility = updateVisibility
    updateVisibility()
  }

  wireControls() {
    this.els.soundSearch.addEventListener('focus', () => this.openPicker())

    this.els.soundSearch.addEventListener('input', () => {
      this.pickerQuery = this.els.soundSearch.value
      this.pickerHighlightIndex = -1
      this.openPicker()
    })

    this.els.soundSearch.addEventListener('keydown', (evt) => {
      const options = this.filteredPickerSounds()
      if (evt.key === 'ArrowDown') {
        evt.preventDefault()
        if (options.length === 0) return
        this.pickerHighlightIndex = (this.pickerHighlightIndex + 1) % options.length
        this.renderPickerOptions()
      } else if (evt.key === 'ArrowUp') {
        evt.preventDefault()
        if (options.length === 0) return
        this.pickerHighlightIndex = (this.pickerHighlightIndex - 1 + options.length) % options.length
        this.renderPickerOptions()
      } else if (evt.key === 'Enter') {
        evt.preventDefault()
        // Defaults to the first result when nothing's been arrow-navigated
        // yet - requested directly: typing a precise search and hitting
        // Enter shouldn't need an extra arrow-down first, since a precise
        // query usually narrows straight down to the one sound you meant.
        const picked = options[this.pickerHighlightIndex] ?? options[0]
        if (picked) this.selectPickerSound(picked.id)
      } else if (evt.key === 'Escape') {
        this.closePicker()
        this.els.soundSearch.blur()
      }
    })

    // The option list's own mousedown handlers call preventDefault() (see
    // renderPickerOptions), which stops the input from ever losing focus on
    // an option click - so a plain blur here always means the user actually
    // clicked/tabbed away, never a false positive from picking an option.
    this.els.soundSearch.addEventListener('blur', () => this.closePicker())

    this.els.startInput.addEventListener('change', () => this.applyManualLoopPoints())
    this.els.endInput.addEventListener('change', () => this.applyManualLoopPoints())
    this.els.lengthInput.addEventListener('change', () => this.applyManualLength())
    this.els.suggestLoopBtn.addEventListener('click', () => this.suggestLoopPoint())

    this.els.playModeLoop.addEventListener('change', () => this.applyPlayModeControl())
    this.els.playModeScatter.addEventListener('change', () => this.applyPlayModeControl())
    this.els.playModeScheduled.addEventListener('change', () => this.applyPlayModeControl())
    this.els.scatterGapMin.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterGapMax.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterGapFullyRandom.addEventListener('change', () => this.applyScatterControls())
    this.els.scatterPitchMin.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterPitchMax.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterPitchFullyRandom.addEventListener('change', () => this.applyScatterControls())
    this.els.scatterVolumeMin.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterVolumeMax.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterFadeIn.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterFadeOut.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterSyncGroup.addEventListener('input', () => this.applyScatterControls())

    this.els.scheduleTypeTimes.addEventListener('change', () => this.applyScheduleControls())
    this.els.scheduleTypeInterval.addEventListener('change', () => this.applyScheduleControls())
    this.els.scheduleTimes.addEventListener('input', () => this.applyScheduleControls())
    this.els.scheduleInterval.addEventListener('input', () => this.applyScheduleControls())
    this.els.schedulePitchMin.addEventListener('input', () => this.applyScheduleControls())
    this.els.schedulePitchMax.addEventListener('input', () => this.applyScheduleControls())
    this.els.schedulePitchFullyRandom.addEventListener('change', () => this.applyScheduleControls())
    this.els.scheduleVolumeMin.addEventListener('input', () => this.applyScheduleControls())
    this.els.scheduleVolumeMax.addEventListener('input', () => this.applyScheduleControls())
    this.els.scheduleFadeIn.addEventListener('input', () => this.applyScheduleControls())
    this.els.scheduleFadeOut.addEventListener('input', () => this.applyScheduleControls())

    this.els.crossfade.addEventListener('input', () => this.applyCrossfadeControl())

    this.els.speed.addEventListener('input', () => this.applySpeedPitchControls())
    this.els.pitch.addEventListener('input', () => this.applySpeedPitchControls())
    this.els.reverse.addEventListener('change', () => this.applySpeedPitchControls())
    this.els.doppler.addEventListener('change', () => this.applySpeedPitchControls())
    this.els.dopplerIntensity.addEventListener('input', () => this.applySpeedPitchControls())
    this.els.dopplerSharpness.addEventListener('input', () => this.applySpeedPitchControls())
    this.els.dopplerReversed.addEventListener('change', () => this.applySpeedPitchControls())

    this.els.highpass.addEventListener('input', () => this.applyFilterControls())
    this.els.lowpass.addEventListener('input', () => this.applyFilterControls())
    this.els.gain.addEventListener('input', () => this.applyFilterControls())
    this.els.echoDelay.addEventListener('input', () => this.applyFilterControls())
    this.els.echoDecay.addEventListener('input', () => this.applyFilterControls())
    this.els.reverbSize.addEventListener('input', () => this.applyFilterControls())
    this.els.reverbMix.addEventListener('input', () => this.applyFilterControls())

    // 'input' (fires live, on every change) not 'change' (fires only on
    // blur/Enter) - matches every other numeric field in this app (Scatter
    // gap min/max, the core filter sliders). BUG FIX: these three were the
    // one place still using 'change', which meant the app-wide number-box
    // stepper (hover+scroll/arrow keys, see numberBoxStepper.js - it
    // dispatches 'input') silently never reached these fields at all -
    // adjusting Freq/Gain/Q via scroll or arrow keys updated the input's
    // raw displayed value but never touched the actual band, the node's
    // position on the graph, or the live audio, exactly matching a direct
    // bug report ("raising the frequency by the number doesn't change the
    // node's position and doesn't affect the audio").
    this.els.eqType.addEventListener('change', () => this.applyEqFieldsToSelectedBand())
    this.els.eqSlope.addEventListener('change', () => this.applyEqFieldsToSelectedBand())
    this.els.eqFreq.addEventListener('input', () => this.applyEqFieldsToSelectedBand())
    this.els.eqGain.addEventListener('input', () => this.applyEqFieldsToSelectedBand())
    this.els.eqQ.addEventListener('input', () => this.applyEqFieldsToSelectedBand())
    this.els.eqReset.addEventListener('click', () => {
      this.eqEditorController.load(defaultEqBands())
      this.updateEqFieldsFromSelection()
      this.applyEqControls()
    })

    this.els.eqAddBand.addEventListener('click', () => {
      this.eqEditorController.addBand()
      this.updateEqFieldsFromSelection()
      this.applyEqControls()
    })
    this.els.eqRemoveBand.addEventListener('click', () => {
      this.eqEditorController.removeSelectedBand()
      this.updateEqFieldsFromSelection()
      this.applyEqControls()
    })
    // Registers the trash button as a drag-and-drop target too - dragging a
    // node onto it deletes it, same as clicking it with a band selected
    // (see EqEditor.js's pointerUp).
    this.eqEditorController.setTrashDropTarget(this.els.eqRemoveBand)

    this.els.eqCompareA.addEventListener('click', () => this.switchEqCompareView('A'))
    this.els.eqCompareB.addEventListener('click', () => this.switchEqCompareView('B'))
    this.els.eqRevertBanner.addEventListener('click', () => this.revertEqToSaved())

    this.els.eqMute.addEventListener('click', () => {
      const idx = this.eqEditorController.getSelectedIndex()
      const band = this.eqEditorController.getBands()[idx]
      if (!band) return
      this.eqEditorController.setSelectedBand({ muted: !band.muted })
      this.applyEqControls()
    })

    // Toggle: clicking Solo on the already-soloed band un-solos it (back to
    // "every band plays normally"), clicking it on a different band moves
    // solo there instead - only one band can be soloed at a time.
    this.els.eqSolo.addEventListener('click', () => {
      const idx = this.eqEditorController.getSelectedIndex()
      if (idx === -1) return
      const current = this.eqEditorController.getSoloIndex()
      this.eqEditorController.setSoloIndex(current === idx ? -1 : idx)
      this.applyEqControls()
    })

    this.els.resetFilters.addEventListener('click', () => {
      this.setFilterSliders(NEUTRAL_FILTERS)
      this.applyFilterControls()
    })

    for (const button of this.els.presetButtons) {
      button.addEventListener('click', () => {
        const preset = FILTER_PRESETS[button.dataset.preset]
        if (!preset) return
        this.setFilterSliders(preset)
        this.applyFilterControls()
      })
    }
  }

  // Builds the sticky bar's own contents - Play/Pause, the loop toggle, a
  // progress bar/time readout for the trim preview, and Save (moved here
  // from the bottom of the scrollable panel per direct feedback: "It's
  // annoying just changing something on the top of the tab and then having
  // to scroll right to the end just to save") - kept separate from
  // wireControls() above because it's mounted into a different container
  // (the shared #tab-sticky-bar, see TabHost.js's mountSticky), not the
  // scrollable panel body. Only ever called once, same lazy-mount-once
  // lifecycle mount() itself already has.
  mountSticky(container) {
    container.innerHTML = `
      <button id="editor-play-pause" class="btn btn-svg-icon" type="button" title="Play">${PLAY_ICON_SVG}</button>
      <button id="editor-loop-toggle" class="editor-loop-icon-btn editor-loop-icon-btn-active" type="button" title="Loop preview" aria-pressed="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 1l4 4-4 4"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <path d="M7 23l-4-4 4-4"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      </button>
      <div id="editor-sticky-progress" class="editor-sticky-progress" title="Drag to seek">
        <div class="editor-sticky-progress-track">
          <div id="editor-sticky-progress-fill" class="editor-sticky-progress-fill"></div>
        </div>
        <div id="editor-sticky-progress-thumb" class="editor-sticky-progress-thumb"></div>
      </div>
      <span id="editor-sticky-time" class="editor-sticky-time">0:00 / 0:00</span>
      <input id="editor-sticky-volume" type="range" min="0" max="100" value="${Math.round(this.previewVolume * 100)}" class="editor-sticky-volume" title="Preview volume" />
      <button id="editor-sticky-mute" class="btn btn-svg-icon" type="button" title="Mute">${VOLUME_ICON_SVG}</button>
      <button id="editor-sticky-solo" class="editor-sticky-solo" type="button" title="Solo: mute every other sound already playing in the Mixer while you audition this one">Solo</button>
      <button id="editor-undo" class="btn btn-svg-icon" type="button" title="Undo (Ctrl+Z)" disabled>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
      <button id="editor-redo" class="btn btn-svg-icon" type="button" title="Redo (Ctrl+Shift+Z)" disabled>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-9.36 2.13L23 10"/></svg>
      </button>
      <button id="editor-cancel" class="btn btn-icon-text" type="button" title="Discard every change made since this sound was opened in Remix">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        Cancel
      </button>
      <button id="editor-save" class="btn btn-primary btn-icon-text editor-sticky-save" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        <span id="editor-save-label">Save</span>
      </button>
      <button id="editor-save-as-copy" class="btn btn-icon-text" type="button" title="Trim out just this segment and save it as a brand-new sound, without touching this one's own saved trim - for cutting several segments out of one longer recording">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        Save as copy
      </button>
    `

    this.els.playPause = container.querySelector('#editor-play-pause')
    this.els.loopToggle = container.querySelector('#editor-loop-toggle')
    this.els.stickyProgress = container.querySelector('#editor-sticky-progress')
    this.els.stickyProgressFill = container.querySelector('#editor-sticky-progress-fill')
    this.els.stickyProgressThumb = container.querySelector('#editor-sticky-progress-thumb')
    this.els.stickyTime = container.querySelector('#editor-sticky-time')
    this.wireStickyProgressDrag()
    this.els.stickyVolume = container.querySelector('#editor-sticky-volume')
    this.els.stickyMute = container.querySelector('#editor-sticky-mute')
    this.els.stickySolo = container.querySelector('#editor-sticky-solo')
    this.els.undo = container.querySelector('#editor-undo')
    this.els.redo = container.querySelector('#editor-redo')
    this.els.cancel = container.querySelector('#editor-cancel')
    this.els.undo.addEventListener('click', () => this.undo())
    this.els.redo.addEventListener('click', () => this.redo())
    this.els.cancel.addEventListener('click', () => this.cancelEdits())
    this.els.save = container.querySelector('#editor-save')
    this.els.saveLabel = container.querySelector('#editor-save-label')
    this.els.save.addEventListener('click', () => this.save().catch((err) => console.error('Editor: save failed', err)))
    this.els.saveAsCopy = container.querySelector('#editor-save-as-copy')
    this.els.saveAsCopy.addEventListener('click', () => this.saveAsCopy().catch((err) => console.error('Editor: save as copy failed', err)))

    this.els.playPause.addEventListener('click', async () => {
      if (!this.previewSource) return
      if (this.previewSource.playing) {
        this.previewSource.pause()
        this.stopPreviewTicking()
        this.setPlayPauseIcon(false)
        this.eqEditorController.clearSpectrum()
      } else {
        try {
          await this.engine.resume()
          await this.previewSource.play()
          this.setPlayPauseIcon(true)
          this.tickPreviewPlayhead()
        } catch (err) {
          console.error('Failed to preview sound', err)
        }
      }
    })

    this.els.loopToggle.addEventListener('click', () => {
      this.looping = !this.looping
      this.updateLoopToggleVisual()
      this.previewSource?.setLooping(this.looping)
    })

    // Persists across sounds within the tab session, same as looping above -
    // a preview-workflow preference, not per-sound saved state (unrelated to
    // the per-sound volume slider in the Mixer, which *is* saved).
    this.els.stickyVolume.addEventListener('input', () => {
      this.previewVolume = Number(this.els.stickyVolume.value) / 100
      // Dragging the slider while muted implicitly unmutes - same
      // convention the Mixer's volume sliders use.
      if (this.previewMuted) {
        this.previewMuted = false
        this.updatePreviewMuteIcon()
      }
      this.previewSource?.setVolume(this.effectivePreviewVolume())
    })

    this.els.stickyMute.addEventListener('click', () => {
      this.previewMuted = !this.previewMuted
      this.updatePreviewMuteIcon()
      this.previewSource?.setVolume(this.effectivePreviewVolume())
    })

    this.els.stickySolo.addEventListener('click', () => this.toggleSolo())
    this.updatePreviewMuteIcon()
  }

  effectivePreviewVolume() {
    return this.previewMuted ? 0 : this.previewVolume
  }

  updatePreviewMuteIcon() {
    this.els.stickyMute.innerHTML = this.previewMuted ? MUTE_ICON_SVG : VOLUME_ICON_SVG
    this.els.stickyMute.title = this.previewMuted ? 'Unmute' : 'Mute'
    this.els.stickyMute.classList.toggle('btn-svg-icon-active', this.previewMuted)
  }

  updateLoopToggleVisual() {
    this.els.loopToggle.classList.toggle('editor-loop-icon-btn-active', this.looping)
    this.els.loopToggle.setAttribute('aria-pressed', String(this.looping))
  }

  // Core's Mixer has no direct access to this plugin's state (or vice
  // versa) - plugins only get the curated window.noctivago IPC surface, and
  // mute is deliberately session-only/unpersisted, so there's no library
  // data to round-trip through either. A plain window CustomEvent is the
  // simplest bridge that doesn't require either side to import the other;
  // see tabs/mixer/index.js's own 'noctivago:remix-solo' listener.
  toggleSolo() {
    if (!this.currentEntry) return
    this.setSolo(!this.soloActive)
  }

  setSolo(active) {
    if (this.soloActive === active) return
    this.soloActive = active
    this.els.stickySolo?.classList.toggle('editor-sticky-solo-active', active)
    if (this.currentEntry) {
      window.dispatchEvent(new CustomEvent('noctivago:solo', { detail: { soundId: this.currentEntry.id, active } }))
    }
  }

  setPlayPauseIcon(playing) {
    if (!this.els.playPause) return
    this.els.playPause.innerHTML = playing ? PAUSE_ICON_SVG : PLAY_ICON_SVG
    this.els.playPause.title = playing ? 'Pause' : 'Play'
  }

  async refreshLibrary() {
    this.library = await this.api.library.list()
    if (this.currentEntry) {
      const updated = this.editableSounds().find((s) => s.id === this.currentEntry.id)
      // Don't stomp on text the user is actively typing to search.
      if (updated && document.activeElement !== this.els.soundSearch) this.setSearchValue(updated.name)
      else if (!updated) this.els.soundSearch.value = ''
    }
    if (!this.els.soundOptions.classList.contains('hidden')) this.renderPickerOptions()
  }

  editableSounds() {
    return this.library.filter((s) => s.status !== 'missing')
  }

  filteredPickerSounds() {
    const query = this.pickerQuery.trim().toLowerCase()
    const editable = this.editableSounds()
    if (!query) return editable
    return editable.filter((s) => s.name.toLowerCase().includes(query))
  }

  openPicker() {
    this.pickerHighlightIndex = -1
    this.renderPickerOptions()
    this.els.soundOptions.classList.remove('hidden')
  }

  closePicker() {
    this.els.soundOptions.classList.add('hidden')
  }

  renderPickerOptions() {
    const options = this.filteredPickerSounds()
    this.els.soundOptions.innerHTML = ''

    // Mirrors the old native <select>'s always-present blank option - lets
    // the user explicitly go back to "nothing selected" instead of only
    // ever switching between sounds. Only shown before the user's typed a
    // search, so it doesn't get in the way of narrowing results down.
    if (this.currentEntry && !this.pickerQuery.trim()) {
      const clear = document.createElement('li')
      clear.className = 'editor-sound-option editor-sound-option-clear'
      clear.textContent = 'Select a sound to edit…'
      clear.addEventListener('mousedown', (evt) => {
        evt.preventDefault()
        this.clearPickerSelection()
      })
      this.els.soundOptions.appendChild(clear)
    }

    if (options.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'editor-sound-option-empty'
      empty.textContent = 'No sounds match.'
      this.els.soundOptions.appendChild(empty)
      return
    }

    options.forEach((entry, index) => {
      const li = document.createElement('li')
      li.className = 'editor-sound-option' + (index === this.pickerHighlightIndex ? ' editor-sound-option-highlighted' : '')
      li.textContent = entry.name
      li.title = entry.name
      // mousedown + preventDefault, not click - stops the input from
      // blurring (and therefore closePicker() from firing) before this
      // handler runs, which would otherwise remove the option out from
      // under the click.
      li.addEventListener('mousedown', (evt) => {
        evt.preventDefault()
        this.selectPickerSound(entry.id)
      })
      this.els.soundOptions.appendChild(li)
    })
  }

  // Show a picked/loaded sound's name in the search box left-aligned (so a
  // name too long for the field shows its start, not its tail) with the full
  // name on hover.
  setSearchValue(name) {
    const input = this.els.soundSearch
    input.value = name
    input.title = name
    input.setSelectionRange(0, 0)
    input.scrollLeft = 0
  }

  selectPickerSound(id) {
    const entry = this.editableSounds().find((s) => s.id === id)
    if (!entry) return
    this.setSearchValue(entry.name)
    this.pickerQuery = ''
    this.closePicker()
    this.loadSound(id).catch((err) => console.error('Editor: failed to load sound', err))
  }

  clearPickerSelection() {
    this.els.soundSearch.value = ''
    this.els.soundSearch.title = ''
    this.pickerQuery = ''
    this.closePicker()
    this.showEmpty()
  }

  showEmpty() {
    this.currentEntry = null
    this.disposePreview()
    this.els.panel.classList.add('hidden')
    this.els.empty.classList.remove('hidden')
    clearTimeout(this._historyCommitTimer)
    this.historyStack = []
    this.historyIndex = -1
    this.updateUndoRedoButtonsUI()
  }

  updateLoopTimeInputs(loopStart, loopEnd) {
    this.els.startInput.value = formatDuration(loopStart)
    this.els.endInput.value = formatDuration(loopEnd)
    this.els.lengthInput.value = formatDuration(loopEnd - loopStart)
  }

  applyManualLoopPoints() {
    if (!this.loopEditorController) return
    const start = parseDuration(this.els.startInput.value)
    const end = parseDuration(this.els.endInput.value)
    if (start == null || end == null) return
    this.loopEditorController.setLoopPoints(start, end)
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    this.updateLoopTimeInputs(loopStart, loopEnd)
    this.updateSaveButtonState()
  }

  // Resizes the region from its current Start (a fixed anchor), rather than
  // e.g. keeping it centered - matches Start/End's own "type an exact
  // value" mental model, just parameterized by length instead of an
  // endpoint. Clamped to the waveform's own duration the same way
  // LoopEditor.setLoopPoints already clamps any external call.
  applyManualLength() {
    if (!this.loopEditorController) return
    const length = parseDuration(this.els.lengthInput.value)
    if (length == null || length <= 0) return
    const { loopStart } = this.loopEditorController.getLoopPoints()
    this.loopEditorController.setLoopPoints(loopStart, loopStart + length)
    const updated = this.loopEditorController.getLoopPoints()
    this.updateLoopTimeInputs(updated.loopStart, updated.loopEnd)
    this.updateSaveButtonState()
  }

  // "Suggest a loop point" - a real ffmpeg-backed analysis pass in the main
  // process (src/main/ffmpeg/loopSuggest.js: energy-envelope seam matching),
  // so this is an async round-trip that can take a second or two on a long
  // file. Analysis-only: it just populates Start/End (same path a manual
  // edit takes, so Save/undo pick it up), never bakes or renders anything.
  async suggestLoopPoint() {
    if (!this.currentEntry || !this.loopEditorController) return
    const id = this.currentEntry.id
    this.els.suggestLoopBtn.disabled = true
    this.els.suggestStatus.textContent = 'Analyzing…'
    let result
    try {
      result = await this.api.audio.suggestLoopPoints(id)
    } catch (err) {
      console.error('Editor: loop-point suggestion failed', err)
      result = { ok: false }
    }
    if (this.currentEntry?.id !== id) return // switched sounds mid-analysis
    this.els.suggestLoopBtn.disabled = false

    if (!result || !result.ok) {
      this.els.suggestStatus.textContent = "Couldn't analyze this file."
      return
    }
    if (result.wholeFile) {
      this.els.suggestStatus.textContent = 'This file is short enough to loop as-is.'
      return
    }

    this.loopEditorController.setLoopPoints(result.loopStart, result.loopEnd)
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    this.updateLoopTimeInputs(loopStart, loopEnd)
    this.updateSaveButtonState()
    this.els.suggestStatus.textContent = `Suggested ${formatDuration(loopEnd - loopStart)} loop — adjust if needed, then Save.`
  }

  // Shared by Reset filters and every preset button, both of which just set
  // all five slider values from a filters object before re-applying. Presets
  // (see FILTER_PRESETS) don't define .eq at all - the EQ graph is a
  // separate, more precise tool than a one-click coloration preset, so a
  // preset click deliberately leaves it untouched; only an explicit
  // filters.eq (Reset filters' NEUTRAL_FILTERS, or a loaded sound's own
  // saved bands) actually replaces it.
  setFilterSliders(filters) {
    this.els.highpass.value = String(filters.highpassHz)
    this.els.lowpass.value = String(filters.lowpassHz)
    this.els.gain.value = String(filters.gainDb)
    this.els.echoDelay.value = String(filters.echoDelayMs ?? 0)
    this.els.echoDecay.value = String(filters.echoDecay ?? 0)
    this.els.reverbSize.value = String(filters.reverbSizeMs ?? 0)
    this.els.reverbMix.value = String(filters.reverbMix ?? 0)
    if (filters.eq) {
      this.eqEditorController.load(filters.eq)
      this.updateEqFieldsFromSelection()
    }
  }

  currentFilters() {
    return {
      highpassHz: Number(this.els.highpass.value),
      lowpassHz: Number(this.els.lowpass.value),
      gainDb: Number(this.els.gain.value),
      echoDelayMs: Number(this.els.echoDelay.value),
      echoDecay: Number(this.els.echoDecay.value),
      reverbSizeMs: Number(this.els.reverbSize.value),
      reverbMix: Number(this.els.reverbMix.value),
      eq: this.eqEditorController.getBands()
    }
  }

  // What the *live preview* should actually hear, distinct from
  // currentFilters() (the real, saved-and-savable state) - a soloed band
  // bypasses every other band for the preview only, without touching their
  // real .muted values, since Solo is an audition aid that's never part of
  // what gets persisted or baked. The soloed band itself is force-unmuted so
  // soloing still lets you hear it even if it happens to be muted for real.
  previewFilters() {
    const filters = this.currentFilters()
    const soloIndex = this.eqEditorController.getSoloIndex()
    if (soloIndex === -1) return filters
    return {
      ...filters,
      eq: filters.eq.map((band, i) => ({ ...band, muted: i !== soloIndex }))
    }
  }

  // Reflects the EQ editor's currently-selected node in the precision-entry
  // fields (see EqEditor.js's setSelectedBand for the reverse direction) -
  // called whenever the selection or its values change, whatever the source
  // (a drag, a wheel Q adjustment, a fresh load, or Reset EQ).
  updateEqFieldsFromSelection() {
    const bands = this.eqEditorController.getBands()
    const index = this.eqEditorController.getSelectedIndex()
    const band = bands[index]
    // Nothing selected - either a blank EQ, or a band was just deleted
    // (which always clears selection, see EqEditor.js's removeSelectedBand).
    // Disable the precision fields entirely rather than leaving them
    // showing a stale, no-longer-meaningful value from whatever was
    // previously selected. `disabled` (below) additionally locks the fields
    // while viewing the read-only B (last saved) reference - "just a display
    // for the user" - but `hasSelection` alone still governs whether they
    // show B's real values or blank, so a selected B band reads as a real,
    // inspectable (if uneditable) value rather than going blank.
    const readOnly = this.eqEditorController.isReadOnly()
    const hasSelection = Boolean(band)
    const disabled = readOnly || !hasSelection
    this.els.eqType.disabled = disabled
    this.els.eqFreq.disabled = disabled
    this.els.eqGain.disabled = disabled
    this.els.eqQ.disabled = disabled
    this.els.eqMute.disabled = disabled
    this.els.eqSolo.disabled = disabled
    this.els.eqRemoveBand.disabled = disabled
    this.els.eqAddBand.disabled = readOnly
    if (!hasSelection) {
      this.els.eqType.value = 'peaking'
      this.els.eqFreq.value = ''
      this.els.eqGain.value = ''
      this.els.eqQ.value = ''
      this.els.eqSlope.value = 'gentle'
      this.els.eqSlope.disabled = true
      this.els.eqSlopeLabel.classList.add('hidden')
      this.els.eqMute.classList.remove('editor-eq-mute-active')
      this.els.eqSolo.classList.remove('editor-eq-solo-active')
      return
    }
    this.els.eqType.value = band.type ?? 'peaking'
    this.els.eqFreq.value = String(Math.round(band.freqHz))
    this.els.eqGain.value = String(band.gainDb)
    this.els.eqQ.value = String(band.q)
    // Slope only means anything for the four filter-*shaped* types (a
    // rolloff steepness) - peaking/shelf bands are gain-shaped, not
    // rolloff-shaped, and 'off' does nothing at all, so the control hides
    // entirely rather than showing a value with no real effect.
    const slopeCapable = SLOPE_CAPABLE_EQ_TYPES.includes(band.type)
    this.els.eqSlope.value = band.slope ?? 'gentle'
    this.els.eqSlope.disabled = disabled || !slopeCapable
    this.els.eqSlopeLabel.classList.toggle('hidden', !slopeCapable)
    this.els.eqMute.classList.toggle('editor-eq-mute-active', Boolean(band.muted))
    this.els.eqSolo.classList.toggle('editor-eq-solo-active', this.eqEditorController.getSoloIndex() === index)
  }

  applyEqFieldsToSelectedBand() {
    const type = this.els.eqType.value
    const slope = this.els.eqSlope.value
    const freqHz = Math.min(20000, Math.max(20, Number(this.els.eqFreq.value)))
    const gainDb = Math.min(24, Math.max(-24, Number(this.els.eqGain.value)))
    const q = Math.min(Q_MAX, Math.max(Q_MIN, Number(this.els.eqQ.value)))
    this.eqEditorController.setSelectedBand({ type, slope, freqHz, gainDb, q })
    this.applyEqControls()
  }

  // Fires on every EQ graph change (drag, wheel Q) and every precision-field
  // edit - same live-preview + dirty-state pattern as applyFilterControls,
  // since EQ is just another part of the same filters bag now.
  applyEqControls() {
    this.updateEqFieldsFromSelection()
    this.previewSource?.setFilters(this.previewFilters())
    this.updateSaveButtonState()
    this.updateEqRevertBannerVisibility()
  }

  // True whenever the live EQ bands (A) differ from the immutable saved
  // snapshot (B) - a plain JSON comparison, same technique the dirty-check
  // elsewhere in this file already uses, just scoped to EQ only.
  eqDiffersFromSaved() {
    if (!this.eqEditorController) return false
    return JSON.stringify(this.eqEditorController.getBands()) !== JSON.stringify(this.savedEqSnapshot)
  }

  // The revert prompt only makes sense while actively editing (viewing A)
  // and only when there's actually something to discard - showing an
  // actionable "revert" banner when A already matches B would be confusing.
  updateEqRevertBannerVisibility() {
    const show = this.eqCompareViewing === 'A' && this.eqDiffersFromSaved()
    this.els.eqRevertBanner.classList.toggle('hidden', !show)
  }

  // Switches which side of the compare is being viewed. B is a read-only
  // reference (see EqEditorController.setReadOnly) - switching to it stashes
  // A's live bands so editing can resume exactly where it left off when
  // switching back, rather than losing in-progress work.
  switchEqCompareView(target) {
    if (target === this.eqCompareViewing || !this.eqEditorController) return
    if (target === 'B') {
      this.eqLiveBandsStash = this.eqEditorController.getBands()
      this.eqEditorController.load(this.savedEqSnapshot.map((b) => ({ ...b })))
    } else {
      this.eqEditorController.load((this.eqLiveBandsStash ?? this.eqEditorController.getBands()).map((b) => ({ ...b })))
      this.eqLiveBandsStash = null
    }
    this.eqCompareViewing = target
    this.eqEditorController.setReadOnly(target === 'B')
    this.updateEqFieldsFromSelection()
    this.applyEqControls()
    this.updateEqCompareButtonsUI()
  }

  updateEqCompareButtonsUI() {
    this.els.eqCompareA.classList.toggle('editor-eq-compare-btn-active', this.eqCompareViewing === 'A')
    this.els.eqCompareB.classList.toggle('editor-eq-compare-btn-active', this.eqCompareViewing === 'B')
  }

  // The revert banner's action: discards every unsaved EQ edit, replacing
  // the live (A) bands with an exact copy of the saved (B) snapshot -
  // switches back to viewing A first if B was on screen, since after this
  // there's nothing left to distinguish them anyway.
  revertEqToSaved() {
    if (!this.eqEditorController) return
    this.eqLiveBandsStash = null
    this.eqCompareViewing = 'A'
    this.eqEditorController.setReadOnly(false)
    this.eqEditorController.load(this.savedEqSnapshot.map((b) => ({ ...b })))
    this.updateEqFieldsFromSelection()
    this.applyEqControls()
    this.updateEqCompareButtonsUI()
  }

  // Resets compare state for a freshly loaded sound - A/B is a per-editing-
  // session workflow aid, not something that should carry over between
  // sounds. savedEqSnapshot itself is captured separately in loadSound()
  // (needs the just-loaded entry's own filters.eq, not available here).
  resetEqCompare() {
    this.eqCompareViewing = 'A'
    this.eqLiveBandsStash = null
    this.eqEditorController?.setReadOnly(false)
    this.updateEqCompareButtonsUI()
    this.updateEqRevertBannerVisibility()
  }

  updateFilterLabels(filters) {
    this.els.highpassValue.textContent = filters.highpassHz > 0 ? `${filters.highpassHz} Hz` : 'Off'
    this.els.lowpassValue.textContent = filters.lowpassHz < 20000 ? `${filters.lowpassHz} Hz` : 'Off'
    this.els.gainValue.textContent = `${filters.gainDb > 0 ? '+' : ''}${filters.gainDb} dB`
    this.els.echoDelayValue.textContent = filters.echoDelayMs > 0 ? `${filters.echoDelayMs} ms` : 'Off'
    this.els.echoDecayValue.textContent = filters.echoDecay > 0 ? filters.echoDecay.toFixed(2) : 'Off'
    this.els.reverbSizeValue.textContent = filters.reverbSizeMs > 0 ? `${(filters.reverbSizeMs / 1000).toFixed(1)}s` : 'Off'
    this.els.reverbMixValue.textContent = filters.reverbMix > 0 ? `${Math.round(filters.reverbMix * 100)}%` : 'Off'
  }

  applyFilterControls() {
    const filters = this.currentFilters()
    this.updateFilterLabels(filters)
    this.previewSource?.setFilters(this.previewFilters())
    this.updateSaveButtonState()
  }

  currentCrossfadeMs() {
    return Number(this.els.crossfade.value)
  }

  updateCrossfadeLabel(ms) {
    this.els.crossfadeValue.textContent = ms > 0 ? `${ms} ms` : 'Off'
  }

  applyCrossfadeControl() {
    const ms = this.currentCrossfadeMs()
    this.updateCrossfadeLabel(ms)
    this.previewSource?.setCrossfadeSeconds(ms / 1000)
    this.updateSaveButtonState()
  }

  currentPlayMode() {
    if (this.els.playModeScatter.checked) return 'scatter'
    if (this.els.playModeScheduled.checked) return 'scheduled'
    return 'loop'
  }

  setPlayModeControls(playMode) {
    this.els.playModeLoop.checked = playMode !== 'scatter' && playMode !== 'scheduled'
    this.els.playModeScatter.checked = playMode === 'scatter'
    this.els.playModeScheduled.checked = playMode === 'scheduled'
    this.els.crossfadeSection.classList.toggle('hidden', playMode === 'scatter' || playMode === 'scheduled')
    this.els.scatterSection.classList.toggle('hidden', playMode !== 'scatter')
    this.els.scheduleSection.classList.toggle('hidden', playMode !== 'scheduled')
  }

  currentScatterConfig() {
    return {
      minGapSeconds: Number(this.els.scatterGapMin.value),
      maxGapSeconds: Number(this.els.scatterGapMax.value),
      gapFullyRandom: this.els.scatterGapFullyRandom.checked,
      minPitchSemitones: Number(this.els.scatterPitchMin.value),
      maxPitchSemitones: Number(this.els.scatterPitchMax.value),
      pitchFullyRandom: this.els.scatterPitchFullyRandom.checked,
      minVolume: Number(this.els.scatterVolumeMin.value) / 100,
      maxVolume: Number(this.els.scatterVolumeMax.value) / 100,
      fadeInMs: Number(this.els.scatterFadeIn.value),
      fadeOutMs: Number(this.els.scatterFadeOut.value),
      syncGroup: this.els.scatterSyncGroup.value.trim()
    }
  }

  setScatterControls({
    minGapSeconds = 5,
    maxGapSeconds = 35,
    gapFullyRandom = false,
    minPitchSemitones = 0,
    maxPitchSemitones = 0,
    pitchFullyRandom = false,
    minVolume = 1,
    maxVolume = 1,
    fadeInMs = 0,
    fadeOutMs = 0,
    syncGroup = ''
  }) {
    this.els.scatterGapMin.value = String(minGapSeconds)
    this.els.scatterGapMax.value = String(maxGapSeconds)
    this.els.scatterGapFullyRandom.checked = Boolean(gapFullyRandom)
    this.els.scatterPitchMin.value = String(minPitchSemitones)
    this.els.scatterPitchMax.value = String(maxPitchSemitones)
    this.els.scatterPitchFullyRandom.checked = Boolean(pitchFullyRandom)
    this.els.scatterVolumeMin.value = String(Math.round(minVolume * 100))
    this.els.scatterVolumeMax.value = String(Math.round(maxVolume * 100))
    this.els.scatterFadeIn.value = String(fadeInMs)
    this.els.scatterFadeOut.value = String(fadeOutMs)
    this.els.scatterSyncGroup.value = syncGroup
    this.updateScatterRangeDisabled()
  }

  updateScatterLabels({ minPitchSemitones = 0, maxPitchSemitones = 0, minVolume = 1, maxVolume = 1 }) {
    this.els.scatterPitchMinValue.textContent = `${minPitchSemitones > 0 ? '+' : ''}${minPitchSemitones} st`
    this.els.scatterPitchMaxValue.textContent = `${maxPitchSemitones > 0 ? '+' : ''}${maxPitchSemitones} st`
    this.els.scatterVolumeMinValue.textContent = `${Math.round(minVolume * 100)}%`
    this.els.scatterVolumeMaxValue.textContent = `${Math.round(maxVolume * 100)}%`
  }

  applyPlayModeControl() {
    const playMode = this.currentPlayMode()
    this.els.crossfadeSection.classList.toggle('hidden', playMode === 'scatter' || playMode === 'scheduled')
    this.els.scatterSection.classList.toggle('hidden', playMode !== 'scatter')
    this.els.scheduleSection.classList.toggle('hidden', playMode !== 'scheduled')
    this.updateFadeVisual()
    this.updateSaveButtonState()
  }

  // Pushes the current playMode's fadeInMs/fadeOutMs into the waveform's
  // draggable fade handles (see LoopEditor.js/waveform.js) - only scatter/
  // scheduled shots have a per-shot fade to show, since the trimmed region is
  // exactly the one-shot clip that fade applies to (a continuously-looping
  // sound has no such thing). Called both ways: after a playMode switch or a
  // numeric fade-field edit (pushes field -> visual), and the reverse is
  // wired separately via loopEditorController.onFadesChange (drag -> field).
  updateFadeVisual() {
    const playMode = this.currentPlayMode()
    const enabled = playMode === 'scatter' || playMode === 'scheduled'
    this.loopEditorController?.setFadesEnabled(enabled)
    if (!enabled) return
    const { fadeInMs, fadeOutMs } = playMode === 'scatter' ? this.currentScatterConfig() : this.currentScheduleConfig()
    this.loopEditorController?.setFades(fadeInMs / 1000, fadeOutMs / 1000)
  }

  applyScatterControls() {
    const scatter = this.currentScatterConfig()
    this.updateScatterLabels(scatter)
    this.updateScatterRangeDisabled()
    this.updateFadeVisual()
    this.updateSaveButtonState()
  }

  // When a "Fully random" toggle is on, its own min/max inputs no longer do
  // anything - grey them out so that's visible rather than a silent no-op.
  updateScatterRangeDisabled() {
    const gapRandom = this.els.scatterGapFullyRandom.checked
    this.els.scatterGapMin.disabled = gapRandom
    this.els.scatterGapMax.disabled = gapRandom
    const pitchRandom = this.els.scatterPitchFullyRandom.checked
    this.els.scatterPitchMin.disabled = pitchRandom
    this.els.scatterPitchMax.disabled = pitchRandom
  }

  currentScheduleConfig() {
    const type = this.els.scheduleTypeInterval.checked ? 'interval' : 'times'
    const times = this.els.scheduleTimes.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    return {
      type,
      times,
      intervalMinutes: Number(this.els.scheduleInterval.value),
      minPitchSemitones: Number(this.els.schedulePitchMin.value),
      maxPitchSemitones: Number(this.els.schedulePitchMax.value),
      pitchFullyRandom: this.els.schedulePitchFullyRandom.checked,
      minVolume: Number(this.els.scheduleVolumeMin.value) / 100,
      maxVolume: Number(this.els.scheduleVolumeMax.value) / 100,
      fadeInMs: Number(this.els.scheduleFadeIn.value),
      fadeOutMs: Number(this.els.scheduleFadeOut.value)
    }
  }

  setScheduleControls({
    type = 'times',
    times = [],
    intervalMinutes = 60,
    minPitchSemitones = 0,
    maxPitchSemitones = 0,
    pitchFullyRandom = false,
    minVolume = 1,
    maxVolume = 1,
    fadeInMs = 0,
    fadeOutMs = 0
  }) {
    this.els.scheduleTypeTimes.checked = type !== 'interval'
    this.els.scheduleTypeInterval.checked = type === 'interval'
    this.els.scheduleTimes.value = times.join(', ')
    this.els.scheduleInterval.value = String(intervalMinutes)
    this.els.scheduleTimesRow.classList.toggle('hidden', type === 'interval')
    this.els.scheduleIntervalRow.classList.toggle('hidden', type !== 'interval')
    this.els.schedulePitchMin.value = String(minPitchSemitones)
    this.els.schedulePitchMax.value = String(maxPitchSemitones)
    this.els.schedulePitchFullyRandom.checked = Boolean(pitchFullyRandom)
    this.els.scheduleVolumeMin.value = String(Math.round(minVolume * 100))
    this.els.scheduleVolumeMax.value = String(Math.round(maxVolume * 100))
    this.els.scheduleFadeIn.value = String(fadeInMs)
    this.els.scheduleFadeOut.value = String(fadeOutMs)
    this.updateScheduleLabels({ minPitchSemitones, maxPitchSemitones, minVolume, maxVolume })
    this.updateSchedulePitchDisabled()
  }

  updateScheduleLabels({ minPitchSemitones = 0, maxPitchSemitones = 0, minVolume = 1, maxVolume = 1 }) {
    this.els.schedulePitchMinValue.textContent = `${minPitchSemitones > 0 ? '+' : ''}${minPitchSemitones} st`
    this.els.schedulePitchMaxValue.textContent = `${maxPitchSemitones > 0 ? '+' : ''}${maxPitchSemitones} st`
    this.els.scheduleVolumeMinValue.textContent = `${Math.round(minVolume * 100)}%`
    this.els.scheduleVolumeMaxValue.textContent = `${Math.round(maxVolume * 100)}%`
  }

  updateSchedulePitchDisabled() {
    const pitchRandom = this.els.schedulePitchFullyRandom.checked
    this.els.schedulePitchMin.disabled = pitchRandom
    this.els.schedulePitchMax.disabled = pitchRandom
  }

  applyScheduleControls() {
    const schedule = this.currentScheduleConfig()
    this.els.scheduleTimesRow.classList.toggle('hidden', schedule.type === 'interval')
    this.els.scheduleIntervalRow.classList.toggle('hidden', schedule.type !== 'interval')
    this.updateScheduleLabels(schedule)
    this.updateSchedulePitchDisabled()
    this.updateFadeVisual()
    this.updateSaveButtonState()
  }

  currentSpeedPitch() {
    return {
      speed: Number(this.els.speed.value) / 100,
      pitchSemitones: Number(this.els.pitch.value),
      reversed: this.els.reverse.checked,
      dopplerEnabled: this.els.doppler.checked,
      // Lives on the LoopEditor controller, not a form control - it's a
      // canvas-drawn drag position, same reasoning as loopStart/loopEnd
      // themselves.
      dopplerClosestFraction: this.loopEditorController?.getDopplerClosestFraction() ?? 0.5,
      dopplerIntensitySemitones: Number(this.els.dopplerIntensity.value),
      dopplerReversed: this.els.dopplerReversed.checked,
      dopplerSharpness: Number(this.els.dopplerSharpness.value) / 100
    }
  }

  setSpeedPitchControls({
    speed = 1,
    pitchSemitones = 0,
    reversed = false,
    dopplerEnabled = false,
    dopplerClosestFraction = 0.5,
    dopplerIntensitySemitones = 5,
    dopplerReversed = false,
    dopplerSharpness = 0.5
  }) {
    this.els.speed.value = String(Math.round(speed * 100))
    this.els.pitch.value = String(pitchSemitones)
    this.els.reverse.checked = Boolean(reversed)
    this.els.doppler.checked = Boolean(dopplerEnabled)
    this.els.dopplerHint.classList.toggle('hidden', !dopplerEnabled)
    this.els.dopplerOptions.classList.toggle('hidden', !dopplerEnabled)
    this.els.dopplerIntensity.value = String(dopplerIntensitySemitones)
    this.els.dopplerIntensityValue.textContent = `${dopplerIntensitySemitones} st`
    this.els.dopplerSharpness.value = String(Math.round((dopplerSharpness ?? 0.5) * 100))
    this.els.dopplerSharpnessValue.textContent = `${Math.round((dopplerSharpness ?? 0.5) * 100)}%`
    this.els.dopplerReversed.checked = Boolean(dopplerReversed)
    this.loopEditorController?.setDopplerClosestFraction(dopplerClosestFraction)
  }

  updateSpeedPitchLabels({ speed = 1, pitchSemitones = 0 }) {
    this.els.speedValue.textContent = `${Math.round(speed * 100)}%`
    this.els.pitchValue.textContent = pitchSemitones === 0 ? 'Off' : `${pitchSemitones > 0 ? '+' : ''}${pitchSemitones} st`
  }

  applySpeedPitchControls() {
    const speedPitch = this.currentSpeedPitch()
    this.updateSpeedPitchLabels(speedPitch)
    this.previewSource?.setSpeedPitch(speedPitch)
    this.els.dopplerHint.classList.toggle('hidden', !speedPitch.dopplerEnabled)
    this.els.dopplerOptions.classList.toggle('hidden', !speedPitch.dopplerEnabled)
    this.els.dopplerIntensityValue.textContent = `${speedPitch.dopplerIntensitySemitones} st`
    this.els.dopplerSharpnessValue.textContent = `${Math.round((speedPitch.dopplerSharpness ?? 0.5) * 100)}%`
    this.loopEditorController?.setDopplerEnabled(speedPitch.dopplerEnabled)
    this.loopEditorController?.setDopplerReversed(speedPitch.dopplerReversed)
    this.updateSaveButtonState()
  }

  // Builds a comparable snapshot of "what's currently saved" vs. "what's
  // live in the controls" - explicit key order/defaults on both sides
  // (rather than relying on entry.filters' own possibly-partial shape, e.g.
  // older entries saved before echoDelayMs/echoDecay existed) so the two
  // JSON strings only differ when something the user could actually change
  // has changed. crossfadeMs is compared as the rounded integer the slider
  // itself produces, not the seconds value it's persisted as, so float
  // round-tripping (ms -> seconds -> ms) can't cause a false "dirty" flag.
  snapshotOf(loopStart, loopEnd, filters, crossfadeMs, speedPitch, playMode, scatter, schedule) {
    return JSON.stringify({
      loopStart,
      loopEnd,
      filters: {
        highpassHz: filters.highpassHz ?? 0,
        lowpassHz: filters.lowpassHz ?? 20000,
        gainDb: filters.gainDb ?? 0,
        echoDelayMs: filters.echoDelayMs ?? 0,
        echoDecay: filters.echoDecay ?? 0,
        reverbSizeMs: filters.reverbSizeMs ?? 0,
        reverbMix: filters.reverbMix ?? 0,
        eq: (filters.eq ?? defaultEqBands()).map((b) => ({
          freqHz: b.freqHz,
          gainDb: b.gainDb,
          q: b.q,
          type: b.type ?? 'peaking',
          slope: b.slope ?? 'gentle',
          muted: b.muted ?? false
        }))
      },
      crossfadeMs,
      speedPitch: {
        speed: speedPitch.speed ?? 1,
        pitchSemitones: speedPitch.pitchSemitones ?? 0,
        reversed: speedPitch.reversed ?? false,
        dopplerEnabled: speedPitch.dopplerEnabled ?? false,
        dopplerClosestFraction: speedPitch.dopplerClosestFraction ?? 0.5,
        dopplerIntensitySemitones: speedPitch.dopplerIntensitySemitones ?? 5,
        dopplerReversed: speedPitch.dopplerReversed ?? false,
        dopplerSharpness: speedPitch.dopplerSharpness ?? 0.5
      },
      playMode,
      scatter: {
        minGapSeconds: scatter.minGapSeconds ?? 5,
        maxGapSeconds: scatter.maxGapSeconds ?? 35,
        gapFullyRandom: Boolean(scatter.gapFullyRandom),
        minPitchSemitones: scatter.minPitchSemitones ?? 0,
        maxPitchSemitones: scatter.maxPitchSemitones ?? 0,
        pitchFullyRandom: Boolean(scatter.pitchFullyRandom),
        minVolume: scatter.minVolume ?? 1,
        maxVolume: scatter.maxVolume ?? 1,
        fadeInMs: scatter.fadeInMs ?? 0,
        fadeOutMs: scatter.fadeOutMs ?? 0,
        syncGroup: scatter.syncGroup ?? ''
      },
      schedule: {
        type: schedule?.type ?? 'times',
        times: [...(schedule?.times ?? [])],
        intervalMinutes: schedule?.intervalMinutes ?? 60,
        minPitchSemitones: schedule?.minPitchSemitones ?? 0,
        maxPitchSemitones: schedule?.maxPitchSemitones ?? 0,
        pitchFullyRandom: Boolean(schedule?.pitchFullyRandom),
        minVolume: schedule?.minVolume ?? 1,
        maxVolume: schedule?.maxVolume ?? 1,
        fadeInMs: schedule?.fadeInMs ?? 0,
        fadeOutMs: schedule?.fadeOutMs ?? 0
      }
    })
  }

  hasUnsavedChanges() {
    if (!this.currentEntry || !this.loopEditorController || !this.savedSnapshot) return false
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    return (
      this.snapshotOf(
        loopStart,
        loopEnd,
        this.currentFilters(),
        this.currentCrossfadeMs(),
        this.currentSpeedPitch(),
        this.currentPlayMode(),
        this.currentScatterConfig(),
        this.currentScheduleConfig()
      ) !== this.savedSnapshot
    )
  }

  updateSaveButtonState() {
    // While viewing the read-only B (last saved) reference, currentFilters()
    // reflects B's data rather than A's real live edits (A's own bands are
    // stashed in eqLiveBandsStash, not currently loaded into the graph) - the
    // normal dirty-check would misleadingly compare "B vs. what's actually
    // saved" (always equal) and hide genuinely pending changes in A. Force
    // Save disabled with an explicit label instead of trusting that check
    // while B is on screen.
    if (this.eqCompareViewing === 'B') {
      this.els.save.disabled = true
      this.els.saveLabel.textContent = 'Viewing saved mix'
      if (this.els.saveAsCopy) this.els.saveAsCopy.disabled = true
      return
    }
    const dirty = this.hasUnsavedChanges()
    this.els.save.disabled = !dirty
    this.els.saveLabel.textContent = dirty ? 'Save' : 'Nothing to save'
    // Unlike Save, always enabled while viewing A regardless of dirty state -
    // saving a copy of the *current* (even unchanged) trim under a new name
    // is still a meaningful action, not just a no-op.
    if (this.els.saveAsCopy) this.els.saveAsCopy.disabled = false
    // Every field-change handler in this file ends by calling this method
    // (see applyFilterControls/applyEqControls/applyCrossfadeControl/
    // applySpeedPitchControls/applyPlayModeControl/applyScatterControls/
    // applyScheduleControls, plus the loop-point onLoopChange listener) -
    // the single place every kind of edit already funnels through, so it's
    // also the one hook point undo/redo history needs, without touching
    // each of those call sites individually. Only reached while viewing A
    // (the early-return above skips this while viewing B, since B's data
    // isn't the user's own editable state and shouldn't be recorded as one).
    this.scheduleHistoryCommit()
  }

  // The exact same normalized shape snapshotOf() already builds for the
  // dirty-check, just returned as a plain object instead of a JSON string so
  // it can actually be restored later, not just compared against.
  captureEditorState() {
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    return JSON.parse(
      this.snapshotOf(
        loopStart,
        loopEnd,
        this.currentFilters(),
        this.currentCrossfadeMs(),
        this.currentSpeedPitch(),
        this.currentPlayMode(),
        this.currentScatterConfig(),
        this.currentScheduleConfig()
      )
    )
  }

  scheduleHistoryCommit() {
    if (this._restoringHistory || !this.currentEntry) return
    clearTimeout(this._historyCommitTimer)
    this._historyCommitTimer = setTimeout(() => this.commitHistoryPoint(), HISTORY_COMMIT_DEBOUNCE_MS)
  }

  commitHistoryPoint() {
    if (!this.currentEntry || !this.loopEditorController) return
    const state = this.captureEditorState()
    const serialized = JSON.stringify(state)
    // No-op if nothing actually changed since the last recorded point (e.g.
    // a field was focused/blurred with no real edit) - avoids padding the
    // stack with identical entries.
    if (this.historyIndex >= 0 && JSON.stringify(this.historyStack[this.historyIndex]) === serialized) return
    // A fresh edit after undoing discards whatever redo branch existed -
    // same convention every text editor's own undo stack uses.
    this.historyStack = this.historyStack.slice(0, this.historyIndex + 1)
    this.historyStack.push(state)
    if (this.historyStack.length > HISTORY_LIMIT) this.historyStack.shift()
    this.historyIndex = this.historyStack.length - 1
    this.updateUndoRedoButtonsUI()
  }

  // Pushes a past/future history entry back onto every live control -
  // deliberately reuses the exact same setXControls()+applyXControls() pairs
  // each field's own change handler already calls (setFilterSliders+
  // applyFilterControls, setSpeedPitchControls+applySpeedPitchControls,
  // etc.), rather than re-deriving how to push state into the UI/live
  // preview a second time. _restoringHistory suppresses the history-commit
  // this would otherwise trigger via updateSaveButtonState().
  applyEditorState(state) {
    this._restoringHistory = true
    try {
      this.loopEditorController.setLoopPoints(state.loopStart, state.loopEnd)

      this.setFilterSliders(state.filters)
      this.applyFilterControls()
      this.updateEqRevertBannerVisibility()

      this.els.crossfade.value = String(state.crossfadeMs)
      this.applyCrossfadeControl()

      this.setSpeedPitchControls(state.speedPitch)
      this.applySpeedPitchControls()

      this.setPlayModeControls(state.playMode)
      this.applyPlayModeControl()

      this.setScatterControls(state.scatter)
      this.applyScatterControls()

      this.setScheduleControls(state.schedule)
      this.applyScheduleControls()
    } finally {
      this._restoringHistory = false
    }
    this.updateUndoRedoButtonsUI()
  }

  undo() {
    // A pending debounced commit represents an edit that hasn't been
    // recorded yet - flush it first so Ctrl+Z's first press undoes the most
    // recent *real* change instead of silently discarding it unrecorded.
    clearTimeout(this._historyCommitTimer)
    this.commitHistoryPoint()
    if (this.historyIndex <= 0) return
    this.historyIndex -= 1
    this.applyEditorState(this.historyStack[this.historyIndex])
  }

  redo() {
    if (this.historyIndex >= this.historyStack.length - 1) return
    this.historyIndex += 1
    this.applyEditorState(this.historyStack[this.historyIndex])
  }

  updateUndoRedoButtonsUI() {
    if (this.els.undo) this.els.undo.disabled = this.historyIndex <= 0
    if (this.els.redo) this.els.redo.disabled = this.historyIndex >= this.historyStack.length - 1
  }

  // Reloading the current sound from its own saved library data already
  // resets every control back to last-saved (the same path used repeatedly
  // during this feature's own testing to discard edits) - Cancel just wires
  // that existing path to a button instead of requiring a re-pick.
  cancelEdits() {
    if (!this.currentEntry) return
    this.selectPickerSound(this.currentEntry.id)
  }

  // The leave-confirmation prompt (Yes/No/Don't ask again) - TabHost's
  // onBeforeHide hook awaits this before actually switching away from the
  // Remix tab, so returning false here keeps the user on Remix. Nothing to
  // confirm (no unsaved changes, or the user already opted out) resolves
  // true immediately with no dialog shown at all.
  confirmLeaveIfDirty() {
    if (!this.hasUnsavedChanges() || this.skipLeaveConfirm) return true
    return new Promise((resolve) => {
      this._resolveLeaveConfirm = resolve
      this.els.leaveConfirmDialog.classList.remove('hidden')
    })
  }

  resolveLeaveConfirm(allowed) {
    this.els.leaveConfirmDialog.classList.add('hidden')
    this._resolveLeaveConfirm?.(allowed)
    this._resolveLeaveConfirm = null
  }

  wireLeaveConfirmDialog() {
    this.els.leaveConfirmYes.addEventListener('click', () => this.resolveLeaveConfirm(true))
    this.els.leaveConfirmNo.addEventListener('click', () => this.resolveLeaveConfirm(false))
    this.els.leaveConfirmDontAsk.addEventListener('click', () => {
      this.skipLeaveConfirm = true
      this.api.settings.setSkipRemixLeaveConfirmEnabled(true).catch((err) => console.error('Editor: failed to persist leave-confirm setting', err))
      this.resolveLeaveConfirm(true)
    })
  }

  stopPreviewTicking() {
    if (this.previewRafId) {
      cancelAnimationFrame(this.previewRafId)
      this.previewRafId = null
    }
  }

  tickPreviewPlayhead() {
    if (!this.previewSource || !this.loopEditorController) return
    const currentTime = this.previewSource.audioEl.currentTime
    this.loopEditorController.setPlayhead(currentTime)
    this.updateStickyProgress(currentTime)
    this.eqEditorController.tickSpectrum(this.previewSource.analyserNode)
    this.previewRafId = requestAnimationFrame(() => this.tickPreviewPlayhead())
  }

  // Drag-to-seek on the sticky progress bar - inbox answer to the v0.1.115
  // volume-slider follow-up ("make it so you can control the needle via the
  // progress bar on the sticky topbar... put a little circle on it so you
  // can drag"). Works whether the preview is playing or paused -
  // PreviewSource.scrubTo() already handles both (just repositions
  // currentTime, doesn't change play state). A click anywhere on the bar
  // seeks too, not just a precise grab on the thumb - matches how a normal
  // scrubbable progress bar works elsewhere (e.g. a video player).
  wireStickyProgressDrag() {
    let dragging = false

    const seekFromClientX = (clientX) => {
      if (!this.previewSource || !this.loopEditorController) return
      const rect = this.els.stickyProgress.getBoundingClientRect()
      const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
      const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
      const t = loopStart + fraction * Math.max(0, loopEnd - loopStart)
      this.previewSource.scrubTo(t)
      this.loopEditorController.setPlayhead(t)
      this.updateStickyProgress(t)
    }

    this.els.stickyProgress.addEventListener('mousedown', (evt) => {
      if (!this.previewSource) return
      dragging = true
      seekFromClientX(evt.clientX)
    })
    window.addEventListener('mousemove', (evt) => {
      if (!dragging) return
      seekFromClientX(evt.clientX)
    })
    window.addEventListener('mouseup', () => {
      dragging = false
    })
  }

  // Progress is relative to the trimmed loop region (loopStart..loopEnd),
  // not the whole original file - that's what's actually being previewed/
  // looped, matching what the waveform's own highlighted region already
  // represents visually. Guarded on stickyProgressFill existing since this
  // can theoretically be called before mountSticky() has run.
  updateStickyProgress(currentTime) {
    if (!this.els.stickyProgressFill || !this.loopEditorController) return
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    const span = Math.max(0, loopEnd - loopStart)
    const elapsed = Math.min(Math.max(currentTime - loopStart, 0), span)
    const pct = span > 0 ? (elapsed / span) * 100 : 0
    this.els.stickyProgressFill.style.width = `${pct}%`
    this.els.stickyProgressThumb.style.left = `${pct}%`
    this.els.stickyTime.textContent = `${formatDuration(elapsed)} / ${formatDuration(span)}`
  }

  disposePreview() {
    this.stopPreviewTicking()
    this.eqEditorController?.clearSpectrum()
    if (!this.previewSource) return
    this.previewSource.dispose()
    this.previewSource = null
    this.loopEditorController?.clearPlayhead()
    if (this.els.stickyProgressFill) {
      this.els.stickyProgressFill.style.width = '0%'
      this.els.stickyProgressThumb.style.left = '0%'
      this.els.stickyTime.textContent = '0:00 / 0:00'
    }
    this.setPlayPauseIcon(false)
  }

  async getWaveformPeaks(id) {
    if (this.waveformPeaksCache.has(id)) return this.waveformPeaksCache.get(id)
    const peaks = await this.api.audio.getWaveformPeaks(id, this.els.canvas.width)
    this.waveformPeaksCache.set(id, peaks)
    return peaks
  }

  // The base peaks fetched above always cover the whole file at a fixed
  // width - once the user zooms in past what that resolution can actually
  // show (the current view's own seconds-per-pixel drops below the base
  // array's seconds-per-bucket), a real, finer-grained ffmpeg pass over just
  // the visible window gets genuinely more detail rather than resampling the
  // same coarse data (see the rendering-only smoothing already in
  // waveform.js for that other, cheaper half of this same complaint).
  // Debounced so a zoom gesture (many wheel ticks in quick succession)
  // doesn't spawn a new ffmpeg process per tick - only the settled end state
  // gets fetched.
  maybeFetchDetailPeaks(viewStart, viewEnd, duration) {
    clearTimeout(this.detailPeaksDebounceTimer)
    const id = this.currentEntry?.id
    const basePeaks = id ? this.waveformPeaksCache.get(id) : null
    if (!id || !basePeaks || !duration) return

    const baseSecondsPerBucket = duration / basePeaks.length
    const viewSecondsPerPixel = (viewEnd - viewStart) / this.els.canvas.getBoundingClientRect().width
    if (viewSecondsPerPixel >= baseSecondsPerBucket) return

    this.detailPeaksDebounceTimer = setTimeout(async () => {
      const width = Math.max(1, Math.round(this.els.canvas.getBoundingClientRect().width))
      try {
        const detail = await this.api.audio.getWaveformPeaks(id, width, viewStart, viewEnd)
        // The user may have switched sounds, or zoomed/panned away from this
        // exact window, by the time the fetch resolves - setDetailPeaks
        // itself also re-checks the viewport is still covered before using
        // it, but there's no point handing a different sound's data over at
        // all.
        if (!detail || this.currentEntry?.id !== id) return
        this.loopEditorController.setDetailPeaks(detail, viewStart, viewEnd)
      } catch (err) {
        console.error('Editor: detail waveform peaks fetch failed', err)
      }
    }, 250)
  }

  async loadSound(id) {
    clearTimeout(this.detailPeaksDebounceTimer)
    const entry = this.library.find((s) => s.id === id)
    if (!entry) return
    // Solo is scoped to whichever sound was previously open, not the one
    // about to load - un-solo it first (targeting the old id) before
    // switching currentEntry, same "fresh load = fresh arrangement" logic
    // the EQ graph's own per-band Solo already uses.
    this.setSolo(false)
    this.currentEntry = entry
    this.disposePreview()

    this.els.empty.classList.add('hidden')
    this.els.panel.classList.remove('hidden')
    this.els.soundName.textContent = entry.name
    this.els.soundName.title = entry.name
    this.setPlayPauseIcon(false)
    this.els.saveStatus.textContent = ''

    // entry.filters.eq is undefined on any sound saved before the
    // parametric EQ existed - explicitly defaulted here (not left to
    // setFilterSliders' own `if (filters.eq)` guard) so loading an old
    // sound always resets the EQ editor to flat defaults instead of
    // silently keeping whatever the previously-loaded sound left on screen.
    const filters = { ...NEUTRAL_FILTERS, ...entry.filters, eq: entry.filters?.eq ?? defaultEqBands() }
    this.setFilterSliders(filters)
    this.updateFilterLabels(filters)
    // A/B Compare's "B" (last saved mix) - captured once here from the
    // just-loaded entry's own saved data, deliberately never touched again
    // for the rest of this editing session (not even by an in-session Save -
    // "last saved... before the current session").
    this.savedEqSnapshot = filters.eq.map((b) => ({ ...b }))
    this.resetEqCompare()

    const crossfadeMs = entry.crossfadeSeconds != null ? Math.round(entry.crossfadeSeconds * 1000) : DEFAULT_CROSSFADE_MS
    this.els.crossfade.value = String(crossfadeMs)
    this.updateCrossfadeLabel(crossfadeMs)

    const speedPitch = entry.speedPitch ?? {
      speed: 1,
      pitchSemitones: 0,
      reversed: false,
      dopplerEnabled: false,
      dopplerClosestFraction: 0.5,
      dopplerIntensitySemitones: 5,
      dopplerReversed: false,
      dopplerSharpness: 0.5
    }
    this.setSpeedPitchControls(speedPitch)
    this.updateSpeedPitchLabels(speedPitch)
    // setDopplerEnabled/setDopplerClosestFraction are called again below,
    // after loopEditorController.load() - load() resets both to their
    // neutral defaults (a fresh sound shouldn't inherit the previous one's
    // Doppler state), which would otherwise immediately clobber what
    // setSpeedPitchControls just set here.
    this.loopEditorController?.setDopplerEnabled(speedPitch.dopplerEnabled ?? false)

    const playMode = entry.playMode ?? 'loop'
    const scatter = entry.scatter ?? {
      minGapSeconds: 5,
      maxGapSeconds: 35,
      gapFullyRandom: false,
      minPitchSemitones: 0,
      maxPitchSemitones: 0,
      pitchFullyRandom: false,
      minVolume: 1,
      maxVolume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      syncGroup: ''
    }
    const schedule = entry.schedule ?? {
      type: 'times',
      times: [],
      intervalMinutes: 60,
      minPitchSemitones: 0,
      maxPitchSemitones: 0,
      pitchFullyRandom: false,
      minVolume: 1,
      maxVolume: 1,
      fadeInMs: 0,
      fadeOutMs: 0
    }
    this.setPlayModeControls(playMode)
    this.setScatterControls(scatter)
    this.updateScatterLabels(scatter)
    this.setScheduleControls(schedule)

    await this.engine.resume()
    this.previewSource = new PreviewSource(this.engine, {
      soundId: entry.id,
      loopStart: entry.loopStart,
      loopEnd: entry.loopEnd,
      volume: this.effectivePreviewVolume(),
      looping: this.looping,
      crossfadeSeconds: crossfadeMs / 1000,
      speedPitch
    })
    // Only fires when Loop preview is off and playback runs off the end on
    // its own - the button/playhead-tracking RAF otherwise only stop via
    // the explicit Play/Pause click handler below.
    this.previewSource.onEnded = () => {
      this.stopPreviewTicking()
      this.setPlayPauseIcon(false)
      this.eqEditorController.clearSpectrum()
    }
    const duration = await this.previewSource.waitForMetadata()
    if (this.currentEntry?.id !== id) return // switched sounds while loading

    if (entry.durationSeconds == null) {
      await this.api.library.updateMeta(id, { durationSeconds: duration })
      entry.durationSeconds = duration
      if (entry.loopEnd == null) entry.loopEnd = duration
    }

    const loopStart = entry.loopStart
    const loopEnd = entry.loopEnd ?? duration
    this.previewSource.setLoopPoints(loopStart, loopEnd)
    this.previewSource.setFilters(this.previewFilters())
    this.previewSource.audioEl.currentTime = loopStart
    this.loopEditorController.load(duration, loopStart, loopEnd)
    this.loopEditorController.setDopplerEnabled(speedPitch.dopplerEnabled ?? false)
    this.loopEditorController.setDopplerClosestFraction(speedPitch.dopplerClosestFraction ?? 0.5)
    this.loopEditorController.setDopplerReversed(speedPitch.dopplerReversed ?? false)
    this.updateFadeVisual()
    this.updateLoopTimeInputs(loopStart, loopEnd)
    this.loopEditorController.setPlayhead(loopStart)
    this.updateStickyProgress(loopStart)
    this.els.suggestStatus.textContent = ''
    this.els.suggestLoopBtn.disabled = false

    // Fire-and-forget: a real ffmpeg round-trip (six bandpass-filtered
    // passes, see src/main/ffmpeg/bandEnergy.js), so this arrives well after
    // everything else above already rendered. Fixed reference frequencies
    // (defaultEqBands' own, not this sound's possibly-customized bands) -
    // see EqEditor.js's setBandEnergy for why the backdrop is deliberately
    // decoupled from wherever the user later drags a node to.
    const bandFreqs = defaultEqBands().map((b) => b.freqHz)
    this.api.audio
      .getBandEnergy(id, { loopStart, loopEnd, freqs: bandFreqs })
      .then((energies) => {
        if (this.currentEntry?.id !== id || !energies) return
        this.eqEditorController.setBandEnergy(bandFreqs, energies)
      })
      .catch((err) => console.error('Editor: band energy analysis failed', err))
    this.savedSnapshot = this.snapshotOf(loopStart, loopEnd, filters, crossfadeMs, speedPitch, playMode, scatter, schedule)
    // Undo history is per-editing-session, same scope as A/B Compare - a
    // fresh load starts a fresh stack seeded with the just-loaded state, so
    // Ctrl+Z on the very first edit reverts to exactly what was loaded.
    clearTimeout(this._historyCommitTimer)
    this.historyStack = [JSON.parse(this.savedSnapshot)]
    this.historyIndex = 0
    this.updateUndoRedoButtonsUI()
    this.updateSaveButtonState()

    this.els.waveformStatus.textContent = this.waveformPeaksCache.has(id) ? '' : 'Loading waveform…'
    const peaks = await this.getWaveformPeaks(id)
    if (this.currentEntry?.id !== id) return
    this.loopEditorController.setPeaks(peaks)
    this.els.waveformStatus.textContent = peaks ? '' : 'Waveform preview unavailable for this file.'
  }

  async save() {
    // Defense in depth - the Save button is already disabled while viewing
    // B (see updateSaveButtonState), but currentFilters() would silently
    // read B's read-only data instead of A's real live edits if this ever
    // ran anyway.
    if (!this.currentEntry || !this.loopEditorController || this.eqCompareViewing === 'B') return
    const id = this.currentEntry.id
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    const filters = this.currentFilters()
    const crossfadeMs = this.currentCrossfadeMs()
    const crossfadeSeconds = crossfadeMs / 1000
    const speedPitch = this.currentSpeedPitch()
    const playMode = this.currentPlayMode()
    const scatter = this.currentScatterConfig()
    const schedule = this.currentScheduleConfig()
    // Random-interval and Scheduled playback both replay the clip as
    // one-shots, never back-to-back — the crossfade+rotation a looped clip
    // needs to hide its own wrap point would be wrong for either, so the
    // bake below always uses 0 (plain trim) for both regardless of the
    // crossfade slider's own saved value. Mirrors library.js/tabs/mixer's
    // own effectiveCrossfadeSeconds exactly — keep in sync if this ever
    // changes.
    const effectiveCrossfadeSeconds =
      playMode === 'scatter' || playMode === 'scheduled' || speedPitch.dopplerEnabled ? 0 : crossfadeSeconds

    await this.api.library.updateLoopPoints(id, { loopStart, loopEnd })
    await this.api.library.updateFilters(id, filters)
    await this.api.library.updateCrossfade(id, crossfadeSeconds)
    await this.api.library.updateSpeedPitch(id, speedPitch)
    await this.api.library.updatePlayMode(id, playMode)
    await this.api.library.updateScatterConfig(id, scatter)
    await this.api.library.updateSchedule(id, schedule)
    this.currentEntry.loopStart = loopStart
    this.currentEntry.loopEnd = loopEnd
    this.currentEntry.filters = filters
    this.currentEntry.crossfadeSeconds = crossfadeSeconds
    this.currentEntry.speedPitch = speedPitch
    this.currentEntry.playMode = playMode
    this.currentEntry.scatter = scatter
    this.currentEntry.schedule = schedule
    this.savedSnapshot = this.snapshotOf(loopStart, loopEnd, filters, crossfadeMs, speedPitch, playMode, scatter, schedule)

    // This never touches the original audio file: trim points and filters
    // are stored as metadata, applied live whenever the Mixer streams the
    // sound. Best-effort on top of that: bake trim+filters into a small
    // clip for native gapless looping. Only within the eligibility cap — a
    // longer trimmed region keeps the Mixer streaming (still filtered, just
    // with a small loop seam) instead of fully decoding it client-side,
    // which would risk the same memory/crash problem long files hit before
    // this app streamed instead of decoding. Speed/Pitch/Reverse follow the
    // same cap - Speed alone also applies live to a streamed (unbaked)
    // sound (see core's LocalFileSoundSource), but Pitch and Reverse need
    // the real ffmpeg render to take effect at all.
    if (loopEnd - loopStart <= MAX_BUFFER_CLIP_SECONDS) {
      this.els.save.disabled = true
      this.els.saveLabel.textContent = 'Saving…'
      const result = await this.api.audio.renderLoopClip(id, {
        loopStart,
        loopEnd,
        filters,
        crossfadeSeconds: effectiveCrossfadeSeconds,
        speedPitch
      })
      if (result.ok) {
        this.currentEntry.loopClipReady = true
        this.currentEntry.loopClipStart = loopStart
        this.currentEntry.loopClipEnd = loopEnd
        this.currentEntry.loopClipFilters = filters
        this.currentEntry.loopClipCrossfadeSeconds = effectiveCrossfadeSeconds
        this.currentEntry.loopClipSpeedPitch = speedPitch
        this.els.saveStatus.textContent =
          playMode === 'scatter'
            ? 'Saved — original file untouched. Rendered a clip for random-interval playback.'
            : playMode === 'scheduled'
              ? 'Saved — original file untouched. Rendered a clip for scheduled playback.'
              : 'Saved — original file untouched. Rendered a gapless clip for seamless looping.'
      } else {
        this.currentEntry.loopClipReady = false
        this.currentEntry.loopClipStart = null
        this.currentEntry.loopClipEnd = null
        this.currentEntry.loopClipFilters = null
        this.currentEntry.loopClipCrossfadeSeconds = null
        this.currentEntry.loopClipSpeedPitch = null
        this.els.saveStatus.textContent =
          playMode === 'scatter'
            ? 'Saved — original file untouched. Clip render failed, so this will stream directly for random-interval playback.'
            : playMode === 'scheduled'
              ? 'Saved — original file untouched. Clip render failed, so this will stream directly for scheduled playback.'
              : 'Saved — original file untouched. Gapless clip render failed, so this will loop with a small seam.'
      }
      this.updateSaveButtonState()
    } else {
      this.els.saveStatus.textContent =
        playMode === 'scatter'
          ? 'Saved — original file untouched. This trim is over 10 minutes, so random-interval playback will stream directly.'
          : playMode === 'scheduled'
            ? 'Saved — original file untouched. This trim is over 10 minutes, so scheduled playback will stream directly.'
            : 'Saved — original file untouched. This trim is over 10 minutes, so it will loop with a small seam instead of a gapless clip.'
      this.updateSaveButtonState()
    }
  }

  // Picks "<name> copy", then "<name> copy 2", "<name> copy 3"... against
  // whatever's currently in the library - names aren't enforced unique
  // elsewhere in this app, but a distinct default avoids two identical-
  // looking rows in the Mixer's own list right after saving.
  nextCopyName(baseName) {
    const existing = new Set(this.library.map((e) => e.name))
    let candidate = `${baseName} copy`
    let n = 2
    while (existing.has(candidate)) {
      candidate = `${baseName} copy ${n}`
      n += 1
    }
    return candidate
  }

  // "Save as copy" - trims a segment out of a longer recording (the owner's
  // own use case: several distinct bird calls in one field recording) into
  // its own independent sound, without touching the source's own saved
  // trim/filters at all. Deliberately does *not* run this.save() first or
  // touch this.currentEntry/this.savedSnapshot in any way - the workflow is
  // trim to segment 1, Save as copy, adjust the trim to segment 2 (still on
  // the *same* open sound), Save as copy again, and so on, so the sound
  // staying open in Remix must keep behaving exactly like nothing happened.
  // Mirrors save()'s own structure closely (same field reads, same bake
  // call, same MAX_BUFFER_CLIP_SECONDS cap) but targets the brand-new id
  // library.duplicateSound() hands back instead of this.currentEntry.id.
  async saveAsCopy() {
    if (!this.currentEntry || !this.loopEditorController || this.eqCompareViewing === 'B') return
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    const filters = this.currentFilters()
    const crossfadeMs = this.currentCrossfadeMs()
    const crossfadeSeconds = crossfadeMs / 1000
    const speedPitch = this.currentSpeedPitch()
    const playMode = this.currentPlayMode()
    const scatter = this.currentScatterConfig()
    const schedule = this.currentScheduleConfig()
    const effectiveCrossfadeSeconds =
      playMode === 'scatter' || playMode === 'scheduled' || speedPitch.dopplerEnabled ? 0 : crossfadeSeconds

    const name = this.nextCopyName(this.currentEntry.name)
    this.els.saveAsCopy.disabled = true
    this.els.saveStatus.textContent = `Saving a copy as "${name}"…`
    const newEntry = await this.api.library.duplicateSound(this.currentEntry.id, { name })
    if (!newEntry) {
      this.els.saveAsCopy.disabled = false
      this.els.saveStatus.textContent = 'Save as copy failed — could not create the new sound.'
      return
    }

    await this.api.library.updateLoopPoints(newEntry.id, { loopStart, loopEnd })
    await this.api.library.updateFilters(newEntry.id, filters)
    await this.api.library.updateCrossfade(newEntry.id, crossfadeSeconds)
    await this.api.library.updateSpeedPitch(newEntry.id, speedPitch)
    await this.api.library.updatePlayMode(newEntry.id, playMode)
    await this.api.library.updateScatterConfig(newEntry.id, scatter)
    await this.api.library.updateSchedule(newEntry.id, schedule)

    let baked = false
    if (loopEnd - loopStart <= MAX_BUFFER_CLIP_SECONDS) {
      const result = await this.api.audio.renderLoopClip(newEntry.id, {
        loopStart,
        loopEnd,
        filters,
        crossfadeSeconds: effectiveCrossfadeSeconds,
        speedPitch
      })
      baked = result.ok
    }
    this.els.saveAsCopy.disabled = false
    this.els.saveStatus.textContent = baked
      ? `Saved a copy: "${name}".`
      : `Saved a copy: "${name}" (streams directly - trim over 10 minutes, or the clip render failed).`
    await this.refreshLibrary()
  }
}
