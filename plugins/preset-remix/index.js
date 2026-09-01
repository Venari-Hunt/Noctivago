// Preset Remix - a whole-mix processing editor scoped to a whole preset,
// rather than one sound at a time (that's the core Remix plugin). Pick a
// preset, dial in highpass / lowpass / gain / fade-in (and, from v0.1.115, a
// parametric EQ); Save persists it onto the preset. Whenever that preset is
// then loaded in the Mixer, its whole-mix chain is installed on the shared
// audio engine and heard on everything playing - the live counterpart of the
// "Whole-mix processing" section the Export tab already bakes into a file.
//
// This plugin only ever has the curated window.noctivago IPC surface - no
// line to the Mixer's audio engine. Live preview works by dispatching a
// `noctivago:whole-mix-preview` window CustomEvent that tabs/mixer/index.js
// listens for (the same bridge the Solo button uses); the Mixer applies it
// only if the edited preset is the one currently loaded.

import { WholeMixEqEditor, EQ_TYPES } from './ui/EqEditor.js'

const NEUTRAL = { highpassHz: 0, lowpassHz: 20000, gainDb: 0, fadeInSeconds: 0, eq: [] }

function cloneMix(mix) {
  return { ...NEUTRAL, ...(mix ?? {}), eq: (mix?.eq ?? []).map((b) => ({ ...b })) }
}

// Order-insensitive value compare - the EQ editor and the persisted store
// build band objects with different key orders, so a plain JSON.stringify
// would report a false "dirty" after an edit that lands back on the saved
// values.
function canonicalMix(mix) {
  const m = mix ?? {}
  return JSON.stringify({
    highpassHz: Number(m.highpassHz) || 0,
    lowpassHz: Number(m.lowpassHz ?? 20000),
    gainDb: Number(m.gainDb) || 0,
    fadeInSeconds: Number(m.fadeInSeconds) || 0,
    eq: (m.eq ?? []).map((b) => ({
      freqHz: Math.round(Number(b.freqHz) || 0),
      gainDb: Number(b.gainDb) || 0,
      q: Number(b.q) || 1,
      type: b.type ?? 'peaking',
      slope: b.slope === 'steep' ? 'steep' : 'gentle',
      muted: Boolean(b.muted)
    }))
  })
}

function mixesEqual(a, b) {
  return canonicalMix(a) === canonicalMix(b)
}

export default class PresetRemixPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.presets = []
    this.selectedPresetId = null
    this.current = cloneMix(null)
    this.saved = cloneMix(null)
    this.els = {}
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'preset-remix',
      title: 'Preset Remix',
      mount: (container) => this.mount(container),
      onShow: () => this.onShow(),
      onHide: () => this.onHide()
    })
  }

  async onunload() {
    // Revert any unsaved live preview before the plugin goes away.
    this.dispatchPreview(this.saved)
    this.unregister?.()
  }

  mount(container) {
    container.innerHTML = `
      <div class="premix-tab">
        <h2>Whole-mix processing for a preset</h2>
        <p class="premix-hint">These settings are saved on the preset and heard live on the whole mix whenever you load that preset in the Mixer. If the preset is already loaded, your changes here preview live as you drag.</p>

        <label class="premix-row">
          <span>Preset</span>
          <select id="premix-preset"></select>
        </label>

        <div id="premix-controls" class="premix-controls">
          <label class="premix-row">
            <span>Highpass</span>
            <input id="premix-highpass" type="range" min="0" max="2000" value="0" step="10" />
            <span id="premix-highpass-value" class="premix-value">Off</span>
          </label>
          <label class="premix-row">
            <span>Lowpass</span>
            <input id="premix-lowpass" type="range" min="150" max="20000" value="20000" step="50" />
            <span id="premix-lowpass-value" class="premix-value">Off</span>
          </label>
          <label class="premix-row">
            <span>Gain</span>
            <input id="premix-gain" type="range" min="-24" max="24" value="0" step="1" />
            <span id="premix-gain-value" class="premix-value">0 dB</span>
          </label>
          <label class="premix-row">
            <span>Fade in</span>
            <input id="premix-fade-in" type="number" min="0" max="60" step="0.5" value="0" />
            <span class="premix-value">s &mdash; eases the whole mix up when the preset loads</span>
          </label>

          <h3>Parametric EQ</h3>
          <p class="premix-hint">Click the graph to add a band, drag it to move, scroll over it for width (Q), right-click to remove.</p>
          <canvas id="premix-eq-canvas" class="premix-eq-canvas"></canvas>
          <div class="premix-eq-fields">
            <label><span>Freq</span><input id="premix-eq-freq" type="number" min="20" max="20000" step="1" /></label>
            <label><span>Gain</span><input id="premix-eq-gain" type="number" min="-18" max="18" step="0.5" /></label>
            <label><span>Q</span><input id="premix-eq-q" type="number" min="0.1" max="20" step="0.1" /></label>
            <label><span>Type</span><select id="premix-eq-type">${EQ_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></label>
            <button id="premix-eq-remove" class="btn btn-small" type="button">Remove band</button>
            <button id="premix-eq-reset" class="btn btn-small" type="button">Reset EQ</button>
          </div>

          <div class="premix-actions">
            <button id="premix-save" class="btn btn-icon-text" type="button" disabled>Save</button>
            <button id="premix-reset" class="btn btn-icon-text" type="button">Reset</button>
          </div>
          <p id="premix-status" class="premix-status"></p>
        </div>
      </div>
    `

    this.els = {
      preset: container.querySelector('#premix-preset'),
      controls: container.querySelector('#premix-controls'),
      highpass: container.querySelector('#premix-highpass'),
      highpassValue: container.querySelector('#premix-highpass-value'),
      lowpass: container.querySelector('#premix-lowpass'),
      lowpassValue: container.querySelector('#premix-lowpass-value'),
      gain: container.querySelector('#premix-gain'),
      gainValue: container.querySelector('#premix-gain-value'),
      fadeIn: container.querySelector('#premix-fade-in'),
      eqCanvas: container.querySelector('#premix-eq-canvas'),
      eqFreq: container.querySelector('#premix-eq-freq'),
      eqGain: container.querySelector('#premix-eq-gain'),
      eqQ: container.querySelector('#premix-eq-q'),
      eqType: container.querySelector('#premix-eq-type'),
      eqRemove: container.querySelector('#premix-eq-remove'),
      eqReset: container.querySelector('#premix-eq-reset'),
      save: container.querySelector('#premix-save'),
      reset: container.querySelector('#premix-reset'),
      status: container.querySelector('#premix-status')
    }

    this.eq = new WholeMixEqEditor(this.els.eqCanvas, (bands, opts) => this.onEqChange(bands, opts))

    this.els.preset.addEventListener('change', () => this.selectPreset(this.els.preset.value))
    for (const el of [this.els.highpass, this.els.lowpass, this.els.gain]) {
      el.addEventListener('input', () => this.readControlsAndPreview())
    }
    this.els.fadeIn.addEventListener('input', () => this.readControlsAndPreview())
    this.els.eqFreq.addEventListener('input', () => this.eq.updateSelectedBand({ freqHz: Number(this.els.eqFreq.value) }))
    this.els.eqGain.addEventListener('input', () => this.eq.updateSelectedBand({ gainDb: Number(this.els.eqGain.value) }))
    this.els.eqQ.addEventListener('input', () => this.eq.updateSelectedBand({ q: Number(this.els.eqQ.value) }))
    this.els.eqType.addEventListener('change', () => this.eq.updateSelectedBand({ type: this.els.eqType.value }))
    this.els.eqRemove.addEventListener('click', () => this.eq.removeSelectedBand())
    this.els.eqReset.addEventListener('click', () => this.eq.clear())
    this.els.save.addEventListener('click', () => this.save())
    this.els.reset.addEventListener('click', () => this.resetToNeutral())

    this.refresh().catch((err) => console.error('Preset Remix: failed to load presets', err))
  }

  onShow() {
    this.refresh().catch((err) => console.error('Preset Remix: failed to load presets', err))
    // Re-assert the live preview for whatever's selected (the Mixer may have
    // loaded a different preset while we were away).
    this.dispatchPreview(this.current)
  }

  onHide() {
    // Drop any unsaved preview - the Mixer should reflect the persisted state
    // once we're not actively editing.
    this.dispatchPreview(this.saved)
  }

  async refresh() {
    this.presets = await this.api.presets.list()
    const previous = this.selectedPresetId
    this.els.preset.innerHTML = this.presets.length
      ? this.presets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')
      : '<option value="">No presets saved yet</option>'

    const stillThere = this.presets.some((p) => p.id === previous)
    const target = stillThere ? previous : this.presets[0]?.id ?? null
    this.els.preset.value = target ?? ''
    this.selectPreset(target, { silent: true })
  }

  selectPreset(id, { silent = false } = {}) {
    this.selectedPresetId = id || null
    const preset = this.presets.find((p) => p.id === id)
    this.saved = cloneMix(preset?.wholeMix ?? null)
    this.current = cloneMix(this.saved)
    this.writeControls(this.current)
    this.eq.setBands(this.current.eq)
    this.syncEqFields()
    this.updateLabels()
    this.updateDirty()
    this.els.controls.classList.toggle('premix-disabled', !preset)
    this.els.status.textContent = ''
    if (!silent) this.dispatchPreview(this.current)
  }

  writeControls(mix) {
    this.els.highpass.value = String(mix.highpassHz)
    this.els.lowpass.value = String(mix.lowpassHz)
    this.els.gain.value = String(mix.gainDb)
    this.els.fadeIn.value = String(mix.fadeInSeconds)
  }

  // A band edit from the canvas (drag / add / remove / wheel). `selectionOnly`
  // means only which node is selected changed - refresh the fields but don't
  // treat it as a mix edit.
  onEqChange(bands, { selectionOnly = false } = {}) {
    this.syncEqFields()
    if (selectionOnly) return
    this.current = { ...this.current, eq: bands }
    this.updateDirty()
    this.dispatchPreview(this.current)
  }

  syncEqFields() {
    const band = this.eq.getSelectedBand()
    const disabled = !band
    for (const el of [this.els.eqFreq, this.els.eqGain, this.els.eqQ, this.els.eqType, this.els.eqRemove]) {
      el.disabled = disabled
    }
    if (!band) {
      this.els.eqFreq.value = ''
      this.els.eqGain.value = ''
      this.els.eqQ.value = ''
      return
    }
    // Don't clobber a field the user is actively typing in.
    if (document.activeElement !== this.els.eqFreq) this.els.eqFreq.value = String(Math.round(band.freqHz))
    if (document.activeElement !== this.els.eqGain) this.els.eqGain.value = String(band.gainDb)
    if (document.activeElement !== this.els.eqQ) this.els.eqQ.value = String(band.q)
    this.els.eqType.value = band.type ?? 'peaking'
  }

  readControlsAndPreview() {
    this.current = {
      ...this.current,
      highpassHz: Number(this.els.highpass.value),
      lowpassHz: Number(this.els.lowpass.value),
      gainDb: Number(this.els.gain.value),
      fadeInSeconds: Math.max(0, Number(this.els.fadeIn.value) || 0)
    }
    this.updateLabels()
    this.updateDirty()
    this.dispatchPreview(this.current)
  }

  updateLabels() {
    const hp = Number(this.els.highpass.value)
    const lp = Number(this.els.lowpass.value)
    const gain = Number(this.els.gain.value)
    this.els.highpassValue.textContent = hp > 0 ? `${hp} Hz` : 'Off'
    this.els.lowpassValue.textContent = lp < 20000 ? `${lp} Hz` : 'Off'
    this.els.gainValue.textContent = `${gain > 0 ? '+' : ''}${gain} dB`
  }

  updateDirty() {
    const dirty = !mixesEqual(this.current, this.saved)
    this.els.save.disabled = !dirty || !this.selectedPresetId
    this.els.save.textContent = dirty ? 'Save' : 'Saved'
  }

  resetToNeutral() {
    this.current = cloneMix(null)
    this.writeControls(this.current)
    this.eq.setBands([])
    this.syncEqFields()
    this.updateLabels()
    this.updateDirty()
    this.dispatchPreview(this.current)
  }

  async save() {
    if (!this.selectedPresetId) return
    this.els.save.disabled = true
    try {
      const updated = await this.api.presets.updateWholeMix(this.selectedPresetId, this.current)
      // The store normalizes a fully-neutral config to null - mirror that so
      // the dirty check compares like-for-like.
      this.saved = cloneMix(updated?.wholeMix ?? null)
      this.current = cloneMix(this.saved)
      this.writeControls(this.current)
      this.eq.setBands(this.current.eq)
      this.syncEqFields()
      this.updateLabels()
      this.updateDirty()
      // keep the local copy in this.presets fresh so a re-select doesn't stale-read
      const local = this.presets.find((p) => p.id === this.selectedPresetId)
      if (local) local.wholeMix = updated?.wholeMix ?? null
      this.dispatchPreview(this.saved)
      this.els.status.textContent = 'Saved. Load this preset in the Mixer to hear it.'
    } catch (err) {
      console.error('Preset Remix: save failed', err)
      this.els.status.textContent = `Save failed: ${err.message}`
      this.updateDirty()
    }
  }

  dispatchPreview(wholeMix) {
    if (!this.selectedPresetId) return
    window.dispatchEvent(
      new CustomEvent('noctivago:whole-mix-preview', {
        detail: { presetId: this.selectedPresetId, wholeMix: cloneMix(wholeMix) }
      })
    )
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
