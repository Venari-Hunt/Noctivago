import { AudioEngine } from './audio/AudioEngine.js'
import { PreviewSource } from './audio/PreviewSource.js'
import { createLoopEditorController } from './ui/LoopEditor.js'
import { createEqEditorController, Q_MIN, Q_MAX } from './ui/EqEditor.js'
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

// Mirrors library.js's defaultEqBands() exactly (band count, frequencies,
// neutral gain/Q) - same cross-directory duplication reason as
// MAX_BUFFER_CLIP_SECONDS above. A fresh function call each time, never a
// shared array, since callers mutate the objects they get back (the EQ
// editor controller clones on load() too, but this is cheap insurance).
function defaultEqBands() {
  return [60, 150, 400, 1000, 2500, 6000, 14000].map((freqHz) => ({ freqHz, gainDb: 0, q: 1, type: 'peaking', muted: false }))
}

const NEUTRAL_FILTERS = { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0, eq: defaultEqBands() }

// Curated highpass/lowpass/gain/echo combos for the one-click preset
// buttons. "Underwater" needs the lowpass slider's range extended below its
// old 500Hz floor (see the HTML below) to sound convincing; everything else
// fits the controls' original range.
//
// Echo and Reverb are the two presets that actually use echoDelayMs/
// echoDecay - "Reverb" isn't a real reverb algorithm (this ffmpeg build has
// no dedicated reverb filter, only aecho/chorus/flanger/etc., see the
// backlog note this preset was scoped from), it's a short delay + fairly
// high decay + a touch of lowpass tuned to read as a diffuse wash rather
// than distinct repeats; "Echo" uses a longer delay + lower decay for
// clear, separated slapback repeats instead.
const FILTER_PRESETS = {
  muffled: { label: 'Muffled', highpassHz: 0, lowpassHz: 700, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  phone: { label: 'Over the Phone', highpassHz: 300, lowpassHz: 3400, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  radio: { label: 'On the Radio', highpassHz: 150, lowpassHz: 6000, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  distant: { label: 'Distant', highpassHz: 0, lowpassHz: 2500, gainDb: -8, echoDelayMs: 0, echoDecay: 0 },
  underwater: { label: 'Underwater', highpassHz: 0, lowpassHz: 250, gainDb: -3, echoDelayMs: 0, echoDecay: 0 },
  echo: { label: 'Echo', highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 350, echoDecay: 0.4 },
  reverb: { label: 'Reverb', highpassHz: 0, lowpassHz: 8000, gainDb: 0, echoDelayMs: 50, echoDecay: 0.55 }
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
    // Persists across sounds within one tab session (like the filter
    // sliders' values don't) since it's a preview-workflow preference, not
    // per-sound saved state - nothing about it is written to the library.
    this.looping = true
    this.previewVolume = 0.7
    // Layered on top of previewVolume, not destructive to it - unmuting
    // always restores exactly whatever the slider was already showing,
    // same convention as the Mixer's own volume mute buttons.
    this.previewMuted = false
    // A/B Compare: two independent snapshots of the EQ bands the user can
    // toggle between while tuning, to judge "is this actually better"
    // against a real reference instead of memory. Per editing session only
    // (reset in loadSound) - not persisted with the sound, since it's a
    // workflow aid, not a saved setting.
    this.eqCompare = { active: 'A', slots: { A: null, B: null } }
    this.els = {}
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'remix',
      title: 'Remix',
      mount: (container) => this.mount(container),
      mountSticky: (container) => this.mountSticky(container),
      onShow: () => {
        // Picks up sounds added/removed elsewhere (e.g. the Mixer) since
        // this tab last mounted — mount() only runs once per tab lifetime,
        // so without this the picker would silently go stale.
        if (this.els.soundSearch) this.refreshLibrary().catch((err) => console.error('Editor: failed to refresh library', err))
        this._syncScrollTopVisibility?.()
      },
      onHide: () => {
        this.previewSource?.pause()
        this.stopPreviewTicking()
        this.setPlayPauseIcon(false)
      },
      onDestroy: () => this.disposePreview()
    })
  }

  async onunload() {
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
          </div>
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
            <p class="editor-playmode-hint">Random interval replays this clip at a random gap instead of looping it back-to-back — good for a short, event-like sound (a creak, a bird call) inside a longer ambient mix.</p>
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
            <p class="editor-scatter-hint">Each replay picks a random gap and pitch within these ranges. Leave both pitch bounds at 0 for a fully random pitch each time.</p>
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
          </div>
          <div class="editor-eq">
            <div class="editor-eq-header">
              <span class="editor-eq-label">Parametric EQ</span>
              <div class="editor-eq-compare" role="group" aria-label="Compare slot">
                <button id="editor-eq-compare-a" class="editor-eq-compare-btn editor-eq-compare-btn-active" type="button" title="Compare slot A">A</button>
                <button id="editor-eq-compare-b" class="editor-eq-compare-btn" type="button" title="Compare slot B">B</button>
              </div>
              <button id="editor-eq-reset" class="btn btn-small" type="button">Reset EQ</button>
            </div>
            <canvas id="editor-eq-canvas" width="640" height="140" title="Drag a node to adjust frequency/gain (hold Ctrl while dragging for finer control). Scroll over a node to adjust its Q. Double-click or Alt+click a node to reset it."></canvas>
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
                <input id="editor-eq-q" type="number" min="0.1" max="10" step="0.1" />
              </label>
              <button id="editor-eq-mute" class="editor-eq-toggle-btn" type="button" title="Mute this band (keeps its settings, just stops applying it)">Mute</button>
              <button id="editor-eq-solo" class="editor-eq-toggle-btn" type="button" title="Solo this band (hear only its effect, for auditioning while tuning)">Solo</button>
            </div>
            <p class="editor-eq-hint">Drag a node on the graph to shape a band (hold Ctrl while dragging for finer control), or type exact values above for the selected (highlighted) band. Scroll over a node to adjust its Q. Double-click or Alt+click a node to reset it to default. Mute silences a band without losing its settings; Solo hears only that band while tuning.</p>
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
            <button id="editor-reset-filters" class="btn" type="button">Reset filters</button>
            <span class="spacer"></span>
            <button id="editor-save" class="btn btn-primary" type="button">Save</button>
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
      playModeLoop: container.querySelector('#editor-playmode-loop'),
      playModeScatter: container.querySelector('#editor-playmode-scatter'),
      crossfadeSection: container.querySelector('#editor-crossfade-section'),
      crossfade: container.querySelector('#editor-crossfade'),
      crossfadeValue: container.querySelector('#editor-crossfade-value'),
      scatterSection: container.querySelector('#editor-scatter-section'),
      scatterGapMin: container.querySelector('#editor-scatter-gap-min'),
      scatterGapMax: container.querySelector('#editor-scatter-gap-max'),
      scatterPitchMin: container.querySelector('#editor-scatter-pitch-min'),
      scatterPitchMinValue: container.querySelector('#editor-scatter-pitch-min-value'),
      scatterPitchMax: container.querySelector('#editor-scatter-pitch-max'),
      scatterPitchMaxValue: container.querySelector('#editor-scatter-pitch-max-value'),
      speed: container.querySelector('#editor-speed'),
      speedValue: container.querySelector('#editor-speed-value'),
      pitch: container.querySelector('#editor-pitch'),
      pitchValue: container.querySelector('#editor-pitch-value'),
      reverse: container.querySelector('#editor-reverse'),
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
      eqCanvas: container.querySelector('#editor-eq-canvas'),
      eqReset: container.querySelector('#editor-eq-reset'),
      eqCompareA: container.querySelector('#editor-eq-compare-a'),
      eqCompareB: container.querySelector('#editor-eq-compare-b'),
      eqType: container.querySelector('#editor-eq-type'),
      eqFreq: container.querySelector('#editor-eq-freq'),
      eqGain: container.querySelector('#editor-eq-gain'),
      eqQ: container.querySelector('#editor-eq-q'),
      eqMute: container.querySelector('#editor-eq-mute'),
      eqSolo: container.querySelector('#editor-eq-solo'),
      resetFilters: container.querySelector('#editor-reset-filters'),
      presetButtons: container.querySelectorAll('[data-preset]'),
      save: container.querySelector('#editor-save'),
      saveStatus: container.querySelector('#editor-save-status'),
      scrollTop: container.querySelector('#editor-scroll-top')
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

    this.eqEditorController = createEqEditorController(this.els.eqCanvas)
    this.eqEditorController.onChange(() => this.applyEqControls())
    // "Double-clicking a node on the EQ should reset it" - requested
    // directly, mirroring the app-wide double-click-resets-a-slider
    // convention (sliderReset.js) for these custom canvas nodes, which that
    // delegated listener can't reach. "Default" here means this band's own
    // starting values (defaultEqBands()[index]), same source Reset EQ
    // already uses for every band at once - this is just that, scoped to
    // one band.
    this.eqEditorController.onDoubleClick((index) => {
      const defaults = defaultEqBands()[index]
      if (!defaults) return
      this.eqEditorController.setSelectedIndex(index)
      this.eqEditorController.setSelectedBand(defaults)
      this.applyEqControls()
    })

    this.waveformScrollbar = createWaveformScrollbar(this.els.scrollbarTrack, this.els.scrollbarThumb)
    this.waveformScrollbar.onNavigate((start, end) => this.loopEditorController.setViewport(start, end))
    this.loopEditorController.onViewportChange(({ viewStart, viewEnd, duration }) => {
      this.waveformScrollbar.update(duration, viewStart, viewEnd)
    })

    this.wireControls()
    this.wireScrollTop()
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

    this.els.playModeLoop.addEventListener('change', () => this.applyPlayModeControl())
    this.els.playModeScatter.addEventListener('change', () => this.applyPlayModeControl())
    this.els.scatterGapMin.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterGapMax.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterPitchMin.addEventListener('input', () => this.applyScatterControls())
    this.els.scatterPitchMax.addEventListener('input', () => this.applyScatterControls())

    this.els.crossfade.addEventListener('input', () => this.applyCrossfadeControl())

    this.els.speed.addEventListener('input', () => this.applySpeedPitchControls())
    this.els.pitch.addEventListener('input', () => this.applySpeedPitchControls())
    this.els.reverse.addEventListener('change', () => this.applySpeedPitchControls())

    this.els.highpass.addEventListener('input', () => this.applyFilterControls())
    this.els.lowpass.addEventListener('input', () => this.applyFilterControls())
    this.els.gain.addEventListener('input', () => this.applyFilterControls())
    this.els.echoDelay.addEventListener('input', () => this.applyFilterControls())
    this.els.echoDecay.addEventListener('input', () => this.applyFilterControls())

    this.els.eqType.addEventListener('change', () => this.applyEqFieldsToSelectedBand())
    this.els.eqFreq.addEventListener('change', () => this.applyEqFieldsToSelectedBand())
    this.els.eqGain.addEventListener('change', () => this.applyEqFieldsToSelectedBand())
    this.els.eqQ.addEventListener('change', () => this.applyEqFieldsToSelectedBand())
    this.els.eqReset.addEventListener('click', () => {
      this.eqEditorController.load(defaultEqBands())
      this.updateEqFieldsFromSelection()
      this.applyEqControls()
    })

    this.els.eqCompareA.addEventListener('click', () => this.switchEqCompareSlot('A'))
    this.els.eqCompareB.addEventListener('click', () => this.switchEqCompareSlot('B'))

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

    this.els.save.addEventListener('click', () => this.save().catch((err) => console.error('Editor: save failed', err)))
  }

  // Builds the sticky bar's own contents - Play/Pause, the loop toggle, and
  // a progress bar/time readout for the trim preview - kept separate from
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
      <div class="editor-sticky-progress">
        <div id="editor-sticky-progress-fill" class="editor-sticky-progress-fill"></div>
      </div>
      <span id="editor-sticky-time" class="editor-sticky-time">0:00 / 0:00</span>
      <input id="editor-sticky-volume" type="range" min="0" max="100" value="${Math.round(this.previewVolume * 100)}" class="editor-sticky-volume" title="Preview volume" />
      <button id="editor-sticky-mute" class="btn btn-svg-icon" type="button" title="Mute">${VOLUME_ICON_SVG}</button>
    `

    this.els.playPause = container.querySelector('#editor-play-pause')
    this.els.loopToggle = container.querySelector('#editor-loop-toggle')
    this.els.stickyProgressFill = container.querySelector('#editor-sticky-progress-fill')
    this.els.stickyTime = container.querySelector('#editor-sticky-time')
    this.els.stickyVolume = container.querySelector('#editor-sticky-volume')
    this.els.stickyMute = container.querySelector('#editor-sticky-mute')

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
      if (updated && document.activeElement !== this.els.soundSearch) this.els.soundSearch.value = updated.name
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

  selectPickerSound(id) {
    const entry = this.editableSounds().find((s) => s.id === id)
    if (!entry) return
    this.els.soundSearch.value = entry.name
    this.pickerQuery = ''
    this.closePicker()
    this.loadSound(id).catch((err) => console.error('Editor: failed to load sound', err))
  }

  clearPickerSelection() {
    this.els.soundSearch.value = ''
    this.pickerQuery = ''
    this.closePicker()
    this.showEmpty()
  }

  showEmpty() {
    this.currentEntry = null
    this.disposePreview()
    this.els.panel.classList.add('hidden')
    this.els.empty.classList.remove('hidden')
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
    if (!band) return
    this.els.eqType.value = band.type ?? 'peaking'
    this.els.eqFreq.value = String(Math.round(band.freqHz))
    this.els.eqGain.value = String(band.gainDb)
    this.els.eqQ.value = String(band.q)
    this.els.eqMute.classList.toggle('editor-eq-mute-active', Boolean(band.muted))
    this.els.eqSolo.classList.toggle('editor-eq-solo-active', this.eqEditorController.getSoloIndex() === index)
  }

  applyEqFieldsToSelectedBand() {
    const type = this.els.eqType.value
    const freqHz = Math.min(20000, Math.max(20, Number(this.els.eqFreq.value)))
    const gainDb = Math.min(24, Math.max(-24, Number(this.els.eqGain.value)))
    const q = Math.min(Q_MAX, Math.max(Q_MIN, Number(this.els.eqQ.value)))
    this.eqEditorController.setSelectedBand({ type, freqHz, gainDb, q })
    this.applyEqControls()
  }

  // Fires on every EQ graph change (drag, wheel Q) and every precision-field
  // edit - same live-preview + dirty-state pattern as applyFilterControls,
  // since EQ is just another part of the same filters bag now.
  applyEqControls() {
    this.updateEqFieldsFromSelection()
    this.previewSource?.setFilters(this.previewFilters())
    this.updateSaveButtonState()
  }

  // Snapshots the live EQ bands into the currently-active slot, then loads
  // whatever's stored in the target slot (or, the first time that slot's
  // ever touched, a copy of the current bands - so the very first switch
  // doesn't jar into silence/flat EQ, it just "arms" an independent copy to
  // diverge from). A no-op if the target is already active.
  switchEqCompareSlot(target) {
    if (target === this.eqCompare.active || !this.eqEditorController) return
    const currentBands = this.eqEditorController.getBands()
    this.eqCompare.slots[this.eqCompare.active] = currentBands.map((b) => ({ ...b }))
    const nextBands = (this.eqCompare.slots[target] ?? currentBands).map((b) => ({ ...b }))
    this.eqCompare.slots[target] = nextBands.map((b) => ({ ...b }))
    this.eqCompare.active = target
    this.eqEditorController.load(nextBands)
    this.updateEqFieldsFromSelection()
    this.applyEqControls()
    this.updateEqCompareButtonsUI()
  }

  updateEqCompareButtonsUI() {
    this.els.eqCompareA.classList.toggle('editor-eq-compare-btn-active', this.eqCompare.active === 'A')
    this.els.eqCompareB.classList.toggle('editor-eq-compare-btn-active', this.eqCompare.active === 'B')
  }

  // Clears both slots and resets to A - A/B state is a per-sound-editing-
  // session workflow aid, not something a switch to a different sound (or a
  // freshly loaded one) should carry over.
  resetEqCompare() {
    this.eqCompare = { active: 'A', slots: { A: null, B: null } }
    this.updateEqCompareButtonsUI()
  }

  updateFilterLabels(filters) {
    this.els.highpassValue.textContent = filters.highpassHz > 0 ? `${filters.highpassHz} Hz` : 'Off'
    this.els.lowpassValue.textContent = filters.lowpassHz < 20000 ? `${filters.lowpassHz} Hz` : 'Off'
    this.els.gainValue.textContent = `${filters.gainDb > 0 ? '+' : ''}${filters.gainDb} dB`
    this.els.echoDelayValue.textContent = filters.echoDelayMs > 0 ? `${filters.echoDelayMs} ms` : 'Off'
    this.els.echoDecayValue.textContent = filters.echoDecay > 0 ? filters.echoDecay.toFixed(2) : 'Off'
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
    return this.els.playModeScatter.checked ? 'scatter' : 'loop'
  }

  setPlayModeControls(playMode) {
    this.els.playModeLoop.checked = playMode !== 'scatter'
    this.els.playModeScatter.checked = playMode === 'scatter'
    this.els.crossfadeSection.classList.toggle('hidden', playMode === 'scatter')
    this.els.scatterSection.classList.toggle('hidden', playMode !== 'scatter')
  }

  currentScatterConfig() {
    return {
      minGapSeconds: Number(this.els.scatterGapMin.value),
      maxGapSeconds: Number(this.els.scatterGapMax.value),
      minPitchSemitones: Number(this.els.scatterPitchMin.value),
      maxPitchSemitones: Number(this.els.scatterPitchMax.value)
    }
  }

  setScatterControls({ minGapSeconds = 5, maxGapSeconds = 35, minPitchSemitones = 0, maxPitchSemitones = 0 }) {
    this.els.scatterGapMin.value = String(minGapSeconds)
    this.els.scatterGapMax.value = String(maxGapSeconds)
    this.els.scatterPitchMin.value = String(minPitchSemitones)
    this.els.scatterPitchMax.value = String(maxPitchSemitones)
  }

  updateScatterLabels({ minPitchSemitones = 0, maxPitchSemitones = 0 }) {
    this.els.scatterPitchMinValue.textContent = `${minPitchSemitones > 0 ? '+' : ''}${minPitchSemitones} st`
    this.els.scatterPitchMaxValue.textContent = `${maxPitchSemitones > 0 ? '+' : ''}${maxPitchSemitones} st`
  }

  applyPlayModeControl() {
    const playMode = this.currentPlayMode()
    this.els.crossfadeSection.classList.toggle('hidden', playMode === 'scatter')
    this.els.scatterSection.classList.toggle('hidden', playMode !== 'scatter')
    this.updateSaveButtonState()
  }

  applyScatterControls() {
    const scatter = this.currentScatterConfig()
    this.updateScatterLabels(scatter)
    this.updateSaveButtonState()
  }

  currentSpeedPitch() {
    return {
      speed: Number(this.els.speed.value) / 100,
      pitchSemitones: Number(this.els.pitch.value),
      reversed: this.els.reverse.checked
    }
  }

  setSpeedPitchControls({ speed = 1, pitchSemitones = 0, reversed = false }) {
    this.els.speed.value = String(Math.round(speed * 100))
    this.els.pitch.value = String(pitchSemitones)
    this.els.reverse.checked = Boolean(reversed)
  }

  updateSpeedPitchLabels({ speed = 1, pitchSemitones = 0 }) {
    this.els.speedValue.textContent = `${Math.round(speed * 100)}%`
    this.els.pitchValue.textContent = pitchSemitones === 0 ? 'Off' : `${pitchSemitones > 0 ? '+' : ''}${pitchSemitones} st`
  }

  applySpeedPitchControls() {
    const speedPitch = this.currentSpeedPitch()
    this.updateSpeedPitchLabels(speedPitch)
    this.previewSource?.setSpeedPitch(speedPitch)
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
  snapshotOf(loopStart, loopEnd, filters, crossfadeMs, speedPitch, playMode, scatter) {
    return JSON.stringify({
      loopStart,
      loopEnd,
      filters: {
        highpassHz: filters.highpassHz ?? 0,
        lowpassHz: filters.lowpassHz ?? 20000,
        gainDb: filters.gainDb ?? 0,
        echoDelayMs: filters.echoDelayMs ?? 0,
        echoDecay: filters.echoDecay ?? 0,
        eq: (filters.eq ?? defaultEqBands()).map((b) => ({ freqHz: b.freqHz, gainDb: b.gainDb, q: b.q, type: b.type ?? 'peaking', muted: b.muted ?? false }))
      },
      crossfadeMs,
      speedPitch: {
        speed: speedPitch.speed ?? 1,
        pitchSemitones: speedPitch.pitchSemitones ?? 0,
        reversed: speedPitch.reversed ?? false
      },
      playMode,
      scatter: {
        minGapSeconds: scatter.minGapSeconds ?? 5,
        maxGapSeconds: scatter.maxGapSeconds ?? 35,
        minPitchSemitones: scatter.minPitchSemitones ?? 0,
        maxPitchSemitones: scatter.maxPitchSemitones ?? 0
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
        this.currentScatterConfig()
      ) !== this.savedSnapshot
    )
  }

  updateSaveButtonState() {
    const dirty = this.hasUnsavedChanges()
    this.els.save.disabled = !dirty
    this.els.save.textContent = dirty ? 'Save' : 'Nothing to save'
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

  async loadSound(id) {
    const entry = this.library.find((s) => s.id === id)
    if (!entry) return
    this.currentEntry = entry
    this.disposePreview()

    this.els.empty.classList.add('hidden')
    this.els.panel.classList.remove('hidden')
    this.els.soundName.textContent = entry.name
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
    this.resetEqCompare()

    const crossfadeMs = entry.crossfadeSeconds != null ? Math.round(entry.crossfadeSeconds * 1000) : DEFAULT_CROSSFADE_MS
    this.els.crossfade.value = String(crossfadeMs)
    this.updateCrossfadeLabel(crossfadeMs)

    const speedPitch = entry.speedPitch ?? { speed: 1, pitchSemitones: 0, reversed: false }
    this.setSpeedPitchControls(speedPitch)
    this.updateSpeedPitchLabels(speedPitch)

    const playMode = entry.playMode ?? 'loop'
    const scatter = entry.scatter ?? { minGapSeconds: 5, maxGapSeconds: 35, minPitchSemitones: 0, maxPitchSemitones: 0 }
    this.setPlayModeControls(playMode)
    this.setScatterControls(scatter)
    this.updateScatterLabels(scatter)

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
    this.updateLoopTimeInputs(loopStart, loopEnd)
    this.loopEditorController.setPlayhead(loopStart)
    this.updateStickyProgress(loopStart)

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
    this.savedSnapshot = this.snapshotOf(loopStart, loopEnd, filters, crossfadeMs, speedPitch, playMode, scatter)
    this.updateSaveButtonState()

    this.els.waveformStatus.textContent = this.waveformPeaksCache.has(id) ? '' : 'Loading waveform…'
    const peaks = await this.getWaveformPeaks(id)
    if (this.currentEntry?.id !== id) return
    this.loopEditorController.setPeaks(peaks)
    this.els.waveformStatus.textContent = peaks ? '' : 'Waveform preview unavailable for this file.'
  }

  async save() {
    if (!this.currentEntry || !this.loopEditorController) return
    const id = this.currentEntry.id
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    const filters = this.currentFilters()
    const crossfadeMs = this.currentCrossfadeMs()
    const crossfadeSeconds = crossfadeMs / 1000
    const speedPitch = this.currentSpeedPitch()
    const playMode = this.currentPlayMode()
    const scatter = this.currentScatterConfig()
    // Random-interval playback replays the clip as one-shots, never
    // back-to-back — the crossfade+rotation a looped clip needs to hide its
    // own wrap point would be wrong here, so the bake below always uses 0
    // (plain trim) for a scatter-mode sound regardless of the crossfade
    // slider's own saved value. Mirrors library.js/tabs/mixer's own
    // effectiveCrossfadeSeconds exactly — keep in sync if this ever changes.
    const effectiveCrossfadeSeconds = playMode === 'scatter' ? 0 : crossfadeSeconds

    await this.api.library.updateLoopPoints(id, { loopStart, loopEnd })
    await this.api.library.updateFilters(id, filters)
    await this.api.library.updateCrossfade(id, crossfadeSeconds)
    await this.api.library.updateSpeedPitch(id, speedPitch)
    await this.api.library.updatePlayMode(id, playMode)
    await this.api.library.updateScatterConfig(id, scatter)
    this.currentEntry.loopStart = loopStart
    this.currentEntry.loopEnd = loopEnd
    this.currentEntry.filters = filters
    this.currentEntry.crossfadeSeconds = crossfadeSeconds
    this.currentEntry.speedPitch = speedPitch
    this.currentEntry.playMode = playMode
    this.currentEntry.scatter = scatter
    this.savedSnapshot = this.snapshotOf(loopStart, loopEnd, filters, crossfadeMs, speedPitch, playMode, scatter)

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
      this.els.save.textContent = 'Saving…'
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
            : 'Saved — original file untouched. Gapless clip render failed, so this will loop with a small seam.'
      }
      this.updateSaveButtonState()
    } else {
      this.els.saveStatus.textContent =
        playMode === 'scatter'
          ? 'Saved — original file untouched. This trim is over 10 minutes, so random-interval playback will stream directly.'
          : 'Saved — original file untouched. This trim is over 10 minutes, so it will loop with a small seam instead of a gapless clip.'
      this.updateSaveButtonState()
    }
  }
}
