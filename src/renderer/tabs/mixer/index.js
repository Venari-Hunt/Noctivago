import { AudioEngine } from '../../audio/AudioEngine.js'
import { LocalFileSoundSource } from '../../audio/SoundSource.js'
import { BufferSoundSource } from '../../audio/BufferSoundSource.js'
import { renderSoundList } from '../../ui/SoundList.js'
import { renderPresetList } from '../../ui/PresetsModal.js'

const api = window.noctivago
const engine = new AudioEngine()

const state = {
  library: [],
  sources: new Map(),
  volumes: new Map(),
  included: new Set(),
  playing: new Set(),
  loading: new Set(),
  errors: new Map()
}

const els = {
  soundList: null,
  emptyState: null,
  globalPlayPause: document.getElementById('global-play-pause'),
  globalVolume: document.getElementById('global-volume'),
  addSoundBtn: document.getElementById('add-sound'),
  addSoundMenu: document.getElementById('add-sound-menu'),
  addSoundFileItem: document.getElementById('add-sound-file'),
  addSoundFolderPresetItem: document.getElementById('add-sound-folder-preset'),
  openPresetsBtn: document.getElementById('open-presets'),

  addSoundDialog: document.getElementById('add-sound-dialog'),
  addSoundName: document.getElementById('add-sound-name'),
  addSoundKeepCopy: document.getElementById('add-sound-keep-copy'),
  addSoundCancel: document.getElementById('add-sound-cancel'),
  addSoundConfirm: document.getElementById('add-sound-confirm'),

  addFolderPresetDialog: document.getElementById('add-folder-preset-dialog'),
  addFolderPresetName: document.getElementById('add-folder-preset-name'),
  addFolderPresetKeepCopy: document.getElementById('add-folder-preset-keep-copy'),
  addFolderPresetStatus: document.getElementById('add-folder-preset-status'),
  addFolderPresetCancel: document.getElementById('add-folder-preset-cancel'),
  addFolderPresetConfirm: document.getElementById('add-folder-preset-confirm'),

  presetsModal: document.getElementById('presets-modal'),
  newPresetName: document.getElementById('new-preset-name'),
  savePresetBtn: document.getElementById('save-preset'),
  presetSaveHint: document.getElementById('preset-save-hint'),
  presetList: document.getElementById('preset-list'),
  presetsClose: document.getElementById('presets-close')
}

let pickedFile = null
let pickedFolder = null

function showModal(el) {
  el.classList.remove('hidden')
}

function hideModal(el) {
  el.classList.add('hidden')
}

function refreshGlobalButton() {
  els.globalPlayPause.textContent = state.playing.size > 0 ? 'Pause all' : 'Play all'
}

function render() {
  renderSoundList(els.soundList, els.emptyState, state.library, state, {
    onToggleIncluded: toggleIncluded,
    onVolumeChange: changeVolume,
    onRemove: removeSound,
    onRelink: relinkSound,
    onRename: renameSound
  })
  refreshGlobalButton()
}

async function renameSound(id, name) {
  await api.library.rename(id, name)
  await refreshList()
}

// Bug fix: saving new filters or a new trim in the Remix plugin updates the
// library entry, but a sound already in the mix already has a live source
// object (state.sources keeps it around across pause too, not just while
// actively playing) built from the *old* values - nothing was ever telling
// that live source about the change. This reconciles every live source
// against the freshly-fetched entry on each refresh: a stream-mode source
// gets its filters/loop points updated smoothly in place, and a mismatch in
// which *kind* of source an entry should now use (e.g. a clip just got
// baked, or edited without re-baking so it's no longer buffer-eligible)
// swaps the source entirely, since BufferSoundSource has no live-update path
// for baked-in loop points (see its setLoopPoints no-op).
function reconcileSource(entry) {
  const source = state.sources.get(entry.id)
  if (!source) return

  const shouldBeBuffer = loopClipEligible(entry)
  const isBuffer = source instanceof BufferSoundSource

  if (shouldBeBuffer !== isBuffer) {
    swapSource(entry)
    return
  }

  if (!isBuffer) {
    if (!source.hasFilters(entry.filters)) source.setFilters(entry.filters)
    if (!source.hasLoopPoints(entry.loopStart, entry.loopEnd)) source.setLoopPoints(entry.loopStart, entry.loopEnd)
  }
}

function swapSource(entry) {
  const wasPlaying = state.playing.has(entry.id)
  state.sources.get(entry.id)?.dispose()
  state.sources.delete(entry.id)
  if (wasPlaying) {
    state.playing.delete(entry.id)
    startPlayback(entry.id, entry)
  }
}

async function refreshList() {
  state.library = await api.library.list()
  for (const entry of state.library) reconcileSource(entry)
  render()
}

function loopClipEligible(entry) {
  return (
    entry.loopClipReady === true &&
    entry.loopClipStart === entry.loopStart &&
    entry.loopClipEnd === entry.loopEnd &&
    JSON.stringify(entry.loopClipFilters) === JSON.stringify(entry.filters)
  )
}

// Tries the small pre-rendered loop clip (native, sample-accurate looping;
// trimmed and filtered by the Remix plugin, see plugins/editor/). Returns
// null on any failure so the caller falls back to streaming the original
// file — this is what keeps the feature safe even if ffmpeg is missing or
// the clip is corrupt.
async function tryCreateBufferSource(entry) {
  try {
    const response = await fetch(`sound://${entry.id}?variant=clip`)
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await engine.context.decodeAudioData(arrayBuffer)
    return new BufferSoundSource(engine, { audioBuffer, volume: state.volumes.get(entry.id) ?? 0.7 })
  } catch (err) {
    console.error('Failed to decode loop clip, falling back to streaming', entry.name, err)
    return null
  }
}

async function getOrCreateSource(entry) {
  let source = state.sources.get(entry.id)
  if (source) return source

  if (loopClipEligible(entry)) {
    source = await tryCreateBufferSource(entry)
  }

  if (!source) {
    source = new LocalFileSoundSource(engine, {
      soundId: entry.id,
      loopStart: entry.loopStart,
      loopEnd: entry.loopEnd,
      volume: state.volumes.get(entry.id) ?? 0.7,
      filters: entry.filters
    })

    const duration = await source.waitForMetadata()
    if (!Number.isFinite(duration)) {
      source.dispose()
      throw new Error('Unable to read audio metadata')
    }

    if (entry.durationSeconds == null) {
      await api.library.updateMeta(entry.id, { durationSeconds: duration })
      entry.durationSeconds = duration
      if (entry.loopEnd == null) {
        entry.loopEnd = duration
        source.setLoopPoints(entry.loopStart, duration)
      }
    }
  }

  state.sources.set(entry.id, source)
  return source
}

// Starts actual playback of a sound and marks it included+playing. Used by
// the per-sound toggle, "Play all", and preset loading.
async function startPlayback(id, entry) {
  state.errors.delete(id)
  state.loading.add(id)
  render()
  try {
    const source = await getOrCreateSource(entry)
    if (!state.volumes.has(id)) state.volumes.set(id, 0.7)
    source.setVolume(state.volumes.get(id))
    await source.play()
    state.playing.add(id)
    state.included.add(id)
  } catch (err) {
    console.error('Failed to play sound', entry.name, err)
    state.errors.set(id, 'Could not decode this audio file.')
    state.included.delete(id)
  } finally {
    state.loading.delete(id)
    render()
  }
}

function stopPlayback(id) {
  state.sources.get(id)?.pause()
  state.playing.delete(id)
}

// The per-sound button toggles mix membership. Turning a sound on plays it
// immediately; turning it off stops it. This stays in sync through a global
// pause because the button reflects `included`, not `playing`.
async function toggleIncluded(id) {
  const entry = state.library.find((s) => s.id === id)
  if (!entry || entry.status === 'missing' || state.loading.has(id)) return

  if (state.included.has(id)) {
    state.included.delete(id)
    stopPlayback(id)
    render()
    return
  }

  await engine.resume()
  await startPlayback(id, entry)
}

function changeVolume(id, volume) {
  state.volumes.set(id, volume)
  state.sources.get(id)?.setVolume(volume)
}

async function removeSound(id) {
  state.sources.get(id)?.dispose()
  state.sources.delete(id)
  state.playing.delete(id)
  state.included.delete(id)
  state.volumes.delete(id)
  await api.library.remove(id)
  await refreshList()
}

async function relinkSound(id) {
  await api.library.relink(id)
  await refreshList()
}

// Named (not inline) so the tray's "Play / Pause" menu item can trigger
// exactly the same behavior as clicking the toolbar button, see mount()'s
// window.noctivago.tray.onTogglePlayPause below.
async function toggleGlobalPlayback() {
  if (state.playing.size > 0) {
    for (const id of [...state.playing]) stopPlayback(id)
    render()
  } else {
    await engine.resume()
    for (const id of [...state.included]) {
      const entry = state.library.find((s) => s.id === id)
      if (entry) await startPlayback(id, entry)
    }
  }
}

els.globalPlayPause.addEventListener('click', toggleGlobalPlayback)

els.globalVolume.addEventListener('input', () => {
  const volume = Number(els.globalVolume.value) / 100
  const now = engine.context.currentTime
  engine.masterGain.gain.cancelScheduledValues(now)
  engine.masterGain.gain.linearRampToValueAtTime(volume, now + 0.05)
})

function closeAddSoundMenu() {
  els.addSoundMenu.classList.add('hidden')
  els.addSoundBtn.setAttribute('aria-expanded', 'false')
}

els.addSoundBtn.addEventListener('click', (evt) => {
  evt.stopPropagation()
  const isOpen = !els.addSoundMenu.classList.contains('hidden')
  if (isOpen) closeAddSoundMenu()
  else {
    els.addSoundMenu.classList.remove('hidden')
    els.addSoundBtn.setAttribute('aria-expanded', 'true')
  }
})

document.addEventListener('click', (evt) => {
  if (!els.addSoundMenu.contains(evt.target) && evt.target !== els.addSoundBtn) closeAddSoundMenu()
})

document.addEventListener('keydown', (evt) => {
  if (evt.key === 'Escape') closeAddSoundMenu()
})

els.addSoundFileItem.addEventListener('click', async () => {
  closeAddSoundMenu()
  const file = await api.library.pickFile()
  if (!file) return
  pickedFile = file
  els.addSoundName.value = file.name
  els.addSoundKeepCopy.checked = false
  showModal(els.addSoundDialog)
})

els.addSoundCancel.addEventListener('click', () => {
  pickedFile = null
  hideModal(els.addSoundDialog)
})

els.addSoundConfirm.addEventListener('click', async () => {
  if (!pickedFile) return
  const name = els.addSoundName.value.trim() || pickedFile.name
  await api.library.addSound({
    path: pickedFile.path,
    name,
    keepCopy: els.addSoundKeepCopy.checked
  })
  pickedFile = null
  hideModal(els.addSoundDialog)
  await refreshList()
})

els.addSoundFolderPresetItem.addEventListener('click', async () => {
  closeAddSoundMenu()
  const folder = await api.library.pickFolder()
  if (!folder) return
  pickedFolder = folder
  const folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? 'New preset'
  els.addFolderPresetName.value = folderName
  els.addFolderPresetKeepCopy.checked = false
  els.addFolderPresetStatus.textContent = ''
  showModal(els.addFolderPresetDialog)
})

els.addFolderPresetCancel.addEventListener('click', () => {
  pickedFolder = null
  hideModal(els.addFolderPresetDialog)
})

els.addFolderPresetConfirm.addEventListener('click', async () => {
  if (!pickedFolder) return
  const name = els.addFolderPresetName.value.trim()
  if (!name) {
    els.addFolderPresetStatus.textContent = 'Enter a preset name first.'
    return
  }

  els.addFolderPresetConfirm.disabled = true
  els.addFolderPresetStatus.textContent = 'Adding sounds…'

  const added = await api.library.addFolderSounds(pickedFolder, { keepCopy: els.addFolderPresetKeepCopy.checked })
  if (added.length === 0) {
    els.addFolderPresetConfirm.disabled = false
    els.addFolderPresetStatus.textContent = 'No audio files found directly inside that folder.'
    return
  }

  await api.presets.save({
    name,
    sounds: added.map((entry) => ({ soundId: entry.id, volume: 0.7 }))
  })

  els.addFolderPresetConfirm.disabled = false
  pickedFolder = null
  hideModal(els.addFolderPresetDialog)
  await refreshList()
})

async function refreshPresetList() {
  const presets = await api.presets.list()
  renderPresetList(els.presetList, presets, {
    onLoad: loadPreset,
    onDelete: deletePreset
  })
}

els.openPresetsBtn.addEventListener('click', async () => {
  els.presetSaveHint.textContent = ''
  await refreshPresetList()
  showModal(els.presetsModal)
})

els.presetsClose.addEventListener('click', () => hideModal(els.presetsModal))

els.savePresetBtn.addEventListener('click', async () => {
  const name = els.newPresetName.value.trim()
  if (!name) {
    els.newPresetName.focus()
    els.newPresetName.placeholder = 'Enter a name first'
    return
  }
  if (state.included.size === 0) {
    els.presetSaveHint.textContent = 'Add at least one sound to the mix before saving a preset.'
    return
  }
  els.presetSaveHint.textContent = ''
  const sounds = [...state.included].map((id) => ({
    soundId: id,
    volume: state.volumes.get(id) ?? 0.7
  }))
  await api.presets.save({ name, sounds })
  els.newPresetName.value = ''
  await refreshPresetList()
})

// Only touches sounds that actually changed between the current mix and the
// preset being loaded, so sounds common to both keep playing uninterrupted
// (just a volume update) instead of being stopped and immediately restarted.
async function loadPreset(preset) {
  const newIds = new Set(preset.sounds.map((s) => s.soundId))

  for (const id of [...state.included]) {
    if (!newIds.has(id)) {
      state.included.delete(id)
      stopPlayback(id)
    }
  }

  await engine.resume()

  for (const item of preset.sounds) {
    const entry = state.library.find((s) => s.id === item.soundId)
    if (!entry || entry.status === 'missing') continue
    state.volumes.set(item.soundId, item.volume)
    if (state.playing.has(item.soundId)) {
      state.sources.get(item.soundId)?.setVolume(item.volume)
    } else {
      await startPlayback(item.soundId, entry)
    }
  }

  hideModal(els.presetsModal)
  render()
}

async function deletePreset(id) {
  await api.presets.delete(id)
  await refreshPresetList()
}

// Re-reads the library on every return to this tab, so edits made in
// another tab (e.g. trim/filters saved in the Remix plugin) take effect
// without requiring an unrelated action like adding or removing a sound to
// trigger a refresh. Cheap (one IPC call), and reconcileSource (called from
// refreshList for every entry) is what actually pushes changed filters/loop
// points into any already-playing or already-paused-but-cached source.
export function onShow() {
  refreshList()
}

export function mount(container) {
  container.innerHTML = `
    <ul id="sound-list" class="sound-list"></ul>
    <p id="empty-state" class="empty-state">No sounds yet. Click "Add Sound" to import one.</p>
  `
  els.soundList = container.querySelector('#sound-list')
  els.emptyState = container.querySelector('#empty-state')
  refreshList()
  // mount() only ever runs once (TabHost lazily mounts each tab a single
  // time), so this is a one-time listener registration, not a per-mount leak.
  window.noctivago.tray.onTogglePlayPause(toggleGlobalPlayback)
  // Lets a sound auto-imported by a watched folder show up immediately even
  // if the user never leaves the Mixer tab (onShow's refresh alone would
  // only catch it on the next tab switch).
  window.noctivago.library.onChanged(refreshList)
}
