import { AudioEngine } from './audio/AudioEngine.js'
import { LocalFileSoundSource } from './audio/SoundSource.js'
import { BufferSoundSource } from './audio/BufferSoundSource.js'
import { renderSoundList } from './ui/SoundList.js'
import { renderPresetList } from './ui/PresetsModal.js'
import { createLoopEditorController } from './ui/LoopEditor.js'
import { formatDuration, parseDuration } from './util/time.js'
import { MAX_BUFFER_CLIP_SECONDS } from '../shared/constants.js'

const api = window.noctivago
const engine = new AudioEngine()

const waveformPeaksCache = new Map()

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
  soundList: document.getElementById('sound-list'),
  emptyState: document.getElementById('empty-state'),
  globalPlayPause: document.getElementById('global-play-pause'),
  globalVolume: document.getElementById('global-volume'),
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
  loopEditorWaveformStatus: document.getElementById('loop-editor-waveform-status'),
  loopEditorStartInput: document.getElementById('loop-editor-start-input'),
  loopEditorEndInput: document.getElementById('loop-editor-end-input'),
  loopEditorPlayPause: document.getElementById('loop-editor-play-pause'),
  loopEditorCancel: document.getElementById('loop-editor-cancel'),
  loopEditorSave: document.getElementById('loop-editor-save')
}

let pickedFile = null
let loopEditorSoundId = null
let loopEditorController = null
let previewSource = null
let previewRafId = null

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

function loopClipEligible(entry) {
  return entry.loopClipReady === true && entry.loopClipStart === entry.loopStart && entry.loopClipEnd === entry.loopEnd
}

// Tries the small pre-rendered loop clip (native, sample-accurate looping).
// Returns null on any failure so the caller falls back to streaming the
// original file — this is what keeps the feature safe even if ffmpeg is
// missing or the clip is corrupt.
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

els.globalPlayPause.addEventListener('click', async () => {
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
})

els.globalVolume.addEventListener('input', () => {
  const volume = Number(els.globalVolume.value) / 100
  const now = engine.context.currentTime
  engine.masterGain.gain.cancelScheduledValues(now)
  engine.masterGain.gain.linearRampToValueAtTime(volume, now + 0.05)
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

async function getDuration(entry) {
  if (entry.durationSeconds != null) return entry.durationSeconds
  await getOrCreateSource(entry)
  if (entry.durationSeconds == null) throw new Error('Unable to read audio metadata')
  return entry.durationSeconds
}

function updateLoopTimeInputs(loopStart, loopEnd) {
  els.loopEditorStartInput.value = formatDuration(loopStart)
  els.loopEditorEndInput.value = formatDuration(loopEnd)
}

// Real amplitude peaks, computed in the main process via ffmpeg (streams
// through the file rather than decoding it whole, so this works regardless
// of length). Cached per sound so reopening the editor is instant.
async function getWaveformPeaks(id) {
  if (waveformPeaksCache.has(id)) return waveformPeaksCache.get(id)
  const peaks = await api.audio.getWaveformPeaks(id, els.loopEditorCanvas.width)
  waveformPeaksCache.set(id, peaks)
  return peaks
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
    loopEditorController.onLoopChange(({ loopStart, loopEnd }) => {
      updateLoopTimeInputs(loopStart, loopEnd)
      previewSource?.setLoopPoints(loopStart, loopEnd)
    })
    loopEditorController.onScrub((t) => {
      if (previewSource) previewSource.audioEl.currentTime = t
    })
  }
  const loopStart = entry.loopStart
  const loopEnd = entry.loopEnd ?? duration
  loopEditorController.load(duration, loopStart, loopEnd)
  updateLoopTimeInputs(loopStart, loopEnd)
  await preparePreviewSource(loopStart, loopEnd)
  showModal(els.loopEditorModal)

  els.loopEditorWaveformStatus.textContent = waveformPeaksCache.has(id) ? '' : 'Loading waveform…'
  const peaks = await getWaveformPeaks(id)
  if (loopEditorSoundId !== id) return // a different sound's editor was opened meanwhile
  loopEditorController.setPeaks(peaks)
  els.loopEditorWaveformStatus.textContent = peaks ? '' : 'Waveform preview unavailable for this file.'
}

function applyManualLoopPoints() {
  if (!loopEditorController) return
  const start = parseDuration(els.loopEditorStartInput.value)
  const end = parseDuration(els.loopEditorEndInput.value)
  if (start == null || end == null) return
  loopEditorController.setLoopPoints(start, end)
  const { loopStart, loopEnd } = loopEditorController.getLoopPoints()
  updateLoopTimeInputs(loopStart, loopEnd)
}

els.loopEditorStartInput.addEventListener('change', applyManualLoopPoints)
els.loopEditorEndInput.addEventListener('change', applyManualLoopPoints)

function stopPreviewTicking() {
  if (previewRafId) {
    cancelAnimationFrame(previewRafId)
    previewRafId = null
  }
}

function tickPreviewPlayhead() {
  if (!previewSource || !loopEditorController) return
  loopEditorController.setPlayhead(previewSource.audioEl.currentTime)
  previewRafId = requestAnimationFrame(tickPreviewPlayhead)
}

// Creates a paused preview source positioned at loopStart as soon as the
// editor opens, so the needle is draggable/scrubbable even before pressing
// Play. Play/Pause then just plays or pauses this same source in place.
async function preparePreviewSource(loopStart, loopEnd) {
  disposePreview()
  await engine.resume()
  previewSource = new LocalFileSoundSource(engine, {
    soundId: loopEditorSoundId,
    loopStart,
    loopEnd,
    volume: 0.7
  })
  await previewSource.waitForMetadata()
  previewSource.audioEl.currentTime = loopStart
  loopEditorController?.setPlayhead(loopStart)
  els.loopEditorPlayPause.textContent = 'Play'
}

function disposePreview() {
  stopPreviewTicking()
  if (!previewSource) return
  previewSource.dispose()
  previewSource = null
  loopEditorController?.clearPlayhead()
}

els.loopEditorPlayPause.addEventListener('click', async () => {
  if (!previewSource) return
  if (previewSource.playing) {
    previewSource.pause()
    stopPreviewTicking()
    els.loopEditorPlayPause.textContent = 'Play'
  } else {
    try {
      await engine.resume()
      await previewSource.play()
      els.loopEditorPlayPause.textContent = 'Pause'
      tickPreviewPlayhead()
    } catch (err) {
      console.error('Failed to preview loop', err)
    }
  }
})

els.loopEditorCancel.addEventListener('click', () => {
  disposePreview()
  hideModal(els.loopEditorModal)
})

els.loopEditorSave.addEventListener('click', async () => {
  if (!loopEditorController || !loopEditorSoundId) return
  const id = loopEditorSoundId
  const { loopStart, loopEnd } = loopEditorController.getLoopPoints()
  await api.library.updateLoopPoints(id, { loopStart, loopEnd })

  const entry = state.library.find((s) => s.id === id)
  if (entry) {
    entry.loopStart = loopStart
    entry.loopEnd = loopEnd
  }

  // Best-effort: render a small clip for native gapless looping. Only within
  // the eligibility cap — a longer trimmed region keeps streaming exactly as
  // before, since fully decoding it client-side would risk the same
  // memory/crash problem long files hit before this app streamed instead.
  if (loopEnd - loopStart <= MAX_BUFFER_CLIP_SECONDS) {
    els.loopEditorSave.disabled = true
    els.loopEditorSave.textContent = 'Saving…'
    const result = await api.audio.renderLoopClip(id, { loopStart, loopEnd })
    if (entry) {
      if (result.ok) {
        entry.loopClipReady = true
        entry.loopClipStart = loopStart
        entry.loopClipEnd = loopEnd
      } else {
        entry.loopClipReady = false
        entry.loopClipStart = null
        entry.loopClipEnd = null
      }
    }
    els.loopEditorSave.disabled = false
    els.loopEditorSave.textContent = 'Save'
  }

  disposePreview()

  // Drop any live cached source so the next play re-evaluates buffer vs
  // stream mode against the freshly (re)rendered clip; restart immediately
  // if it was audibly playing so saving a trim doesn't silently cut it out.
  const wasPlaying = state.playing.has(id)
  state.sources.get(id)?.dispose()
  state.sources.delete(id)
  if (wasPlaying) {
    state.playing.delete(id)
    if (entry) await startPlayback(id, entry)
  }

  hideModal(els.loopEditorModal)
  render()
})

refreshList()
