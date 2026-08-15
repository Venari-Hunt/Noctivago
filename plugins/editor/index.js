import { AudioEngine } from './audio/AudioEngine.js'
import { PreviewSource } from './audio/PreviewSource.js'
import { createLoopEditorController } from './ui/LoopEditor.js'
import { formatDuration, parseDuration } from './util/time.js'

// Mirrors src/shared/constants.js's MAX_BUFFER_CLIP_SECONDS. Duplicated here
// since a plugin can't import files outside its own directory (see the
// path-traversal guard in src/main/plugins/protocol.js) — keep in sync with
// core if that value ever changes.
const MAX_BUFFER_CLIP_SECONDS = 600

const NEUTRAL_FILTERS = { highpassHz: 0, lowpassHz: 20000, gainDb: 0 }

// Curated highpass/lowpass/gain combos for the one-click preset buttons.
// All achievable with the existing 3 controls — no new audio engine work.
// "Underwater" needs the lowpass slider's range extended below its old
// 500Hz floor (see the HTML below) to sound convincing; everything else
// fits the controls' original range.
const FILTER_PRESETS = {
  muffled: { label: 'Muffled', highpassHz: 0, lowpassHz: 700, gainDb: 0 },
  phone: { label: 'Over the Phone', highpassHz: 300, lowpassHz: 3400, gainDb: 0 },
  radio: { label: 'On the Radio', highpassHz: 150, lowpassHz: 6000, gainDb: 0 },
  distant: { label: 'Distant', highpassHz: 0, lowpassHz: 2500, gainDb: -8 },
  underwater: { label: 'Underwater', highpassHz: 0, lowpassHz: 250, gainDb: -3 }
}

export default class EditorPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.engine = new AudioEngine()

    this.library = []
    this.currentEntry = null
    this.previewSource = null
    this.previewRafId = null
    this.loopEditorController = null
    this.waveformPeaksCache = new Map()
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
        if (this.els.select) this.refreshLibrary().catch((err) => console.error('Editor: failed to refresh library', err))
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
          <select id="editor-sound-select">
            <option value="">Select a sound to edit…</option>
          </select>
        </div>
        <div id="editor-panel" class="editor-panel hidden">
          <h3 id="editor-sound-name"></h3>
          <canvas id="editor-canvas" width="640" height="160"></canvas>
          <p id="editor-waveform-status" class="editor-waveform-status"></p>
          <div class="editor-times">
            <label>Start <input id="editor-start-input" type="text" inputmode="numeric" placeholder="0:00" /></label>
            <label>End <input id="editor-end-input" type="text" inputmode="numeric" placeholder="0:00" /></label>
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
          </div>
          <div class="editor-presets">
            <span class="editor-presets-label">Presets</span>
            <button class="btn btn-small" type="button" data-preset="muffled">Muffled</button>
            <button class="btn btn-small" type="button" data-preset="phone">Over the Phone</button>
            <button class="btn btn-small" type="button" data-preset="radio">On the Radio</button>
            <button class="btn btn-small" type="button" data-preset="distant">Distant</button>
            <button class="btn btn-small" type="button" data-preset="underwater">Underwater</button>
          </div>
          <div class="editor-actions">
            <button id="editor-play-pause" class="btn" type="button">Play</button>
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
      select: container.querySelector('#editor-sound-select'),
      panel: container.querySelector('#editor-panel'),
      empty: container.querySelector('#editor-empty'),
      soundName: container.querySelector('#editor-sound-name'),
      canvas: container.querySelector('#editor-canvas'),
      waveformStatus: container.querySelector('#editor-waveform-status'),
      startInput: container.querySelector('#editor-start-input'),
      endInput: container.querySelector('#editor-end-input'),
      highpass: container.querySelector('#editor-highpass'),
      highpassValue: container.querySelector('#editor-highpass-value'),
      lowpass: container.querySelector('#editor-lowpass'),
      lowpassValue: container.querySelector('#editor-lowpass-value'),
      gain: container.querySelector('#editor-gain'),
      gainValue: container.querySelector('#editor-gain-value'),
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
    })
    this.loopEditorController.onScrub((t) => {
      if (this.previewSource) this.previewSource.audioEl.currentTime = t
    })

    this.wireControls()
    this.refreshLibrary().catch((err) => console.error('Editor: failed to load library', err))
  }

  wireControls() {
    this.els.select.addEventListener('change', () => {
      const id = this.els.select.value
      if (id) this.loadSound(id).catch((err) => console.error('Editor: failed to load sound', err))
      else this.showEmpty()
    })

    this.els.startInput.addEventListener('change', () => this.applyManualLoopPoints())
    this.els.endInput.addEventListener('change', () => this.applyManualLoopPoints())

    this.els.highpass.addEventListener('input', () => this.applyFilterControls())
    this.els.lowpass.addEventListener('input', () => this.applyFilterControls())
    this.els.gain.addEventListener('input', () => this.applyFilterControls())

    this.els.resetFilters.addEventListener('click', () => {
      this.els.highpass.value = String(NEUTRAL_FILTERS.highpassHz)
      this.els.lowpass.value = String(NEUTRAL_FILTERS.lowpassHz)
      this.els.gain.value = String(NEUTRAL_FILTERS.gainDb)
      this.applyFilterControls()
    })

    for (const button of this.els.presetButtons) {
      button.addEventListener('click', () => {
        const preset = FILTER_PRESETS[button.dataset.preset]
        if (!preset) return
        this.els.highpass.value = String(preset.highpassHz)
        this.els.lowpass.value = String(preset.lowpassHz)
        this.els.gain.value = String(preset.gainDb)
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
  }

  async refreshLibrary() {
    this.library = await this.api.library.list()
    const editable = this.library.filter((s) => s.status !== 'missing')
    const currentValue = this.els.select.value
    this.els.select.innerHTML = '<option value="">Select a sound to edit…</option>'
    for (const entry of editable) {
      const option = document.createElement('option')
      option.value = entry.id
      option.textContent = entry.name
      this.els.select.appendChild(option)
    }
    if (currentValue && editable.some((s) => s.id === currentValue)) {
      this.els.select.value = currentValue
    }
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
  }

  currentFilters() {
    return {
      highpassHz: Number(this.els.highpass.value),
      lowpassHz: Number(this.els.lowpass.value),
      gainDb: Number(this.els.gain.value)
    }
  }

  updateFilterLabels(filters) {
    this.els.highpassValue.textContent = filters.highpassHz > 0 ? `${filters.highpassHz} Hz` : 'Off'
    this.els.lowpassValue.textContent = filters.lowpassHz < 20000 ? `${filters.lowpassHz} Hz` : 'Off'
    this.els.gainValue.textContent = `${filters.gainDb > 0 ? '+' : ''}${filters.gainDb} dB`
  }

  applyFilterControls() {
    const filters = this.currentFilters()
    this.updateFilterLabels(filters)
    this.previewSource?.setFilters(filters)
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
    this.els.save.disabled = false
    this.els.save.textContent = 'Save'
    this.els.saveStatus.textContent = ''

    const filters = entry.filters ?? { ...NEUTRAL_FILTERS }
    this.els.highpass.value = String(filters.highpassHz)
    this.els.lowpass.value = String(filters.lowpassHz)
    this.els.gain.value = String(filters.gainDb)
    this.updateFilterLabels(filters)

    await this.engine.resume()
    this.previewSource = new PreviewSource(this.engine, {
      soundId: entry.id,
      loopStart: entry.loopStart,
      loopEnd: entry.loopEnd,
      volume: 0.7
    })
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

    await this.api.library.updateLoopPoints(id, { loopStart, loopEnd })
    await this.api.library.updateFilters(id, filters)
    this.currentEntry.loopStart = loopStart
    this.currentEntry.loopEnd = loopEnd
    this.currentEntry.filters = filters

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
      const result = await this.api.audio.renderLoopClip(id, { loopStart, loopEnd, filters })
      if (result.ok) {
        this.currentEntry.loopClipReady = true
        this.currentEntry.loopClipStart = loopStart
        this.currentEntry.loopClipEnd = loopEnd
        this.currentEntry.loopClipFilters = filters
        this.els.saveStatus.textContent = 'Saved — original file untouched. Rendered a gapless clip for seamless looping.'
      } else {
        this.currentEntry.loopClipReady = false
        this.currentEntry.loopClipStart = null
        this.currentEntry.loopClipEnd = null
        this.currentEntry.loopClipFilters = null
        this.els.saveStatus.textContent = 'Saved — original file untouched. Gapless clip render failed, so this will loop with a small seam.'
      }
      this.els.save.disabled = false
      this.els.save.textContent = 'Save'
    } else {
      this.els.saveStatus.textContent = 'Saved — original file untouched. This trim is over 10 minutes, so it will loop with a small seam instead of a gapless clip.'
    }
  }
}
