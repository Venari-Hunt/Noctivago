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
// A group's own filters (see AudioEngine.js's SoundGroupChain) are the same
// shape as the whole-mix's, minus fadeInSeconds - a group has no "on load"
// moment of its own to fade in on.
const NEUTRAL_GROUP_FILTERS = { highpassHz: 0, lowpassHz: 20000, gainDb: 0, eq: [] }

function cloneMix(mix) {
  return { ...NEUTRAL, ...(mix ?? {}), eq: (mix?.eq ?? []).map((b) => ({ ...b })) }
}

function cloneGroupFilters(filters) {
  return { ...NEUTRAL_GROUP_FILTERS, ...(filters ?? {}), eq: (filters?.eq ?? []).map((b) => ({ ...b })) }
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

function canonicalGroupFilters(filters) {
  const f = filters ?? {}
  return JSON.stringify({
    highpassHz: Number(f.highpassHz) || 0,
    lowpassHz: Number(f.lowpassHz ?? 20000),
    gainDb: Number(f.gainDb) || 0,
    eq: (f.eq ?? []).map((b) => ({
      freqHz: Math.round(Number(b.freqHz) || 0),
      gainDb: Number(b.gainDb) || 0,
      q: Number(b.q) || 1,
      type: b.type ?? 'peaking',
      slope: b.slope === 'steep' ? 'steep' : 'gentle',
      muted: Boolean(b.muted)
    }))
  })
}

function groupFiltersEqual(a, b) {
  return canonicalGroupFilters(a) === canonicalGroupFilters(b)
}

export default class PresetRemixPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.presets = []
    this.library = []
    this.selectedPresetId = null
    this.current = cloneMix(null)
    this.saved = cloneMix(null)
    // Sound Groups (see AudioEngine.js's SoundGroupChain) - groups belonging
    // to the selected preset, and whichever one is currently open for
    // editing below the whole-mix controls.
    this.groups = []
    this.selectedGroupId = null
    this.groupCurrent = cloneGroupFilters(null)
    this.groupSaved = cloneGroupFilters(null)
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
    this.dispatchGroupPreview(this.groupSaved)
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

        <div id="premix-groups" class="premix-groups">
          <h3>Sound Groups</h3>
          <p class="premix-hint">Group some of this preset's sounds into one shared submix so you can EQ them together (e.g. crickets + toads to sound like they're outside), non-destructively - each sound's own filters are untouched. A sound can also be added to a group from its right-click menu in the Mixer.</p>

          <ul id="premix-group-list" class="premix-group-list"></ul>

          <div class="premix-group-create">
            <input id="premix-group-name" type="text" placeholder="New group name" />
            <select id="premix-group-copy-from">
              <option value="">Start neutral</option>
            </select>
            <button id="premix-group-create-btn" class="btn btn-small" type="button">+ Create</button>
          </div>

          <div id="premix-group-editor" class="premix-group-editor hidden">
            <label class="premix-row">
              <span>Name</span>
              <input id="premix-group-rename" type="text" />
            </label>

            <p class="premix-hint">Sounds in this preset's mix:</p>
            <ul id="premix-group-members" class="premix-group-members"></ul>

            <label class="premix-row">
              <span>Highpass</span>
              <input id="premix-group-highpass" type="range" min="0" max="2000" value="0" step="10" />
              <span id="premix-group-highpass-value" class="premix-value">Off</span>
            </label>
            <label class="premix-row">
              <span>Lowpass</span>
              <input id="premix-group-lowpass" type="range" min="150" max="20000" value="20000" step="50" />
              <span id="premix-group-lowpass-value" class="premix-value">Off</span>
            </label>
            <label class="premix-row">
              <span>Gain</span>
              <input id="premix-group-gain" type="range" min="-24" max="24" value="0" step="1" />
              <span id="premix-group-gain-value" class="premix-value">0 dB</span>
            </label>

            <h4>Parametric EQ</h4>
            <canvas id="premix-group-eq-canvas" class="premix-eq-canvas"></canvas>
            <div class="premix-eq-fields">
              <label><span>Freq</span><input id="premix-group-eq-freq" type="number" min="20" max="20000" step="1" /></label>
              <label><span>Gain</span><input id="premix-group-eq-gain" type="number" min="-18" max="18" step="0.5" /></label>
              <label><span>Q</span><input id="premix-group-eq-q" type="number" min="0.1" max="20" step="0.1" /></label>
              <label><span>Type</span><select id="premix-group-eq-type">${EQ_TYPES.map((t) => '<option value="' + t + '">' + t + '</option>').join('')}</select></label>
              <button id="premix-group-eq-remove" class="btn btn-small" type="button">Remove band</button>
              <button id="premix-group-eq-reset" class="btn btn-small" type="button">Reset EQ</button>
            </div>

            <div class="premix-actions">
              <button id="premix-group-save" class="btn btn-icon-text" type="button" disabled>Save</button>
              <button id="premix-group-delete" class="btn btn-danger btn-icon-text" type="button">Delete group</button>
            </div>
            <p id="premix-group-status" class="premix-status"></p>
          </div>
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
      status: container.querySelector('#premix-status'),

      groupsSection: container.querySelector('#premix-groups'),
      groupList: container.querySelector('#premix-group-list'),
      groupName: container.querySelector('#premix-group-name'),
      groupCopyFrom: container.querySelector('#premix-group-copy-from'),
      groupCreateBtn: container.querySelector('#premix-group-create-btn'),
      groupEditor: container.querySelector('#premix-group-editor'),
      groupRename: container.querySelector('#premix-group-rename'),
      groupMembers: container.querySelector('#premix-group-members'),
      groupHighpass: container.querySelector('#premix-group-highpass'),
      groupHighpassValue: container.querySelector('#premix-group-highpass-value'),
      groupLowpass: container.querySelector('#premix-group-lowpass'),
      groupLowpassValue: container.querySelector('#premix-group-lowpass-value'),
      groupGain: container.querySelector('#premix-group-gain'),
      groupGainValue: container.querySelector('#premix-group-gain-value'),
      groupEqCanvas: container.querySelector('#premix-group-eq-canvas'),
      groupEqFreq: container.querySelector('#premix-group-eq-freq'),
      groupEqGain: container.querySelector('#premix-group-eq-gain'),
      groupEqQ: container.querySelector('#premix-group-eq-q'),
      groupEqType: container.querySelector('#premix-group-eq-type'),
      groupEqRemove: container.querySelector('#premix-group-eq-remove'),
      groupEqReset: container.querySelector('#premix-group-eq-reset'),
      groupSave: container.querySelector('#premix-group-save'),
      groupDelete: container.querySelector('#premix-group-delete'),
      groupStatus: container.querySelector('#premix-group-status')
    }

    this.eq = new WholeMixEqEditor(this.els.eqCanvas, (bands, opts) => this.onEqChange(bands, opts))
    this.groupEq = new WholeMixEqEditor(this.els.groupEqCanvas, (bands, opts) => this.onGroupEqChange(bands, opts))

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

    this.els.groupCreateBtn.addEventListener('click', () => this.createGroup())
    this.els.groupRename.addEventListener('input', () => this.updateGroupDirty())
    for (const el of [this.els.groupHighpass, this.els.groupLowpass, this.els.groupGain]) {
      el.addEventListener('input', () => this.readGroupControlsAndPreview())
    }
    this.els.groupEqFreq.addEventListener('input', () => this.groupEq.updateSelectedBand({ freqHz: Number(this.els.groupEqFreq.value) }))
    this.els.groupEqGain.addEventListener('input', () => this.groupEq.updateSelectedBand({ gainDb: Number(this.els.groupEqGain.value) }))
    this.els.groupEqQ.addEventListener('input', () => this.groupEq.updateSelectedBand({ q: Number(this.els.groupEqQ.value) }))
    this.els.groupEqType.addEventListener('change', () => this.groupEq.updateSelectedBand({ type: this.els.groupEqType.value }))
    this.els.groupEqRemove.addEventListener('click', () => this.groupEq.removeSelectedBand())
    this.els.groupEqReset.addEventListener('click', () => this.groupEq.clear())
    this.els.groupSave.addEventListener('click', () => this.saveGroup())
    this.els.groupDelete.addEventListener('click', () => this.deleteGroup())

    this.refresh().catch((err) => console.error('Preset Remix: failed to load presets', err))
  }

  onShow() {
    this.refresh().catch((err) => console.error('Preset Remix: failed to load presets', err))
    // Re-assert the live preview for whatever's selected (the Mixer may have
    // loaded a different preset while we were away).
    this.dispatchPreview(this.current)
    if (this.selectedGroupId) this.dispatchGroupPreview(this.groupCurrent)
  }

  onHide() {
    // Drop any unsaved preview - the Mixer should reflect the persisted state
    // once we're not actively editing.
    this.dispatchPreview(this.saved)
    if (this.selectedGroupId) this.dispatchGroupPreview(this.groupSaved)
  }

  async refresh() {
    this.presets = await this.api.presets.list()
    this.library = await this.api.library.list()
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
    // Revert any unsaved group preview before switching away from it - the
    // group belongs to the *old* preset, so its edits shouldn't linger on
    // whatever the Mixer is playing once a different preset is selected.
    if (this.selectedGroupId) this.dispatchGroupPreview(this.groupSaved)

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

    this.groups = preset?.groups ?? []
    this.selectedGroupId = null
    this.els.groupsSection.classList.toggle('premix-disabled', !preset)
    this.renderGroupCopyFromOptions()
    this.renderGroupList()
    this.els.groupEditor.classList.add('hidden')
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

  // ---- Sound Groups (see AudioEngine.js's SoundGroupChain) ----
  // A group is scoped to the selected preset: a named subset of that
  // preset's own sounds, routed through one shared highpass/lowpass/EQ/gain
  // chain instead of straight to masterGain. Membership writes through
  // immediately (like adding a sound to a preset); a group's own name/
  // filters/EQ are a draft with its own Save button, same dirty-tracking
  // shape as the whole-mix controls above but kept fully separate so
  // editing a group never affects the whole-mix save state or vice versa.

  renderGroupCopyFromOptions() {
    const options = ['<option value="">Start neutral</option>']
    for (const preset of this.presets) {
      for (const group of preset.groups ?? []) {
        const key = `${preset.id}::${group.id}`
        options.push(`<option value="${key}">${escapeHtml(group.name)} (${escapeHtml(preset.name)})</option>`)
      }
    }
    this.els.groupCopyFrom.innerHTML = options.join('')
  }

  renderGroupList() {
    this.els.groupList.innerHTML = ''
    if (this.groups.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'premix-group-empty'
      empty.textContent = 'No groups on this preset yet.'
      this.els.groupList.appendChild(empty)
      return
    }
    for (const group of this.groups) {
      const li = document.createElement('li')
      li.className = 'premix-group-item' + (group.id === this.selectedGroupId ? ' premix-group-item-active' : '')

      const name = document.createElement('span')
      name.className = 'premix-group-item-name'
      name.textContent = group.name
      li.appendChild(name)

      const count = document.createElement('span')
      count.className = 'premix-group-item-count'
      count.textContent = `${group.soundIds.length} sound${group.soundIds.length === 1 ? '' : 's'}`
      li.appendChild(count)

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'btn btn-small btn-danger premix-group-item-delete'
      del.textContent = 'Delete'
      del.addEventListener('click', (evt) => {
        evt.stopPropagation()
        this.deleteGroup(group.id)
      })
      li.appendChild(del)

      li.addEventListener('click', () => this.selectGroup(group.id))
      this.els.groupList.appendChild(li)
    }
  }

  selectGroup(id) {
    if (this.selectedGroupId) this.dispatchGroupPreview(this.groupSaved)

    const group = this.groups.find((g) => g.id === id)
    this.selectedGroupId = group ? id : null
    this.renderGroupList()
    if (!group) {
      this.els.groupEditor.classList.add('hidden')
      return
    }

    this.els.groupEditor.classList.remove('hidden')
    this.els.groupRename.value = group.name
    this.groupSaved = cloneGroupFilters(group.filters)
    this.groupCurrent = cloneGroupFilters(this.groupSaved)
    this.writeGroupControls(this.groupCurrent)
    this.groupEq.setBands(this.groupCurrent.eq)
    this.syncGroupEqFields()
    this.updateGroupLabels()
    this.updateGroupDirty()
    this.els.groupStatus.textContent = ''
    this.renderGroupMembers()
    this.dispatchGroupPreview(this.groupCurrent)
  }

  // The preset's own sound list, cross-referenced with the library for
  // display names - membership only ever makes sense for sounds actually in
  // this preset's mix, matching the ask ("assign audio files to it").
  renderGroupMembers() {
    this.els.groupMembers.innerHTML = ''
    const preset = this.presets.find((p) => p.id === this.selectedPresetId)
    const group = this.groups.find((g) => g.id === this.selectedGroupId)
    if (!preset || !group) return
    for (const item of preset.sounds) {
      const sound = this.library.find((s) => s.id === item.soundId)
      const label = document.createElement('label')
      label.className = 'premix-group-member'
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = group.soundIds.includes(item.soundId)
      checkbox.addEventListener('change', () => this.toggleGroupMember(item.soundId))
      const name = document.createElement('span')
      name.textContent = sound?.name ?? item.soundId
      label.appendChild(checkbox)
      label.appendChild(name)
      this.els.groupMembers.appendChild(label)
    }
  }

  // A sound belongs to at most one group per preset (see
  // AudioEngine.destinationForSound) - checking it into this group leaves
  // whatever other group it was already in.
  async toggleGroupMember(soundId) {
    const updated = this.groups.map((g) => {
      if (g.id === this.selectedGroupId) {
        const has = g.soundIds.includes(soundId)
        return { ...g, soundIds: has ? g.soundIds.filter((s) => s !== soundId) : [...g.soundIds, soundId] }
      }
      return { ...g, soundIds: g.soundIds.filter((s) => s !== soundId) }
    })
    const saved = await this.api.presets.updateGroups(this.selectedPresetId, updated)
    this.groups = saved?.groups ?? updated
    const local = this.presets.find((p) => p.id === this.selectedPresetId)
    if (local) local.groups = this.groups
    this.renderGroupList()
    this.renderGroupMembers()
    window.dispatchEvent(new CustomEvent('noctivago:sound-groups-changed', { detail: { presetId: this.selectedPresetId } }))
  }

  writeGroupControls(filters) {
    this.els.groupHighpass.value = String(filters.highpassHz)
    this.els.groupLowpass.value = String(filters.lowpassHz)
    this.els.groupGain.value = String(filters.gainDb)
  }

  onGroupEqChange(bands, { selectionOnly = false } = {}) {
    this.syncGroupEqFields()
    if (selectionOnly) return
    this.groupCurrent = { ...this.groupCurrent, eq: bands }
    this.updateGroupDirty()
    this.dispatchGroupPreview(this.groupCurrent)
  }

  syncGroupEqFields() {
    const band = this.groupEq.getSelectedBand()
    const disabled = !band
    for (const el of [this.els.groupEqFreq, this.els.groupEqGain, this.els.groupEqQ, this.els.groupEqType, this.els.groupEqRemove]) {
      el.disabled = disabled
    }
    if (!band) {
      this.els.groupEqFreq.value = ''
      this.els.groupEqGain.value = ''
      this.els.groupEqQ.value = ''
      return
    }
    if (document.activeElement !== this.els.groupEqFreq) this.els.groupEqFreq.value = String(Math.round(band.freqHz))
    if (document.activeElement !== this.els.groupEqGain) this.els.groupEqGain.value = String(band.gainDb)
    if (document.activeElement !== this.els.groupEqQ) this.els.groupEqQ.value = String(band.q)
    this.els.groupEqType.value = band.type ?? 'peaking'
  }

  readGroupControlsAndPreview() {
    this.groupCurrent = {
      ...this.groupCurrent,
      highpassHz: Number(this.els.groupHighpass.value),
      lowpassHz: Number(this.els.groupLowpass.value),
      gainDb: Number(this.els.groupGain.value)
    }
    this.updateGroupLabels()
    this.updateGroupDirty()
    this.dispatchGroupPreview(this.groupCurrent)
  }

  updateGroupLabels() {
    const hp = Number(this.els.groupHighpass.value)
    const lp = Number(this.els.groupLowpass.value)
    const gain = Number(this.els.groupGain.value)
    this.els.groupHighpassValue.textContent = hp > 0 ? `${hp} Hz` : 'Off'
    this.els.groupLowpassValue.textContent = lp < 20000 ? `${lp} Hz` : 'Off'
    this.els.groupGainValue.textContent = `${gain > 0 ? '+' : ''}${gain} dB`
  }

  updateGroupDirty() {
    const group = this.groups.find((g) => g.id === this.selectedGroupId)
    const nameDirty = group && this.els.groupRename.value.trim() && this.els.groupRename.value.trim() !== group.name
    const dirty = Boolean(nameDirty) || !groupFiltersEqual(this.groupCurrent, this.groupSaved)
    this.els.groupSave.disabled = !dirty || !this.selectedGroupId
    this.els.groupSave.textContent = dirty ? 'Save' : 'Saved'
  }

  async saveGroup() {
    if (!this.selectedGroupId) return
    this.els.groupSave.disabled = true
    try {
      const name = this.els.groupRename.value.trim() || 'Group'
      const updated = this.groups.map((g) => (g.id === this.selectedGroupId ? { ...g, name, filters: this.groupCurrent } : g))
      const saved = await this.api.presets.updateGroups(this.selectedPresetId, updated)
      this.groups = saved?.groups ?? updated
      const local = this.presets.find((p) => p.id === this.selectedPresetId)
      if (local) local.groups = this.groups
      const group = this.groups.find((g) => g.id === this.selectedGroupId)
      this.groupSaved = cloneGroupFilters(group?.filters ?? null)
      this.groupCurrent = cloneGroupFilters(this.groupSaved)
      this.els.groupRename.value = group?.name ?? name
      this.writeGroupControls(this.groupCurrent)
      this.groupEq.setBands(this.groupCurrent.eq)
      this.syncGroupEqFields()
      this.updateGroupLabels()
      this.updateGroupDirty()
      this.renderGroupList()
      // A rename here changes what the "Copy filters from…" dropdown shows
      // for this group elsewhere (createGroup reads this.presets, which was
      // just refreshed above) - re-render it so a stale name doesn't linger.
      this.renderGroupCopyFromOptions()
      this.dispatchGroupPreview(this.groupSaved)
      window.dispatchEvent(new CustomEvent('noctivago:sound-groups-changed', { detail: { presetId: this.selectedPresetId } }))
      this.els.groupStatus.textContent = 'Saved.'
    } catch (err) {
      console.error('Preset Remix: group save failed', err)
      this.els.groupStatus.textContent = `Save failed: ${err.message}`
      this.updateGroupDirty()
    }
  }

  async deleteGroup(id = this.selectedGroupId) {
    if (!id || !this.selectedPresetId) return
    const updated = this.groups.filter((g) => g.id !== id)
    const saved = await this.api.presets.updateGroups(this.selectedPresetId, updated)
    this.groups = saved?.groups ?? updated
    const local = this.presets.find((p) => p.id === this.selectedPresetId)
    if (local) local.groups = this.groups
    if (id === this.selectedGroupId) {
      this.selectedGroupId = null
      this.els.groupEditor.classList.add('hidden')
    }
    this.renderGroupList()
    this.renderGroupCopyFromOptions()
    window.dispatchEvent(new CustomEvent('noctivago:sound-groups-changed', { detail: { presetId: this.selectedPresetId } }))
  }

  async createGroup() {
    if (!this.selectedPresetId) return
    const name = this.els.groupName.value.trim() || 'Group'
    const copyKey = this.els.groupCopyFrom.value
    let filters = cloneGroupFilters(null)
    if (copyKey) {
      const [presetId, groupId] = copyKey.split('::')
      const source = this.presets.find((p) => p.id === presetId)?.groups?.find((g) => g.id === groupId)
      if (source) filters = cloneGroupFilters(source.filters)
    }
    const updated = [...this.groups, { name, soundIds: [], filters }]
    const saved = await this.api.presets.updateGroups(this.selectedPresetId, updated)
    this.groups = saved?.groups ?? updated
    const local = this.presets.find((p) => p.id === this.selectedPresetId)
    if (local) local.groups = this.groups
    this.els.groupName.value = ''
    this.els.groupCopyFrom.value = ''
    this.renderGroupCopyFromOptions()
    this.renderGroupList()
    window.dispatchEvent(new CustomEvent('noctivago:sound-groups-changed', { detail: { presetId: this.selectedPresetId } }))
    const created = this.groups[this.groups.length - 1]
    if (created) this.selectGroup(created.id)
  }

  dispatchGroupPreview(filters) {
    if (!this.selectedPresetId || !this.selectedGroupId) return
    window.dispatchEvent(
      new CustomEvent('noctivago:sound-group-preview', {
        detail: { presetId: this.selectedPresetId, groupId: this.selectedGroupId, filters: cloneGroupFilters(filters) }
      })
    )
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
