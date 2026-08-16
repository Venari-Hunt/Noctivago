import { AudioEngine } from '../../audio/AudioEngine.js'
import { LocalFileSoundSource } from '../../audio/SoundSource.js'
import { BufferSoundSource } from '../../audio/BufferSoundSource.js'
import { renderSoundList } from '../../ui/SoundList.js'
import { renderPresetList } from '../../ui/PresetsModal.js'
import { openWatchFolderPicker } from '../../core/WatchFolderDialog.js'
import { MAX_BUFFER_CLIP_SECONDS } from '../../../shared/constants.js'

const api = window.noctivago
const engine = new AudioEngine()

const state = {
  library: [],
  searchQuery: '',
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
  addSoundWatchFolderItem: document.getElementById('add-sound-watch-folder'),
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
// Ids currently being auto-baked (see maybeAutoBake) - prevents firing a
// second concurrent bake for the same sound if getOrCreateSource runs again
// (e.g. a rapid re-toggle) before the first one finishes.
const autoBaking = new Set()

function showModal(el) {
  el.classList.remove('hidden')
}

function hideModal(el) {
  el.classList.add('hidden')
}

function refreshGlobalButton() {
  els.globalPlayPause.textContent = state.playing.size > 0 ? 'Pause all' : 'Play all'
}

const EMPTY_LIBRARY_TEXT = 'No sounds yet. Click "Add Sound" to import one.'
const NO_SEARCH_MATCHES_TEXT = 'No sounds match your search.'

function visibleLibrary() {
  const query = state.searchQuery.trim().toLowerCase()
  if (!query) return state.library
  return state.library.filter((entry) => entry.name.toLowerCase().includes(query))
}

function render() {
  const visible = visibleLibrary()
  els.emptyState.textContent = state.searchQuery.trim() && state.library.length > 0 ? NO_SEARCH_MATCHES_TEXT : EMPTY_LIBRARY_TEXT
  renderSoundList(els.soundList, els.emptyState, visible, state, {
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

// Snapshot of the exact loop points + filters a BufferSoundSource's decoded
// AudioBuffer was baked from - stashed on the source at creation time (see
// tryCreateBufferSource) and compared against the entry's *current* values
// below. Re-saving a sound that was already buffer-eligible (trim it again,
// tweak a filter again) stays buffer-eligible both before and after - the
// boolean "should this be buffer mode" never flips - so without this check
// reconcileSource had no way to notice the live AudioBuffer itself had gone
// stale, and kept playing the *previous* bake indefinitely. Matches
// loopClipEligible's own comparison fields.
function bufferBakeSnapshot(entry) {
  return JSON.stringify({
    loopStart: entry.loopStart,
    loopEnd: entry.loopEnd,
    filters: entry.filters,
    crossfadeSeconds: entry.crossfadeSeconds
  })
}

// BUG FIX (2026-08-16): saving new filters or a new trim in the Remix plugin
// updates the library entry, but a sound already in the mix already has a
// live source object (state.sources keeps it around across pause too, not
// just while actively playing) built from the *old* values - nothing was
// ever telling that live source about the change. This reconciles every
// live source against the freshly-fetched entry on each refresh: a
// stream-mode source gets its filters/loop points updated smoothly in
// place; a mismatch in which *kind* of source an entry should now use (e.g.
// a clip just got baked, or edited without re-baking so it's no longer
// buffer-eligible) swaps the source entirely, since BufferSoundSource has
// no live-update path for baked-in loop points (see its setLoopPoints
// no-op) - and neither does re-baking *again* while already in buffer mode,
// which is exactly the case the boolean-only check above originally missed
// (reported live: re-trimming an already-baked sound kept playing the old
// clip until a full app restart forced a fresh decode).
function reconcileSource(entry) {
  const source = state.sources.get(entry.id)
  if (!source) return

  const shouldBeBuffer = loopClipEligible(entry)
  const isBuffer = source instanceof BufferSoundSource
  const bufferIsStale = isBuffer && source.bakeSnapshot !== bufferBakeSnapshot(entry)

  if (shouldBeBuffer !== isBuffer || bufferIsStale) {
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
  for (const entry of state.library) {
    // Seeds state.volumes from the persisted value the first time this
    // entry is seen in a session (e.g. right after app startup, when
    // state.volumes is empty) - never overwrites a value already set this
    // session, so it doesn't fight an in-progress slider drag.
    if (!state.volumes.has(entry.id)) state.volumes.set(entry.id, entry.volume ?? 0.7)
    reconcileSource(entry)
  }
  render()
}

function loopClipEligible(entry) {
  return (
    entry.loopClipReady === true &&
    entry.loopClipStart === entry.loopStart &&
    entry.loopClipEnd === entry.loopEnd &&
    JSON.stringify(entry.loopClipFilters) === JSON.stringify(entry.filters) &&
    entry.loopClipCrossfadeSeconds === entry.crossfadeSeconds
  )
}

// BUG FIX: a sound never opened and saved in the Remix plugin had no baked
// loop clip at all, so it always hard-looped the *entire* file via
// LocalFileSoundSource's plain seek-back - fine if the file happens to
// already loop cleanly on its own, audibly abrupt otherwise (that's the
// whole reason the crossfaded bake exists). This used to only matter for
// sounds someone manually dragged into Remix; watch-folder auto-import (and
// folder-as-preset, and a plain add) never touch Remix at all, so
// bulk-imported sounds could stay permanently un-smoothed - reported by the
// user as "loops are REALLY abrupt" right after watch-folder shipped, since
// bulk-importing without ever visiting Remix went from rare to the default
// way sounds get added. Bakes a full-file loop clip automatically the first
// time a never-baked, cap-eligible sound actually plays - the exact same
// renderLoopClip Remix's own Save button calls, just triggered implicitly.
// reconcileSource (already run on every refreshList) picks up the result
// and swaps the live source over to BufferSoundSource with zero additional
// code, same as any other filter/loop-point change.
function maybeAutoBake(entry) {
  if (entry.loopClipReady || autoBaking.has(entry.id)) return
  const loopEnd = entry.loopEnd ?? entry.durationSeconds
  if (loopEnd == null) return
  if (loopEnd - entry.loopStart > MAX_BUFFER_CLIP_SECONDS) return

  autoBaking.add(entry.id)
  api.audio
    .renderLoopClip(entry.id, { loopStart: entry.loopStart, loopEnd, filters: entry.filters, crossfadeSeconds: entry.crossfadeSeconds })
    .then((result) => {
      if (result.ok) refreshList()
    })
    .catch((err) => console.error('Auto-bake failed', entry.name, err))
    .finally(() => autoBaking.delete(entry.id))
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
    const source = new BufferSoundSource(engine, { audioBuffer, volume: state.volumes.get(entry.id) ?? 0.7 })
    source.bakeSnapshot = bufferBakeSnapshot(entry)
    return source
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

    maybeAutoBake(entry)
  }

  state.sources.set(entry.id, source)
  return source
}

// Persists which sounds are in the mix and whether the mix is currently
// playing at all, so a restart can rebuild the same state - see
// maybeResumeOnLaunch. Called on every transition rather than once at quit
// time, since there's no reliable synchronous main<->renderer round-trip at
// the exact moment the app closes; whatever these last said is already
// correct by the time it matters.
function persistIncluded(id, included) {
  api.library.updateIncluded(id, included)
}

function persistPlayingState() {
  api.settings.setWasPlayingOnClose(state.playing.size > 0)
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
    persistIncluded(id, true)
    persistPlayingState()
  } catch (err) {
    console.error('Failed to play sound', entry.name, err)
    state.errors.set(id, 'Could not decode this audio file.')
    state.included.delete(id)
    persistIncluded(id, false)
  } finally {
    state.loading.delete(id)
    render()
  }
}

function stopPlayback(id) {
  state.sources.get(id)?.pause()
  state.playing.delete(id)
  persistPlayingState()
}

// The per-sound button toggles mix membership. Turning a sound on plays it
// immediately; turning it off stops it. This stays in sync through a global
// pause because the button reflects `included`, not `playing`.
async function toggleIncluded(id) {
  const entry = state.library.find((s) => s.id === id)
  if (!entry || entry.status === 'missing' || state.loading.has(id)) return

  if (state.included.has(id)) {
    state.included.delete(id)
    persistIncluded(id, false)
    stopPlayback(id)
    render()
    return
  }

  await engine.resume()
  await startPlayback(id, entry)
}

// BUG FIX: per-sound volume was tracked only in this in-memory Map, never
// persisted - every app restart silently reset every sound's volume back to
// the 0.7 default, reported directly by the user. The live audio update
// stays immediate (every slider tick); the actual disk write is debounced
// since a drag fires many 'input' events per second and there's no need to
// hit electron-store's synchronous file write that often.
const volumeSaveTimers = new Map()
const VOLUME_SAVE_DEBOUNCE_MS = 400

function changeVolume(id, volume) {
  state.volumes.set(id, volume)
  state.sources.get(id)?.setVolume(volume)

  clearTimeout(volumeSaveTimers.get(id))
  volumeSaveTimers.set(
    id,
    setTimeout(() => {
      volumeSaveTimers.delete(id)
      api.library.updateVolume(id, volume)
    }, VOLUME_SAVE_DEBOUNCE_MS)
  )
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

els.addSoundWatchFolderItem.addEventListener('click', () => {
  closeAddSoundMenu()
  openWatchFolderPicker()
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
      persistIncluded(id, false)
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

// If the app was closed while something was playing, resume automatically
// on next launch instead of opening to a silent, empty-feeling mix - user-
// requested directly. Reads each sound's persisted `included` flag (see
// persistIncluded); only ever called once, right after mount()'s initial
// library load, not on every later refreshList() (tab-switch refreshes
// etc.), which would otherwise re-trigger this every time the user comes
// back to the Mixer tab.
async function maybeResumeOnLaunch() {
  const settings = await api.settings.get()
  if (!settings.wasPlayingOnClose) return

  const toResume = state.library.filter((entry) => entry.included && entry.status !== 'missing')
  if (toResume.length === 0) return

  await engine.resume()
  for (const entry of toResume) {
    await startPlayback(entry.id, entry)
  }
}

export function mount(container) {
  container.innerHTML = `
    <input id="sound-search" type="text" class="sound-search" placeholder="Search sounds…" />
    <ul id="sound-list" class="sound-list"></ul>
    <p id="empty-state" class="empty-state">No sounds yet. Click "Add Sound" to import one.</p>
  `
  els.soundSearch = container.querySelector('#sound-search')
  els.soundList = container.querySelector('#sound-list')
  els.emptyState = container.querySelector('#empty-state')
  els.soundSearch.addEventListener('input', () => {
    state.searchQuery = els.soundSearch.value
    render()
  })
  refreshList().then(maybeResumeOnLaunch)
  // mount() only ever runs once (TabHost lazily mounts each tab a single
  // time), so this is a one-time listener registration, not a per-mount leak.
  window.noctivago.tray.onTogglePlayPause(toggleGlobalPlayback)
  // Lets a sound auto-imported by a watched folder show up immediately even
  // if the user never leaves the Mixer tab (onShow's refresh alone would
  // only catch it on the next tab switch).
  window.noctivago.library.onChanged(refreshList)
}
