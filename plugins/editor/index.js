import { AudioEngine } from './audio/AudioEngine.js'
import { PreviewSource } from './audio/PreviewSource.js'
import { createLoopEditorController } from './ui/LoopEditor.js'
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

const NEUTRAL_FILTERS = { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0 }

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
    this.els = {}
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'remix',
      title: 'Remix',
      mount: (container) => this.mount(container),
      onShow: () => {
        // Picks up sounds added/removed elsewhere (e.g. the Mixer) since
        // this tab last mounted — mount() only runs once per tab lifetime,
        // so without this the picker would silently go stale.
        if (this.els.soundSearch) this.refreshLibrary().catch((err) => console.error('Editor: failed to refresh library', err))
      },
      onHide: () => {
        this.previewSource?.pause()
        this.stopPreviewTicking()
        if (this.els.playPause) this.els.playPause.textContent = 'Play'
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
          <canvas id="editor-canvas" width="640" height="160" title="Scroll to zoom, shift+scroll or middle-drag to pan"></canvas>
          <div id="editor-scrollbar" class="editor-scrollbar">
            <div id="editor-scrollbar-thumb" class="editor-scrollbar-thumb"></div>
          </div>
          <div class="editor-preview-controls">
            <button id="editor-play-pause" class="btn btn-small" type="button">Play</button>
            <label class="editor-loop-toggle">
              <input id="editor-loop-toggle" type="checkbox" checked />
              Loop preview
            </label>
          </div>
          <p id="editor-waveform-status" class="editor-waveform-status"></p>
          <div class="editor-times">
            <label>Start <input id="editor-start-input" type="text" inputmode="numeric" placeholder="0:00" /></label>
            <label>End <input id="editor-end-input" type="text" inputmode="numeric" placeholder="0:00" /></label>
          </div>
          <div class="editor-crossfade">
            <label>
              <span>Loop crossfade</span>
              <input id="editor-crossfade" type="range" min="0" max="2000" value="200" step="10" />
              <span id="editor-crossfade-value" class="editor-filter-value">200 ms</span>
            </label>
            <p class="editor-crossfade-hint">Blends the seam so the loop isn't audible. Longer helps busy, textured audio (rain, crowds) — 0 disables blending. Automatically capped for very short loops.</p>
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
      loopToggle: container.querySelector('#editor-loop-toggle'),
      startInput: container.querySelector('#editor-start-input'),
      endInput: container.querySelector('#editor-end-input'),
      crossfade: container.querySelector('#editor-crossfade'),
      crossfadeValue: container.querySelector('#editor-crossfade-value'),
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
      playPause: container.querySelector('#editor-play-pause'),
      resetFilters: container.querySelector('#editor-reset-filters'),
      presetButtons: container.querySelectorAll('[data-preset]'),
      save: container.querySelector('#editor-save'),
      saveStatus: container.querySelector('#editor-save-status')
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

    this.waveformScrollbar = createWaveformScrollbar(this.els.scrollbarTrack, this.els.scrollbarThumb)
    this.waveformScrollbar.onNavigate((start, end) => this.loopEditorController.setViewport(start, end))
    this.loopEditorController.onViewportChange(({ viewStart, viewEnd, duration }) => {
      this.waveformScrollbar.update(duration, viewStart, viewEnd)
    })

    this.wireControls()
    this.refreshLibrary().catch((err) => console.error('Editor: failed to load library', err))
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
        const picked = options[this.pickerHighlightIndex]
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

    this.els.crossfade.addEventListener('input', () => this.applyCrossfadeControl())

    this.els.highpass.addEventListener('input', () => this.applyFilterControls())
    this.els.lowpass.addEventListener('input', () => this.applyFilterControls())
    this.els.gain.addEventListener('input', () => this.applyFilterControls())
    this.els.echoDelay.addEventListener('input', () => this.applyFilterControls())
    this.els.echoDecay.addEventListener('input', () => this.applyFilterControls())

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

    this.els.playPause.addEventListener('click', async () => {
      if (!this.previewSource) return
      if (this.previewSource.playing) {
        this.previewSource.pause()
        this.stopPreviewTicking()
        this.els.playPause.textContent = 'Play'
      } else {
        try {
          await this.engine.resume()
          await this.previewSource.play()
          this.els.playPause.textContent = 'Pause'
          this.tickPreviewPlayhead()
        } catch (err) {
          console.error('Failed to preview sound', err)
        }
      }
    })

    this.els.save.addEventListener('click', () => this.save().catch((err) => console.error('Editor: save failed', err)))

    this.els.loopToggle.addEventListener('change', () => {
      this.looping = this.els.loopToggle.checked
      this.previewSource?.setLooping(this.looping)
    })
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

  // Shared by Reset filters and every preset button, both of which just set
  // all five slider values from a filters object before re-applying.
  setFilterSliders(filters) {
    this.els.highpass.value = String(filters.highpassHz)
    this.els.lowpass.value = String(filters.lowpassHz)
    this.els.gain.value = String(filters.gainDb)
    this.els.echoDelay.value = String(filters.echoDelayMs ?? 0)
    this.els.echoDecay.value = String(filters.echoDecay ?? 0)
  }

  currentFilters() {
    return {
      highpassHz: Number(this.els.highpass.value),
      lowpassHz: Number(this.els.lowpass.value),
      gainDb: Number(this.els.gain.value),
      echoDelayMs: Number(this.els.echoDelay.value),
      echoDecay: Number(this.els.echoDecay.value)
    }
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
    this.previewSource?.setFilters(filters)
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

  // Builds a comparable snapshot of "what's currently saved" vs. "what's
  // live in the controls" - explicit key order/defaults on both sides
  // (rather than relying on entry.filters' own possibly-partial shape, e.g.
  // older entries saved before echoDelayMs/echoDecay existed) so the two
  // JSON strings only differ when something the user could actually change
  // has changed. crossfadeMs is compared as the rounded integer the slider
  // itself produces, not the seconds value it's persisted as, so float
  // round-tripping (ms -> seconds -> ms) can't cause a false "dirty" flag.
  snapshotOf(loopStart, loopEnd, filters, crossfadeMs) {
    return JSON.stringify({
      loopStart,
      loopEnd,
      filters: {
        highpassHz: filters.highpassHz ?? 0,
        lowpassHz: filters.lowpassHz ?? 20000,
        gainDb: filters.gainDb ?? 0,
        echoDelayMs: filters.echoDelayMs ?? 0,
        echoDecay: filters.echoDecay ?? 0
      },
      crossfadeMs
    })
  }

  hasUnsavedChanges() {
    if (!this.currentEntry || !this.loopEditorController || !this.savedSnapshot) return false
    const { loopStart, loopEnd } = this.loopEditorController.getLoopPoints()
    return this.snapshotOf(loopStart, loopEnd, this.currentFilters(), this.currentCrossfadeMs()) !== this.savedSnapshot
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
    this.loopEditorController.setPlayhead(this.previewSource.audioEl.currentTime)
    this.previewRafId = requestAnimationFrame(() => this.tickPreviewPlayhead())
  }

  disposePreview() {
    this.stopPreviewTicking()
    if (!this.previewSource) return
    this.previewSource.dispose()
    this.previewSource = null
    this.loopEditorController?.clearPlayhead()
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
    this.els.playPause.textContent = 'Play'
    this.els.saveStatus.textContent = ''

    const filters = entry.filters ?? { ...NEUTRAL_FILTERS }
    this.setFilterSliders(filters)
    this.updateFilterLabels(filters)

    const crossfadeMs = entry.crossfadeSeconds != null ? Math.round(entry.crossfadeSeconds * 1000) : DEFAULT_CROSSFADE_MS
    this.els.crossfade.value = String(crossfadeMs)
    this.updateCrossfadeLabel(crossfadeMs)

    await this.engine.resume()
    this.previewSource = new PreviewSource(this.engine, {
      soundId: entry.id,
      loopStart: entry.loopStart,
      loopEnd: entry.loopEnd,
      volume: 0.7,
      looping: this.looping,
      crossfadeSeconds: crossfadeMs / 1000
    })
    // Only fires when Loop preview is off and playback runs off the end on
    // its own - the button/playhead-tracking RAF otherwise only stop via
    // the explicit Play/Pause click handler below.
    this.previewSource.onEnded = () => {
      this.stopPreviewTicking()
      this.els.playPause.textContent = 'Play'
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
    this.previewSource.setFilters(filters)
    this.previewSource.audioEl.currentTime = loopStart
    this.loopEditorController.load(duration, loopStart, loopEnd)
    this.updateLoopTimeInputs(loopStart, loopEnd)
    this.loopEditorController.setPlayhead(loopStart)
    this.savedSnapshot = this.snapshotOf(loopStart, loopEnd, filters, crossfadeMs)
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

    await this.api.library.updateLoopPoints(id, { loopStart, loopEnd })
    await this.api.library.updateFilters(id, filters)
    await this.api.library.updateCrossfade(id, crossfadeSeconds)
    this.currentEntry.loopStart = loopStart
    this.currentEntry.loopEnd = loopEnd
    this.currentEntry.filters = filters
    this.currentEntry.crossfadeSeconds = crossfadeSeconds
    this.savedSnapshot = this.snapshotOf(loopStart, loopEnd, filters, crossfadeMs)

    // This never touches the original audio file: trim points and filters
    // are stored as metadata, applied live whenever the Mixer streams the
    // sound. Best-effort on top of that: bake trim+filters into a small
    // clip for native gapless looping. Only within the eligibility cap — a
    // longer trimmed region keeps the Mixer streaming (still filtered, just
    // with a small loop seam) instead of fully decoding it client-side,
    // which would risk the same memory/crash problem long files hit before
    // this app streamed instead of decoding.
    if (loopEnd - loopStart <= MAX_BUFFER_CLIP_SECONDS) {
      this.els.save.disabled = true
      this.els.save.textContent = 'Saving…'
      const result = await this.api.audio.renderLoopClip(id, { loopStart, loopEnd, filters, crossfadeSeconds })
      if (result.ok) {
        this.currentEntry.loopClipReady = true
        this.currentEntry.loopClipStart = loopStart
        this.currentEntry.loopClipEnd = loopEnd
        this.currentEntry.loopClipFilters = filters
        this.currentEntry.loopClipCrossfadeSeconds = crossfadeSeconds
        this.els.saveStatus.textContent = 'Saved — original file untouched. Rendered a gapless clip for seamless looping.'
      } else {
        this.currentEntry.loopClipReady = false
        this.currentEntry.loopClipStart = null
        this.currentEntry.loopClipEnd = null
        this.currentEntry.loopClipFilters = null
        this.currentEntry.loopClipCrossfadeSeconds = null
        this.els.saveStatus.textContent = 'Saved — original file untouched. Gapless clip render failed, so this will loop with a small seam.'
      }
      this.updateSaveButtonState()
    } else {
      this.els.saveStatus.textContent = 'Saved — original file untouched. This trim is over 10 minutes, so it will loop with a small seam instead of a gapless clip.'
      this.updateSaveButtonState()
    }
  }
}
