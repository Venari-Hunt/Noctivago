import { AudioEngine } from './audio/AudioEngine.js'
import { LocalFileSoundSource } from './audio/SoundSource.js'
import { renderSoundList } from './ui/SoundList.js'
import { renderPresetList } from './ui/PresetsModal.js'
import { createLoopEditorController } from './ui/LoopEditor.js'

const api = window.noctivago
const engine = new AudioEngine()

const state = {
  library: [],
  sources: new Map(),
  volumes: new Map(),
  playing: new Set(),
  loading: new Set(),
  errors: new Map()
}

const els = {
  soundList: document.getElementById('sound-list'),
  emptyState: document.getElementById('empty-state'),
  globalPlayPause: document.getElementById('global-play-pause'),
  addSoundBtn: document.getElementById('add-sound'),
  openPresetsBtn: document.getElementById('open-presets'),

  addSoundDialog: document.getElementById('add-sound-dialog'),
  addSoundName: document.getElementById('add-sound-name'),
  addSoundKeepCopy: document.getElementById('add-sound-keep-copy'),
  addSoundCancel: document.getElementById('add-sound-cancel'),
  addSoundConfirm: document.getElementById('add-sound-confirm'),

  presetsModal: document.getElementById('presets-modal'),
  newPresetName: document.getElementById('new-preset-name'),
  savePresetBtn: document.getElementById('save-preset'),
  presetSaveHint: document.getElementById('preset-save-hint'),
  presetList: document.getElementById('preset-list'),
  presetsClose: document.getElementById('presets-close'),

  loopEditorModal: document.getElementById('loop-editor-modal'),
  loopEditorTitle: document.getElementById('loop-editor-title'),
  loopEditorCanvas: document.getElementById('loop-editor-canvas'),
  loopEditorPreview: document.getElementById('loop-editor-preview'),
  loopEditorStopPreview: document.getElementById('loop-editor-stop-preview'),
  loopEditorCancel: document.getElementById('loop-editor-cancel'),
  loopEditorSave: document.getElementById('loop-editor-save')
}

let pickedFile = null
let loopEditorSoundId = null
let loopEditorController = null
let previewSource = null

function showModal(el) {
  el.classList.remove('hidden')
}

function hideModal(el) {
  el.classList.add('hidden')
}

function refreshGlobalButton() {
  els.globalPlayPause.textContent = engine.context.state === 'running' ? 'Pause all' : 'Play all'
}

function render() {
  renderSoundList(els.soundList, els.emptyState, state.library, state, {
    onTogglePlay: toggleSoundPlayback,
    onVolumeChange: changeVolume,
    onOpenLoopEditor: openLoopEditor,
    onRemove: removeSound,
    onRelink: relinkSound
  })
  refreshGlobalButton()
}

async function refreshList() {
  state.library = await api.library.list()
  render()
}

async function getOrCreateSource(entry) {
  let source = state.sources.get(entry.id)
  if (source) return source

  source = new LocalFileSoundSource(engine, {
    soundId: entry.id,
    loopStart: entry.loopStart,
    loopEnd: entry.loopEnd,
    volume: state.volumes.get(entry.id) ?? 0.7
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

  state.sources.set(entry.id, source)
  return source
}

async function toggleSoundPlayback(id) {
  const entry = state.library.find((s) => s.id === id)
  if (!entry || entry.status === 'missing' || state.loading.has(id)) return

  await engine.resume()

  if (state.playing.has(id)) {
    state.sources.get(id)?.pause()
    state.playing.delete(id)
    render()
    return
  }

  state.errors.delete(id)
  state.loading.add(id)
  render()
  try {
    const source = await getOrCreateSource(entry)
    if (!state.volumes.has(id)) state.volumes.set(id, 0.7)
    await source.play()
    state.playing.add(id)
  } catch (err) {
    console.error('Failed to play sound', entry.name, err)
    state.errors.set(id, 'Could not decode this audio file.')
  } finally {
    state.loading.delete(id)
    render()
  }
}

function changeVolume(id, volume) {
  state.volumes.set(id, volume)
  state.sources.get(id)?.setVolume(volume)
}

async function removeSound(id) {
  state.sources.get(id)?.dispose()
  state.sources.delete(id)
  state.playing.delete(id)
  state.volumes.delete(id)
  await api.library.remove(id)
  await refreshList()
}

async function relinkSound(id) {
  await api.library.relink(id)
  await refreshList()
}

els.globalPlayPause.addEventListener('click', async () => {
  if (engine.context.state === 'running') {
    await engine.suspendAll()
  } else {
    await engine.resume()
  }
  render()
})

els.addSoundBtn.addEventListener('click', async () => {
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
  if (state.playing.size === 0) {
    els.presetSaveHint.textContent = 'Play at least one sound before saving a preset.'
    return
  }
  els.presetSaveHint.textContent = ''
  const sounds = [...state.playing].map((id) => ({
    soundId: id,
    volume: state.volumes.get(id) ?? 0.7
  }))
  await api.presets.save({ name, sounds })
  els.newPresetName.value = ''
  await refreshPresetList()
})

async function loadPreset(preset) {
  for (const id of [...state.playing]) {
    await toggleSoundPlayback(id)
  }
  hideModal(els.presetsModal)
  await engine.resume()

  for (const item of preset.sounds) {
    const entry = state.library.find((s) => s.id === item.soundId)
    if (!entry || entry.status === 'missing') continue
    state.volumes.set(item.soundId, item.volume)
    try {
      const source = await getOrCreateSource(entry)
      source.setVolume(item.volume)
      await source.play()
      state.playing.add(item.soundId)
    } catch (err) {
      console.error('Failed to play preset sound', entry.name, err)
      state.errors.set(item.soundId, 'Could not decode this audio file.')
    }
  }
  render()
}

async function deletePreset(id) {
  await api.presets.delete(id)
  await refreshPresetList()
}

async function getDuration(entry) {
  if (entry.durationSeconds != null) return entry.durationSeconds
  await getOrCreateSource(entry)
  if (entry.durationSeconds == null) throw new Error('Unable to read audio metadata')
  return entry.durationSeconds
}

async function openLoopEditor(id) {
  const entry = state.library.find((s) => s.id === id)
  if (!entry || entry.status === 'missing' || state.loading.has(id)) return
  loopEditorSoundId = id

  state.errors.delete(id)
  state.loading.add(id)
  render()
  let duration
  try {
    duration = await getDuration(entry)
  } catch (err) {
    console.error('Failed to read metadata for loop editor', entry.name, err)
    state.errors.set(id, 'Could not read this audio file.')
    return
  } finally {
    state.loading.delete(id)
    render()
  }

  els.loopEditorTitle.textContent = `Trim loop — ${entry.name}`

  if (!loopEditorController) {
    loopEditorController = createLoopEditorController(els.loopEditorCanvas)
  }
  loopEditorController.load(duration, entry.loopStart, entry.loopEnd ?? duration)
  showModal(els.loopEditorModal)
}

function stopPreview() {
  if (!previewSource) return
  previewSource.dispose()
  previewSource = null
}

els.loopEditorPreview.addEventListener('click', async () => {
  if (!loopEditorController || !loopEditorSoundId) return
  stopPreview()
  const { loopStart, loopEnd } = loopEditorController.getLoopPoints()

  await engine.resume()
  previewSource = new LocalFileSoundSource(engine, {
    soundId: loopEditorSoundId,
    loopStart,
    loopEnd,
    volume: 0.7
  })
  try {
    await previewSource.play()
  } catch (err) {
    console.error('Failed to preview loop', err)
    stopPreview()
  }
})

els.loopEditorStopPreview.addEventListener('click', stopPreview)

els.loopEditorCancel.addEventListener('click', () => {
  stopPreview()
  hideModal(els.loopEditorModal)
})

els.loopEditorSave.addEventListener('click', async () => {
  if (!loopEditorController || !loopEditorSoundId) return
  const { loopStart, loopEnd } = loopEditorController.getLoopPoints()
  await api.library.updateLoopPoints(loopEditorSoundId, { loopStart, loopEnd })
  stopPreview()

  const entry = state.library.find((s) => s.id === loopEditorSoundId)
  if (entry) {
    entry.loopStart = loopStart
    entry.loopEnd = loopEnd
    state.sources.get(loopEditorSoundId)?.setLoopPoints(loopStart, loopEnd)
  }

  hideModal(els.loopEditorModal)
  render()
})

refreshList()
