import { AudioEngine } from '../../audio/AudioEngine.js'
import { LocalFileSoundSource } from '../../audio/SoundSource.js'
import { BufferSoundSource } from '../../audio/BufferSoundSource.js'
import { BufferScatterSource, StreamScatterSource } from '../../audio/ScatterSoundSource.js'
import { BufferScheduledSource, StreamScheduledSource } from '../../audio/ScheduledSoundSource.js'
import { renderSoundList, sortForDisplay, SORT_MODES, GROUP_MODES } from '../../ui/SoundList.js'
import { renderPresetList } from '../../ui/PresetsModal.js'
import { openWatchFolderPicker } from '../../core/WatchFolderDialog.js'
import { MAX_BUFFER_CLIP_SECONDS } from '../../../shared/constants.js'

const api = window.noctivago
const engine = new AudioEngine()

const state = {
  library: [],
  searchQuery: '',
  sortMode: 'name-asc',
  groupMode: 'none',
  activeTagFilter: null,
  sources: new Map(),
  volumes: new Map(),
  included: new Set(),
  playing: new Set(),
  loading: new Set(),
  errors: new Map(),
  // Mute is a separate on/off flag layered on top of the volume itself
  // (global or per-sound), not a destructive "set volume to 0" - unmuting
  // always restores exactly whatever the slider was already showing.
  // Session-only, like the global volume slider's own current position -
  // neither is persisted today, so this doesn't add a new persistence gap.
  globalMuted: false,
  mutedSounds: new Set(),
  // Single-target solo (the currently-soloed sound's id, or null) and
  // exactly which other ids got muted *by* soloing it - see applySolo's own
  // comment for why this needs to be tracked separately from mutedSounds
  // itself. Session-only, like mute itself.
  soloedSoundId: null,
  soloMutedIds: new Set()
}

const els = {
  soundList: null,
  emptyState: null,
  globalPlayPause: document.getElementById('global-play-pause'),
  globalVolume: document.getElementById('global-volume'),
  globalMute: document.getElementById('global-mute'),
  addSoundBtn: document.getElementById('add-sound'),
  addSoundMenu: document.getElementById('add-sound-menu'),
  addSoundFileItem: document.getElementById('add-sound-file'),
  addSoundFolderPresetItem: document.getElementById('add-sound-folder-preset'),
  addSoundFolderTagItem: document.getElementById('add-sound-folder-tag'),
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
  addFolderPresetTag: document.getElementById('add-folder-preset-tag'),
  addFolderPresetTagName: document.getElementById('add-folder-preset-tag-name'),
  addFolderPresetStatus: document.getElementById('add-folder-preset-status'),
  addFolderPresetCancel: document.getElementById('add-folder-preset-cancel'),
  addFolderPresetConfirm: document.getElementById('add-folder-preset-confirm'),

  addFolderTagDialog: document.getElementById('add-folder-tag-dialog'),
  addFolderTagName: document.getElementById('add-folder-tag-name'),
  addFolderTagKeepCopy: document.getElementById('add-folder-tag-keep-copy'),
  addFolderTagStatus: document.getElementById('add-folder-tag-status'),
  addFolderTagCancel: document.getElementById('add-folder-tag-cancel'),
  addFolderTagConfirm: document.getElementById('add-folder-tag-confirm'),

  presetsModal: document.getElementById('presets-modal'),
  newPresetName: document.getElementById('new-preset-name'),
  savePresetBtn: document.getElementById('save-preset'),
  presetSaveHint: document.getElementById('preset-save-hint'),
  presetList: document.getElementById('preset-list'),
  presetsClose: document.getElementById('presets-close')
}

let pickedFile = null
let pickedFolder = null
// Folder-name tag text for the "Add folder as preset" dialog's own tag
// checkbox - derived from the folder path at pick time (same as the preset
// name field's own default), kept independent of whatever the user may have
// typed into that name field, since the tag should always reflect the
// folder's real name per the original ask.
let pickedFolderPresetTagName = null
let pickedFolderForTag = null // folder path for the standalone "Add folder as tag" dialog
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

// Play (triangle) / Pause (two bars) - the one pair of icons universal
// enough to convert from text with no ambiguity (per the icon-conversion
// survey this was scoped from), mirrored by Remix's own sticky Play/Pause
// button. `title` keeps the "all" scope (vs. a single sound) available on
// hover even though the glyph itself doesn't say it.
const PLAY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
const PAUSE_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'

// Speaker (unmuted) / speaker-with-X (muted) - mirrored by SoundRow.js's
// per-sound mute button and the Remix plugin's preview-volume mute button,
// same icon pair everywhere a volume slider exists (requested directly:
// "everywhere there is a volume slider there should be an icon beside it
// so you can click it to mute/unmute it and the icon should react on it").
const VOLUME_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>'
const MUTE_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>'

function refreshGlobalButton() {
  const playing = state.playing.size > 0
  els.globalPlayPause.innerHTML = playing ? PAUSE_ICON_SVG : PLAY_ICON_SVG
  els.globalPlayPause.title = playing ? 'Pause all' : 'Play all'
}

const EMPTY_LIBRARY_TEXT = 'No sounds yet. Click "Add Sound" to import one.'
const NO_SEARCH_MATCHES_TEXT = 'No sounds match your search.'

function visibleLibrary() {
  const query = state.searchQuery.trim().toLowerCase()
  let entries = state.library
  if (query) entries = entries.filter((entry) => entry.name.toLowerCase().includes(query))
  if (state.activeTagFilter) entries = entries.filter((entry) => entry.tags?.includes(state.activeTagFilter))
  return entries
}

function renderTagFilterBar() {
  const allTags = [...new Set(state.library.flatMap((entry) => entry.tags ?? []))].sort((a, b) => a.localeCompare(b))
  els.tagFilterBar.innerHTML = ''
  els.tagFilterBar.classList.toggle('hidden', allTags.length === 0)
  for (const tag of allTags) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'tag-chip tag-filter-chip' + (state.activeTagFilter === tag ? ' tag-filter-chip-active' : '')
    chip.textContent = tag
    chip.addEventListener('click', () => {
      state.activeTagFilter = state.activeTagFilter === tag ? null : tag
      render()
    })
    els.tagFilterBar.appendChild(chip)
  }
}

function render() {
  const visible = visibleLibrary()
  const filtering = state.searchQuery.trim() || state.activeTagFilter
  els.emptyState.textContent = filtering && state.library.length > 0 ? NO_SEARCH_MATCHES_TEXT : EMPTY_LIBRARY_TEXT
  renderTagFilterBar()
  // Every tag used anywhere in the *full* library (not just visible, which
  // may already be search/tag-filtered) - drives each row's "+ tag"
  // autocomplete, same computation renderTagFilterBar() already does for
  // its own chip bar.
  const allTags = [...new Set(state.library.flatMap((entry) => entry.tags ?? []))].sort((a, b) => a.localeCompare(b))
  renderSoundList(
    els.soundList,
    els.emptyState,
    visible,
    state,
    { sortMode: state.sortMode, groupMode: state.groupMode },
    {
      onToggleIncluded: toggleIncluded,
      onVolumeChange: changeVolume,
      onToggleMute: toggleMute,
      onToggleSolo: toggleSolo,
      onTestFire: testFireOneShot,
      onRemove: removeSound,
      onRelink: relinkSound,
      onRename: renameSound,
      onTagsChange: changeTags,
      onReorderDrop: reorderByDrop
    },
    allTags
  )
  refreshGlobalButton()
}

async function changeTags(id, tags) {
  await api.library.updateTags(id, tags)
  await refreshList()
}

// Drop target is always "insert dragged item immediately before this row" -
// simpler than checking which half of the target row the cursor is over,
// and still enough to reach any position with one drag. Computed against
// the *full* library order (not just the currently visible/filtered rows),
// so an active search or tag filter never lets a hidden sound's relative
// position drift as a side effect of reordering the visible ones.
async function reorderByDrop(draggedId, targetId) {
  const fullOrder = sortForDisplay(state.library, 'custom').map((e) => e.id)
  const withoutDragged = fullOrder.filter((id) => id !== draggedId)
  const targetIndex = withoutDragged.indexOf(targetId)
  if (targetIndex === -1) return
  withoutDragged.splice(targetIndex, 0, draggedId)
  await api.library.reorderSounds(withoutDragged)
  await refreshList()
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
// Mirrors library.js's normalizeSpeedPitch - undefined (predates this
// field) and an explicit neutral object must compare equal.
function normalizeSpeedPitch(speedPitch) {
  return JSON.stringify({
    speed: speedPitch?.speed ?? 1,
    pitchSemitones: speedPitch?.pitchSemitones ?? 0,
    reversed: speedPitch?.reversed ?? false,
    dopplerEnabled: speedPitch?.dopplerEnabled ?? false
  })
}

// Scatter mode (see library.js's addSound) plays the trim as one-shots, not
// back-to-back, so the crossfade+rotation a looped clip needs to hide its
// own wrap point would be actively wrong - forcing the *effective* crossfade
// to 0 reuses renderLoopClip unchanged (0 already means "plain trim, no
// rotation") instead of a second bake pipeline. Mirrors library.js's own
// effectiveCrossfadeSeconds exactly - keep both in sync if this ever changes.
function effectiveCrossfadeSeconds(entry) {
  if (entry.playMode === 'scatter' || entry.playMode === 'scheduled' || entry.speedPitch?.dopplerEnabled) return 0
  return entry.crossfadeSeconds
}

function bufferBakeSnapshot(entry) {
  return JSON.stringify({
    loopStart: entry.loopStart,
    loopEnd: entry.loopEnd,
    filters: entry.filters,
    crossfadeSeconds: effectiveCrossfadeSeconds(entry),
    speedPitch: normalizeSpeedPitch(entry.speedPitch)
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
// Four possible source kinds, crossing playMode ('loop' | 'scatter') with
// whether a baked clip is currently usable - see getOrCreateSource/
// tryCreateBufferSource for what actually gets constructed for each.
function desiredSourceKind(entry) {
  const buffer = loopClipEligible(entry)
  if (entry.playMode === 'scatter') return buffer ? 'scatter-buffer' : 'scatter-stream'
  if (entry.playMode === 'scheduled') return buffer ? 'scheduled-buffer' : 'scheduled-stream'
  return buffer ? 'loop-buffer' : 'loop-stream'
}

// "Sync it up with" - two or more scatter sounds sharing a non-empty
// scatter.syncGroup always fire together (one starts, all start). Wired as
// each real (non-ephemeral) scatter source's onShotStart callback at
// construction (see tryCreateBufferSource/getOrCreateSource), fired for
// both a natural gap-elapsed shot and an explicit test-fire click - the
// silent:true fireNow() call below deliberately skips the fired source's
// own onShotStart, which is what keeps a sync group from cascading into an
// infinite ping-pong between its own members instead of a single, one-level
// propagation from whichever member actually triggered it.
function propagateSync(firedId) {
  const firedEntry = state.library.find((e) => e.id === firedId)
  const group = firedEntry?.scatter?.syncGroup
  if (!group) return
  for (const id of state.included) {
    if (id === firedId) continue
    const entry = state.library.find((e) => e.id === id)
    if (entry?.playMode !== 'scatter' || entry.scatter?.syncGroup !== group) continue
    state.sources.get(id)?.fireNow?.({ silent: true })
  }
}

function reconcileSource(entry) {
  const source = state.sources.get(entry.id)
  if (!source) return

  const desiredKind = desiredSourceKind(entry)
  const isBuffer = desiredKind === 'loop-buffer' || desiredKind === 'scatter-buffer' || desiredKind === 'scheduled-buffer'
  const bufferIsStale = isBuffer && source.kind === desiredKind && source.bakeSnapshot !== bufferBakeSnapshot(entry)

  if (desiredKind !== source.kind || bufferIsStale) {
    swapSource(entry)
    return
  }

  if (desiredKind === 'loop-stream') {
    if (!source.hasFilters(entry.filters)) source.setFilters(entry.filters)
    if (!source.hasLoopPoints(entry.loopStart, entry.loopEnd)) source.setLoopPoints(entry.loopStart, entry.loopEnd)
    if (!source.hasSpeed(entry.speedPitch?.speed)) source.setSpeed(entry.speedPitch?.speed)
  } else if (desiredKind === 'scatter-stream') {
    if (!source.hasFilters(entry.filters)) source.setFilters(entry.filters)
    if (!source.hasLoopPoints(entry.loopStart, entry.loopEnd)) source.setLoopPoints(entry.loopStart, entry.loopEnd)
    if (!source.hasScatterConfig(entry.scatter)) source.setScatterConfig(entry.scatter)
  } else if (desiredKind === 'scatter-buffer') {
    if (!source.hasScatterConfig(entry.scatter)) source.setScatterConfig(entry.scatter)
  } else if (desiredKind === 'scheduled-stream') {
    if (!source.hasFilters(entry.filters)) source.setFilters(entry.filters)
    if (!source.hasLoopPoints(entry.loopStart, entry.loopEnd)) source.setLoopPoints(entry.loopStart, entry.loopEnd)
    if (!source.hasScheduleConfig(entry.schedule)) source.setScheduleConfig(entry.schedule)
  } else if (desiredKind === 'scheduled-buffer') {
    if (!source.hasScheduleConfig(entry.schedule)) source.setScheduleConfig(entry.schedule)
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
    entry.loopClipCrossfadeSeconds === effectiveCrossfadeSeconds(entry) &&
    normalizeSpeedPitch(entry.loopClipSpeedPitch) === normalizeSpeedPitch(entry.speedPitch)
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
    .renderLoopClip(entry.id, {
      loopStart: entry.loopStart,
      loopEnd,
      filters: entry.filters,
      crossfadeSeconds: effectiveCrossfadeSeconds(entry),
      speedPitch: entry.speedPitch
    })
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
async function tryCreateBufferSource(entry, { oneShot = false } = {}) {
  const isScatter = entry.playMode === 'scatter'
  const isScheduled = entry.playMode === 'scheduled'
  try {
    const response = await fetch(`sound://${entry.id}?variant=clip`)
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await engine.context.decodeAudioData(arrayBuffer)
    const volume = state.volumes.get(entry.id) ?? 0.7
    let source
    if (isScatter) {
      source = new BufferScatterSource(engine, { audioBuffer, volume, scatter: entry.scatter, oneShot })
      if (!oneShot) source.onShotStart = () => propagateSync(entry.id)
    } else if (isScheduled) {
      source = new BufferScheduledSource(engine, { audioBuffer, volume, schedule: entry.schedule })
    } else {
      source = new BufferSoundSource(engine, { audioBuffer, volume })
    }
    source.kind = isScatter ? 'scatter-buffer' : isScheduled ? 'scheduled-buffer' : 'loop-buffer'
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
    const isScatter = entry.playMode === 'scatter'
    const isScheduled = entry.playMode === 'scheduled'
    const volume = state.volumes.get(entry.id) ?? 0.7
    source = isScatter
      ? new StreamScatterSource(engine, {
          soundId: entry.id,
          loopStart: entry.loopStart,
          loopEnd: entry.loopEnd,
          volume,
          filters: entry.filters,
          scatter: entry.scatter
        })
      : isScheduled
        ? new StreamScheduledSource(engine, {
            soundId: entry.id,
            loopStart: entry.loopStart,
            loopEnd: entry.loopEnd,
            volume,
            filters: entry.filters,
            schedule: entry.schedule
          })
        : new LocalFileSoundSource(engine, {
            soundId: entry.id,
            loopStart: entry.loopStart,
            loopEnd: entry.loopEnd,
            volume,
            filters: entry.filters,
            speed: entry.speedPitch?.speed
          })
    source.kind = isScatter ? 'scatter-stream' : isScheduled ? 'scheduled-stream' : 'loop-stream'
    if (isScatter) source.onShotStart = () => propagateSync(entry.id)

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
  const playing = state.playing.size > 0
  api.settings.setWasPlayingOnClose(playing)
  window.noctivago.playback.reportState(playing)
}

// Starts actual playback of a sound and marks it included+playing. Used by
// the per-sound toggle, "Play all", and preset loading.
// Muting is a separate on/off flag layered on top of state.volumes, not a
// destructive "set volume to 0" - unmuting always restores exactly whatever
// the slider was already showing (see state.mutedSounds above).
function effectiveVolume(id) {
  return state.mutedSounds.has(id) ? 0 : (state.volumes.get(id) ?? 0.7)
}

async function startPlayback(id, entry) {
  state.errors.delete(id)
  state.loading.add(id)
  render()
  try {
    const source = await getOrCreateSource(entry)
    if (!state.volumes.has(id)) state.volumes.set(id, 0.7)
    source.setVolume(effectiveVolume(id))
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
  // Dragging the slider while muted implicitly unmutes - matches the global
  // volume slider's own identical convention. Rare relative to a normal
  // drag (most volume ticks never touch mutedSounds at all), so this is the
  // only branch of a volume change that triggers a full render() - the
  // common case stays render()-free, same as before, so dragging never
  // reorders/redraws the list mid-drag.
  if (state.mutedSounds.has(id)) {
    state.mutedSounds.delete(id)
    render()
  }
  state.sources.get(id)?.setVolume(effectiveVolume(id))

  clearTimeout(volumeSaveTimers.get(id))
  volumeSaveTimers.set(
    id,
    setTimeout(() => {
      volumeSaveTimers.delete(id)
      api.library.updateVolume(id, volume)
    }, VOLUME_SAVE_DEBOUNCE_MS)
  )
}

function toggleMute(id) {
  if (state.mutedSounds.has(id)) state.mutedSounds.delete(id)
  else state.mutedSounds.add(id)
  state.sources.get(id)?.setVolume(effectiveVolume(id))
  render()
}

// Shared by two entry points: each sound row's own Solo button (added
// directly per the owner's own correction - "I meant a solo button for the
// mixer tab. So you can single one audio out vs the multiple that are
// playing," after an initial pass mistakenly scoped this to the Remix tab
// instead) and Remix's Solo button (kept - genuinely still useful for
// auditioning the sound currently open there against the rest of the mix,
// just not the primary ask). Remix has no direct access to this
// module-scoped state - plugins only get the curated window.noctivago IPC
// surface, and mute is deliberately session-only/unpersisted, so there's no
// library data to bridge through either - a plain window CustomEvent
// ('noctivago:solo') is the simplest connection that doesn't require either
// side to import the other.
//
// Single-target solo (like a DAW's own solo buttons, not a solo *group*):
// soloing a second sound while one's already soloed switches the target
// rather than stacking. releaseSolo() is the one path that ever un-mutes
// what solo itself muted, called both by a plain toggle-off and by
// applySolo() itself when the target changes - this makes applySolo(id,
// true) safe to call from either entry point at any time, even mid-solo
// from the *other* one, without ever leaving the new target itself stuck
// muted from the previous solo's own mute pass.
function releaseSolo() {
  for (const id of state.soloMutedIds) {
    state.mutedSounds.delete(id)
    state.sources.get(id)?.setVolume(effectiveVolume(id))
  }
  state.soloMutedIds.clear()
  state.soloedSoundId = null
}

// Only mutes sounds actually in state.included (muting an excluded sound
// would do nothing audible and could confuse the un-solo step), and only
// ones not already muted - so a sound the user muted by hand stays muted
// after solo releases, and this stays safe to call repeatedly.
function applySolo(soloId, active) {
  if (active) {
    if (state.soloedSoundId && state.soloedSoundId !== soloId) releaseSolo()
    state.soloedSoundId = soloId
    for (const id of state.included) {
      if (id === soloId || state.mutedSounds.has(id)) continue
      state.mutedSounds.add(id)
      state.soloMutedIds.add(id)
      state.sources.get(id)?.setVolume(effectiveVolume(id))
    }
  } else if (state.soloedSoundId === soloId) {
    releaseSolo()
  }
  render()
}

function toggleSolo(id) {
  applySolo(id, state.soloedSoundId !== id)
}

// "Test fire" button, scatter and scheduled sounds (SoundRow.js gates it on
// entry.playMode being one of those two) - requested directly for scatter
// ("an override play button on the mixer tab for audios that are played at
// random intervals... to play the audio once when pressed so you can test
// the configuration you set up without having to remove and re-add the
// audio"), extended to scheduled sounds too since they're architecturally
// the same "one-shot, then wait, then repeat" shape and benefit from the
// identical "let me hear it now" need - waiting for a real clock trigger
// just to check a scheduled sound's trim/filters would be far worse. Two
// cases:
//
// - Already live in the mix: fireNow() on the existing source just skips
//   whatever wait is currently pending (a random gap, or time until the
//   next scheduled trigger) and plays a shot immediately - normal cycling
//   resumes on its own right after, same as any other shot.
// - Not currently included at all: builds a throwaway source (same
//   buffer/stream eligibility check real playback uses, so the test
//   accurately reflects what the sound will actually do once added) with
//   oneShot: true, fires exactly one shot, then disposes itself via
//   onOneShotComplete - never touches state.included/state.playing/
//   state.sources, so there's nothing left to remove afterward. Uses
//   fireNow() rather than play() here specifically because a fresh
//   scheduled source's own play() deliberately *waits* for the next real
//   trigger (correct for actually joining the mix) - fireNow() is the one
//   method both source families guarantee fires immediately regardless of
//   whether they were already playing. Always at the sound's own real
//   volume regardless of any lingering mute flag from a previous include -
//   a "let me hear it" action should always be audible.
async function testFireOneShot(id) {
  const entry = state.library.find((s) => s.id === id)
  if (!entry || (entry.playMode !== 'scatter' && entry.playMode !== 'scheduled') || entry.status === 'missing') return

  const existing = state.sources.get(id)
  if (existing) {
    existing.fireNow()
    return
  }

  await engine.resume()
  const volume = state.volumes.get(id) ?? entry.volume ?? 0.7
  const isScatter = entry.playMode === 'scatter'
  let source = null
  if (loopClipEligible(entry)) {
    source = await tryCreateBufferSource(entry, { oneShot: true })
  }
  if (!source) {
    source = isScatter
      ? new StreamScatterSource(engine, {
          soundId: entry.id,
          loopStart: entry.loopStart,
          loopEnd: entry.loopEnd,
          volume,
          filters: entry.filters,
          scatter: entry.scatter,
          oneShot: true
        })
      : new StreamScheduledSource(engine, {
          soundId: entry.id,
          loopStart: entry.loopStart,
          loopEnd: entry.loopEnd,
          volume,
          filters: entry.filters,
          schedule: entry.schedule,
          oneShot: true
        })
  }
  source.onOneShotComplete = () => source.dispose()
  try {
    await source.fireNow()
  } catch (err) {
    console.error('Test-fire playback failed', entry.name, err)
    source.dispose()
  }
}

async function removeSound(id) {
  state.sources.get(id)?.dispose()
  state.sources.delete(id)
  state.playing.delete(id)
  state.included.delete(id)
  state.volumes.delete(id)
  state.mutedSounds.delete(id)
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

function updateGlobalMuteIcon() {
  els.globalMute.innerHTML = state.globalMuted ? MUTE_ICON_SVG : VOLUME_ICON_SVG
  els.globalMute.title = state.globalMuted ? 'Unmute' : 'Mute'
  els.globalMute.classList.toggle('btn-svg-icon-active', state.globalMuted)
}

function applyGlobalVolume() {
  const volume = state.globalMuted ? 0 : Number(els.globalVolume.value) / 100
  const now = engine.context.currentTime
  engine.masterGain.gain.cancelScheduledValues(now)
  engine.masterGain.gain.linearRampToValueAtTime(volume, now + 0.05)
}

// Dragging the slider while muted implicitly unmutes - matches the
// convention most OS/media-player volume controls already use, so muting
// doesn't silently "trap" a manual volume change behind an easy-to-miss
// separate button.
els.globalVolume.addEventListener('input', () => {
  if (state.globalMuted) {
    state.globalMuted = false
    updateGlobalMuteIcon()
  }
  applyGlobalVolume()
})

els.globalMute.addEventListener('click', () => {
  state.globalMuted = !state.globalMuted
  updateGlobalMuteIcon()
  applyGlobalVolume()
})

updateGlobalMuteIcon()

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
  pickedFolderPresetTagName = folderName
  els.addFolderPresetName.value = folderName
  els.addFolderPresetKeepCopy.checked = false
  els.addFolderPresetTag.checked = false
  els.addFolderPresetTagName.textContent = folderName
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

  if (els.addFolderPresetTag.checked && pickedFolderPresetTagName) {
    await Promise.all(added.map((entry) => api.library.updateTags(entry.id, [...(entry.tags ?? []), pickedFolderPresetTagName])))
  }

  els.addFolderPresetConfirm.disabled = false
  pickedFolder = null
  pickedFolderPresetTagName = null
  hideModal(els.addFolderPresetDialog)
  await refreshList()
})

els.addSoundFolderTagItem.addEventListener('click', async () => {
  closeAddSoundMenu()
  const folder = await api.library.pickFolder()
  if (!folder) return
  pickedFolderForTag = folder
  const folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? ''
  els.addFolderTagName.value = folderName
  els.addFolderTagKeepCopy.checked = false
  els.addFolderTagStatus.textContent = ''
  showModal(els.addFolderTagDialog)
})

els.addFolderTagCancel.addEventListener('click', () => {
  pickedFolderForTag = null
  hideModal(els.addFolderTagDialog)
})

els.addFolderTagConfirm.addEventListener('click', async () => {
  if (!pickedFolderForTag) return
  const tag = els.addFolderTagName.value.trim()
  if (!tag) {
    els.addFolderTagStatus.textContent = 'Enter a tag first.'
    return
  }

  els.addFolderTagConfirm.disabled = true
  els.addFolderTagStatus.textContent = 'Adding sounds…'

  const added = await api.library.addFolderSounds(pickedFolderForTag, { keepCopy: els.addFolderTagKeepCopy.checked })
  if (added.length === 0) {
    els.addFolderTagConfirm.disabled = false
    els.addFolderTagStatus.textContent = 'No audio files found directly inside that folder.'
    return
  }

  await Promise.all(added.map((entry) => api.library.updateTags(entry.id, [...(entry.tags ?? []), tag])))

  els.addFolderTagConfirm.disabled = false
  pickedFolderForTag = null
  hideModal(els.addFolderTagDialog)
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
    <div class="sound-list-controls">
      <select id="sound-sort" class="sound-sort-select" title="Sort"></select>
      <select id="sound-group" class="sound-group-select" title="Group by"></select>
    </div>
    <div id="tag-filter-bar" class="tag-filter-bar hidden"></div>
    <ul id="sound-list" class="sound-list"></ul>
    <p id="empty-state" class="empty-state">No sounds yet. Click "Add Sound" to import one.</p>
  `
  els.soundSearch = container.querySelector('#sound-search')
  els.soundSort = container.querySelector('#sound-sort')
  els.soundGroup = container.querySelector('#sound-group')
  els.tagFilterBar = container.querySelector('#tag-filter-bar')
  els.soundList = container.querySelector('#sound-list')
  els.emptyState = container.querySelector('#empty-state')

  for (const { value, label } of SORT_MODES) {
    els.soundSort.appendChild(new Option(label, value))
  }
  for (const { value, label } of GROUP_MODES) {
    els.soundGroup.appendChild(new Option(label, value))
  }
  els.soundSort.value = state.sortMode
  els.soundGroup.value = state.groupMode

  els.soundSearch.addEventListener('input', () => {
    state.searchQuery = els.soundSearch.value
    render()
  })
  els.soundSort.addEventListener('change', () => {
    state.sortMode = els.soundSort.value
    render()
  })
  els.soundGroup.addEventListener('change', () => {
    state.groupMode = els.soundGroup.value
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
  // See applySolo's own comment for why this is a window event rather than a
  // direct call - Remix's Solo button dispatches { soundId, active }.
  window.addEventListener('noctivago:solo', (e) => {
    applySolo(e.detail.soundId, e.detail.active)
  })
}
