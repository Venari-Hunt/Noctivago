import { AudioEngine } from '../../audio/AudioEngine.js'
import { LocalFileSoundSource } from '../../audio/SoundSource.js'
import { BufferSoundSource } from '../../audio/BufferSoundSource.js'
import { BufferScatterSource, StreamScatterSource } from '../../audio/ScatterSoundSource.js'
import { BufferScheduledSource, StreamScheduledSource } from '../../audio/ScheduledSoundSource.js'
import { renderSoundList, sortForDisplay, SORT_MODES, GROUP_MODES } from '../../ui/SoundList.js'
import { renderPresetList, renderPresetImportList } from '../../ui/PresetsModal.js'
import { openWatchFolderPicker } from '../../core/WatchFolderDialog.js'
import { openRecordDialog } from '../../core/RecordDialog.js'
import { openAddLinkDialog } from '../../core/AddLinkDialog.js'
import { openContextMenu } from '../../core/ContextMenu.js'
import { MAX_BUFFER_CLIP_SECONDS, applySoundOverride } from '../../../shared/constants.js'
import { effectiveMemberFluctuation, applyGroupShotOverride, groupDriftMemberKey } from '../../../shared/groupDrift.js'
import { positionToGain, gainToSlider, DEFAULT_VOLUME } from '../../core/volumeScale.js'
import { startLevelMeters } from '../../ui/levelMeters.js'
import { buildClipReport, lowerGain, lowerGroupGainDb } from './domain/clipReport.js'
import { openClipReport } from './components/ClipReport.jsx'

const api = window.noctivago
const engine = new AudioEngine()
startLevelMeters(engine, { onOpenReport: showClipReport })

// Bulk-apply an effect preset to several selected sounds at once (Board
// backlog: Noctívago-shaped echo of Audacity's Macros). Duplicated from
// plugins/editor/index.js's FILTER_PRESETS - core can't import a plugin's
// own files, so keep these values in sync if that list ever changes.
// Mirrors the plugin's own setFilterSliders field-by-field exactly: only
// highpass/lowpass/gain/echo/reverb are set from the preset (reset to 0/off
// when a preset doesn't define them), gate/denoise always reset to off
// (none of these presets touch them), EQ is left completely untouched.
const BULK_FILTER_PRESETS = {
  muffled: { highpassHz: 0, lowpassHz: 700, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  phone: { highpassHz: 300, lowpassHz: 3400, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  radio: { highpassHz: 150, lowpassHz: 6000, gainDb: 0, echoDelayMs: 0, echoDecay: 0 },
  distant: { highpassHz: 0, lowpassHz: 2500, gainDb: -8, echoDelayMs: 0, echoDecay: 0 },
  underwater: { highpassHz: 0, lowpassHz: 250, gainDb: -3, echoDelayMs: 0, echoDecay: 0 },
  echo: { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 350, echoDecay: 0.4 },
  reverb: { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0, reverbSizeMs: 1500, reverbMix: 0.35 }
}
// "Reset filters" for the bulk bar - the same neutral HP/LP/Gain/Echo/
// Reverb values Remix's own Reset filters button applies, EQ untouched.
const BULK_NEUTRAL_FILTERS = { highpassHz: 0, lowpassHz: 20000, gainDb: 0, echoDelayMs: 0, echoDecay: 0 }

const state = {
  library: [],
  searchQuery: '',
  sortMode: 'name-asc',
  groupMode: 'none',
  activeTagFilter: null,
  // Bulk-apply an effect preset to several sounds at once (Board backlog
  // item, Audacity-Macros-shaped) - a lightweight multi-select layered onto
  // the existing list, not a new selection model that touches every other
  // row interaction. selectMode toggles the per-row checkboxes on; leaving
  // it clears the selection so it can't silently carry over into unrelated
  // later actions.
  selectMode: false,
  selectedIds: new Set(),
  sources: new Map(),
  volumes: new Map(),
  included: new Set(),
  playing: new Set(),
  loading: new Set(),
  errors: new Map(),
  // Mute is a separate on/off flag layered on top of the volume itself
  // (global or per-sound), not a destructive "set volume to 0" - unmuting
  // always restores exactly whatever the slider was already showing.
  // Session-only, unlike the global volume slider's own position (see
  // settings.js's globalVolumePosition) - muting on launch would be an odd
  // surprise of its own, so only the volume level itself is remembered.
  globalMuted: false,
  mutedSounds: new Set(),
  // Single-target solo (the currently-soloed sound's id, or null) and
  // exactly which other ids got muted *by* soloing it - see applySolo's own
  // comment for why this needs to be tracked separately from mutedSounds
  // itself. Session-only, like mute itself.
  soloedSoundId: null,
  soloMutedIds: new Set(),
  // Group solo (v0.1.148) - the merged Remix tab's Group-mode "hear just
  // this group" button. Independent of soloedSoundId/soloMutedIds above
  // (a single-sound solo and a group solo are mutually exclusive, never
  // stacked - see applyGroupSolo) rather than generalizing the existing
  // single-id solo to accept a set, since state.soloedSoundId is read in
  // several places (SoundRow highlighting) as a scalar "is this the one".
  soloedGroupId: null,
  groupSoloMutedIds: new Set(),
  // The preset most recently loaded via loadPreset(). Drives which preset's
  // whole-mix processing is live on engine.wholeMix, and gates the Preset
  // Remix plugin's live-preview events (only the active preset's edits are
  // heard). Not cleared when the user then deviates from the preset by hand -
  // instead, deviations (adding/removing a sound, changing a volume) autosave
  // straight back into it - see autosaveActivePreset().
  activePresetId: null,
  // Sound Groups (see AudioEngine.js's SoundGroupChain) belonging to
  // whichever preset is active - kept here purely so the right-click
  // context menu can list them without an extra IPC round-trip on every
  // open; the source of truth is always presets.list(), re-fetched whenever
  // this could be stale (loadPreset, the sound-groups-changed bridge below).
  groups: [],
  // groupId -> the filters a Remix Group-mode session is currently
  // previewing (unsaved), so a live pan-drift toggle there overrides member
  // sounds right away - see effectiveFluctuation. Cleared on preset load.
  groupFilterPreviews: new Map(),
  // Per-preset sound overrides (planned 2026-09-12, "presets as primary
  // context"): the active preset's own sounds[] array (soundId, volume,
  // overrides), the single source of truth for both currentMixSounds()'s
  // override-preserving writes and recomputeEffectiveLibrary()'s merge.
  // baselineById is the raw, un-overridden library - only
  // applyBulkFilterPreset (a multi-select macro with no natural per-preset
  // meaning) reads from this directly; every other read site keeps reading
  // state.library, which recomputeEffectiveLibrary() keeps pointed at the
  // *effective* (baseline + active preset's override) view.
  activePresetSounds: [],
  baselineById: new Map()
}

const els = {
  soundList: null,
  emptyState: null,
  globalPlayPause: document.getElementById('global-play-pause'),
  globalVolume: document.getElementById('global-volume'),
  globalMute: document.getElementById('global-mute'),
  activePresetIndicator: document.getElementById('active-preset-indicator'),
  activePresetName: document.getElementById('active-preset-name'),
  addSoundBtn: document.getElementById('add-sound'),
  addSoundMenu: document.getElementById('add-sound-menu'),
  addSoundFileItem: document.getElementById('add-sound-file'),
  addSoundFolderPresetItem: document.getElementById('add-sound-folder-preset'),
  addSoundFolderTagItem: document.getElementById('add-sound-folder-tag'),
  addSoundWatchFolderItem: document.getElementById('add-sound-watch-folder'),
  addSoundRecordItem: document.getElementById('add-sound-record'),
  addSoundLinkItem: document.getElementById('add-sound-link'),
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
  updateActivePresetBtn: document.getElementById('update-active-preset'),
  updateActivePresetLabel: document.getElementById('update-active-preset-label'),
  presetAutosaveNote: document.getElementById('preset-autosave-note'),
  presetAutosaveToggle: document.getElementById('preset-autosave-toggle'),
  newPresetName: document.getElementById('new-preset-name'),
  newPresetBlankBtn: document.getElementById('new-preset-blank'),
  savePresetBtn: document.getElementById('save-preset'),
  presetSaveHint: document.getElementById('preset-save-hint'),
  presetList: document.getElementById('preset-list'),
  presetsClose: document.getElementById('presets-close'),
  importPresetBtn: document.getElementById('import-preset'),

  presetImportDialog: document.getElementById('preset-import-dialog'),
  presetImportName: document.getElementById('preset-import-name'),
  presetImportList: document.getElementById('preset-import-list'),
  presetImportStatus: document.getElementById('preset-import-status'),
  presetImportCancel: document.getElementById('preset-import-cancel'),
  presetImportConfirm: document.getElementById('preset-import-confirm'),

  groupCreateDialog: document.getElementById('group-create-dialog'),
  groupCreateName: document.getElementById('group-create-name'),
  groupCreateCancel: document.getElementById('group-create-cancel'),
  groupCreateConfirm: document.getElementById('group-create-confirm')
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
// id -> the bufferBakeSnapshot last auto-baked this session, so a settings
// combination is only ever tried once (a failed or never-matching render
// can't loop).
const autoBakedSnapshots = new Map()

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
    { sortMode: state.sortMode, groupMode: state.groupMode, selectMode: state.selectMode, selectedIds: state.selectedIds },
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
      onReorderDrop: reorderByDrop,
      onContextMenu: openSoundContextMenu,
      onToggleSelect: toggleSelectSound
    },
    allTags
  )
  refreshGlobalButton()
}

// Bulk-select (Board backlog: bulk-apply an effect preset to several sounds
// at once) - toggling a row's checkbox re-renders (cheap; the list is
// already re-rendered on every other row-state change in this file) so the
// bar's live count and each row's highlight stay in sync immediately.
function toggleSelectSound(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id)
  else state.selectedIds.add(id)
  updateBulkSelectUI()
  render()
}

function updateBulkSelectUI() {
  els.bulkSelectToggle.textContent = state.selectMode ? 'Cancel select' : 'Select…'
  els.bulkSelectToggle.classList.toggle('btn-active', state.selectMode)
  els.bulkSelectBar.classList.toggle('hidden', !state.selectMode)
  const count = state.selectedIds.size
  els.bulkSelectCount.textContent = `${count} selected`
  const hasSelection = count > 0
  for (const button of els.bulkSelectPresetButtons) button.disabled = !hasSelection
  els.bulkSelectReset.disabled = !hasSelection
}

// Applies one effect preset's HP/LP/Gain/Echo/Reverb to every selected
// sound's own filters, exactly mirroring the Remix plugin's own
// setFilterSliders field-by-field behavior for a single sound (gate/denoise
// reset to off, EQ left untouched) - see BULK_FILTER_PRESETS' own comment.
// `updateFilters` is a whole-object replace (library.js), so each sound's
// full current filters are read first and only the preset's own fields are
// overwritten, same as the plugin does via its own currentFilters merge.
async function applyBulkFilterPreset(preset) {
  const ids = [...state.selectedIds]
  if (ids.length === 0) return
  await Promise.all(
    ids.map((id) => {
      // Reads baseline, not the (possibly preset-overridden) effective
      // state.library - a multi-select macro has no natural single "which
      // preset" meaning, and it must keep writing pure baseline
      // unconditionally (same as before per-preset overrides existed) so it
      // can't silently corrupt the baseline/override split by merging an
      // override's filters into what gets written back as baseline.
      const entry = state.baselineById.get(id)
      if (!entry) return null
      const merged = {
        ...entry.filters,
        highpassHz: preset.highpassHz ?? 0,
        lowpassHz: preset.lowpassHz ?? 20000,
        gainDb: preset.gainDb ?? 0,
        gateThresholdDb: -80,
        gateRangeDb: 0,
        gateAttackMs: 10,
        gateReleaseMs: 150,
        denoiseEnabled: false,
        denoiseStrengthDb: 12,
        denoiseSampleStartSec: 0,
        denoiseSampleEndSec: 0,
        echoDelayMs: preset.echoDelayMs ?? 0,
        echoDecay: preset.echoDecay ?? 0,
        reverbSizeMs: preset.reverbSizeMs ?? 0,
        reverbMix: preset.reverbMix ?? 0
      }
      return api.library.updateFilters(id, merged)
    })
  )
  // refreshList() re-fetches every entry and reconciles every live source
  // against its (now updated) filters - the same path a Remix Save's
  // library:onChanged already drives, no separate reconcile call needed.
  await refreshList()
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

// Sound Groups (see AudioEngine.js's SoundGroupChain) - a right-click menu
// on a sound row, requested directly ("accessible on a right click context
// menu, on the mixer tab"). Groups are scoped to a preset, so this only
// works once one is loaded; membership toggles write straight through
// (no draft/Save step, unlike a group's own filters/EQ, which are edited in
// the Preset Remix plugin's "Sound Groups" section) and broadcast
// noctivago:sound-groups-changed so any other live view (Preset Remix, this
// same Mixer if the edited preset is the active one) picks up the change.
function openSoundContextMenu(id, evt) {
  if (!state.activePresetId) {
    openContextMenu(evt.clientX, evt.clientY, [{ label: 'Load a preset to use Sound Groups', disabled: true }])
    return
  }
  const presetId = state.activePresetId
  const groups = state.groups
  const currentGroupId = groups.find((g) => g.soundIds.includes(id))?.id ?? null

  const items = groups.map((g) => ({
    label: (g.id === currentGroupId ? '✓ ' : '') + g.name,
    onClick: () => toggleGroupMembership(presetId, g.id, id)
  }))
  if (items.length > 0) items.push({ separator: true })
  items.push({ label: 'New group with this sound…', onClick: () => openCreateGroupDialog(presetId, id) })
  if (currentGroupId) {
    items.push({ label: 'Remove from group', onClick: () => toggleGroupMembership(presetId, currentGroupId, id) })
  }
  openContextMenu(evt.clientX, evt.clientY, items)
}

// A sound belongs to at most one group per preset - joining group B leaves
// whatever group it was already in (a simple, single-bus routing model;
// see AudioEngine.destinationForSound). Clicking the already-checked group
// again removes it instead (the toggle half of "toggle").
//
// Queued onto _groupMembershipQueue rather than fired directly (self-review,
// v0.1.149): right-clicking two different sounds' context menus in quick
// succession used to read-then-write groups independently, so the second
// write could silently clobber the first (the exact race already caught and
// fixed once for the Remix tab's own group editor - this sibling
// implementation had the identical shape and was missed). Reads state.groups
// fresh when the queued call actually executes (not a menu-open-time
// snapshot, which could be stale by the time the user clicks an item) and
// writes the real IPC response straight back to state.groups before the
// next queued call can run, rather than depending on the redundant
// sound-groups-changed round-trip's own timing.
let _groupMembershipQueue = Promise.resolve()
function toggleGroupMembership(presetId, groupId, soundId) {
  _groupMembershipQueue = _groupMembershipQueue.then(() => toggleGroupMembershipNow(presetId, groupId, soundId))
  return _groupMembershipQueue
}

async function toggleGroupMembershipNow(presetId, groupId, soundId) {
  const current = presetId === state.activePresetId ? state.groups : (await api.presets.list()).find((p) => p.id === presetId)?.groups ?? []
  let wasAlreadyMember = false
  const updated = current.map((g) => {
    if (g.id === groupId) {
      wasAlreadyMember = g.soundIds.includes(soundId)
      return { ...g, soundIds: wasAlreadyMember ? g.soundIds.filter((s) => s !== soundId) : [...g.soundIds, soundId] }
    }
    return { ...g, soundIds: g.soundIds.filter((s) => s !== soundId) }
  })
  const saved = await api.presets.updateGroups(presetId, updated)
  if (presetId === state.activePresetId) {
    state.groups = saved?.groups ?? updated
    engine.setSoundGroups(state.groups)
    for (const [id, source] of state.sources) engine.routeSound(id, source)
    render()
  }
  // joinedSoundId: only set when this call actually just added soundId to a
  // group (not when it removed it) - see the sound-groups-changed
  // listener's own comment for why this needs to be the *specific* sound,
  // not every current member.
  window.dispatchEvent(new CustomEvent('noctivago:sound-groups-changed', { detail: { presetId, joinedSoundId: wasAlreadyMember ? null : soundId } }))
}

let pendingGroupCreate = null // { presetId, soundId }

function openCreateGroupDialog(presetId, soundId) {
  pendingGroupCreate = { presetId, soundId }
  els.groupCreateName.value = ''
  showModal(els.groupCreateDialog)
  els.groupCreateName.focus()
}

els.groupCreateCancel.addEventListener('click', () => {
  pendingGroupCreate = null
  hideModal(els.groupCreateDialog)
})

els.groupCreateConfirm.addEventListener('click', async () => {
  if (!pendingGroupCreate) return
  const name = els.groupCreateName.value.trim() || 'Group'
  const { presetId, soundId } = pendingGroupCreate
  // Fetched fresh here rather than trusting whatever was captured when the
  // context menu was opened - this dialog can sit open for a while (the
  // user typing a name), long enough for a real staleness gap against
  // groups changed elsewhere in the meantime.
  const current = presetId === state.activePresetId ? state.groups : (await api.presets.list()).find((p) => p.id === presetId)?.groups ?? []
  const newGroup = { name, soundIds: [soundId], filters: { highpassHz: 0, lowpassHz: 20000, gainDb: 0, eq: [] } }
  const saved = await api.presets.updateGroups(presetId, [...current, newGroup])
  if (presetId === state.activePresetId) {
    state.groups = saved?.groups ?? [...current, newGroup]
    engine.setSoundGroups(state.groups)
    for (const [id, source] of state.sources) engine.routeSound(id, source)
    render()
  }
  window.dispatchEvent(new CustomEvent('noctivago:sound-groups-changed', { detail: { presetId, joinedSoundId: soundId } }))
  pendingGroupCreate = null
  hideModal(els.groupCreateDialog)
})

els.groupCreateName.addEventListener('keydown', (evt) => {
  if (evt.key === 'Enter') els.groupCreateConfirm.click()
  else if (evt.key === 'Escape') els.groupCreateCancel.click()
})

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
    dopplerEnabled: speedPitch?.dopplerEnabled ?? false,
    dopplerClosestFraction: speedPitch?.dopplerClosestFraction ?? 0.5,
    dopplerIntensitySemitones: speedPitch?.dopplerIntensitySemitones ?? 5,
    dopplerReversed: speedPitch?.dopplerReversed ?? false,
    dopplerSharpness: speedPitch?.dopplerSharpness ?? 0.5
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

// Sound Group drift rules (v0.1.217 pan override, v0.1.218 "each sound on
// its own") - see src/shared/groupDrift.js. Uses the group's live Remix
// preview when one is in progress, else its saved filters.
function groupFluctuationFor(soundId) {
  const group = state.groups.find((g) => g.soundIds?.includes(soundId))
  if (!group) return null
  const filters = state.groupFilterPreviews.has(group.id) ? state.groupFilterPreviews.get(group.id) : group.filters
  return filters?.fluctuation ?? null
}

function effectiveFluctuation(entry) {
  return effectiveMemberFluctuation(entry.fluctuation, groupFluctuationFor(entry.id))
}

function groupFluctuationForGroup(groupId) {
  const group = state.groups.find((g) => g.id === groupId)
  const filters = state.groupFilterPreviews.has(groupId) ? state.groupFilterPreviews.get(groupId) : group?.filters
  return filters?.fluctuation ?? null
}

function effectiveScatter(entry) {
  return applyGroupShotOverride(entry.scatter, groupFluctuationFor(entry.id))
}

function effectiveSchedule(entry) {
  return applyGroupShotOverride(entry.schedule, groupFluctuationFor(entry.id))
}

// Whether a live source still matches what `entry` currently calls for -
// shared by reconcileSource (below) and getOrCreateSource's cache-reuse
// branch, which needs the exact same check before it can trust a cached
// source rather than only routing it (see that function's own comment).
function sourceNeedsSwap(entry, source) {
  const desiredKind = desiredSourceKind(entry)
  const isBuffer = desiredKind === 'loop-buffer' || desiredKind === 'scatter-buffer' || desiredKind === 'scheduled-buffer'
  const bufferIsStale = isBuffer && source.kind === desiredKind && source.bakeSnapshot !== bufferBakeSnapshot(entry)
  return desiredKind !== source.kind || bufferIsStale
}

// Brings an already-correct-kind source's live params in line with `entry`
// (filters/loop points/speed/crossfade/scatter/schedule/fluctuation) -
// split out of reconcileSource so getOrCreateSource's cache-reuse branch can
// call it too, without also re-running the swap decision reconcileSource
// itself already made.
function patchSourceSettings(entry, source, desiredKind) {
  // Fluctuation (v0.1.164) is playback-time only, never baked - so unlike
  // filters it applies to buffer-mode sources too, and it's reconciled here
  // for every source kind that supports it rather than inside one branch.
  const fluctuation = effectiveFluctuation(entry)
  if (source.hasFluctuation && !source.hasFluctuation(fluctuation)) {
    source.setFluctuation(fluctuation)
  }

  if (desiredKind === 'loop-stream') {
    if (!source.hasFilters(entry.filters)) source.setFilters(entry.filters)
    if (!source.hasLoopPoints(entry.loopStart, entry.loopEnd)) source.setLoopPoints(entry.loopStart, entry.loopEnd)
    if (!source.hasSpeed(entry.speedPitch?.speed)) source.setSpeed(entry.speedPitch?.speed)
    if (!source.hasCrossfadeSeconds(entry.crossfadeSeconds)) source.setCrossfadeSeconds(entry.crossfadeSeconds)
  } else if (desiredKind === 'scatter-stream') {
    if (!source.hasFilters(entry.filters)) source.setFilters(entry.filters)
    if (!source.hasLoopPoints(entry.loopStart, entry.loopEnd)) source.setLoopPoints(entry.loopStart, entry.loopEnd)
    if (!source.hasScatterConfig(effectiveScatter(entry))) source.setScatterConfig(effectiveScatter(entry))
  } else if (desiredKind === 'scatter-buffer') {
    if (!source.hasScatterConfig(effectiveScatter(entry))) source.setScatterConfig(effectiveScatter(entry))
  } else if (desiredKind === 'scheduled-stream') {
    if (!source.hasFilters(entry.filters)) source.setFilters(entry.filters)
    if (!source.hasLoopPoints(entry.loopStart, entry.loopEnd)) source.setLoopPoints(entry.loopStart, entry.loopEnd)
    if (!source.hasScheduleConfig(effectiveSchedule(entry))) source.setScheduleConfig(effectiveSchedule(entry))
  } else if (desiredKind === 'scheduled-buffer') {
    if (!source.hasScheduleConfig(effectiveSchedule(entry))) source.setScheduleConfig(effectiveSchedule(entry))
  }
}

function reconcileSource(entry) {
  const source = state.sources.get(entry.id)
  if (!source) return

  if (sourceNeedsSwap(entry, source)) {
    swapSource(entry)
    return
  }

  patchSourceSettings(entry, source, desiredSourceKind(entry))
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

// Set true once state.included has been seeded from the persisted per-sound
// `included` flags. Only the very first library load does this - after that
// state.included is authoritative and kept in sync with disk by
// startPlayback/toggleIncluded, so re-seeding on every tab-switch
// refreshList() would risk a fire-and-forget persistIncluded() write that
// hasn't landed yet clobbering an in-session change.
let includedSeeded = false

// Per-preset sound overrides (planned 2026-09-12, "presets as primary
// context"): merges the active preset's own per-sound overrides on top of
// each sound's baseline into state.library, so every existing read site
// below (reconcileSource, desiredSourceKind, getOrCreateSource,
// loopClipEligible, bufferBakeSnapshot, maybeAutoBake, tryCreateBufferSource,
// testFireOneShot, propagateSync, and loadPresetInner's own per-item lookup)
// can keep reading entry.filters/entry.loopStart/etc. exactly as before -
// they're all now transparently reading the *effective* view instead of raw
// baseline, with zero changes needed to any of their bodies. Only
// applyBulkFilterPreset reads state.baselineById directly instead (see its
// own comment for why). Recomputed on refreshList() and whenever the active
// preset (or its sounds/overrides) changes.
function recomputeEffectiveLibrary() {
  const overridesById = new Map(
    state.activePresetSounds.filter((s) => s.overrides).map((s) => [s.soundId, s.overrides])
  )
  state.library = [...state.baselineById.values()].map((entry) => applySoundOverride(entry, overridesById.get(entry.id)))
}

async function refreshList() {
  const baseline = await api.library.list()
  state.baselineById = new Map(baseline.map((entry) => [entry.id, entry]))
  // BUG FIX (reported: "opened the app after an update and no preset was
  // playing nor loaded - hit play and nothing played"). "In mix" membership
  // is persisted per-sound (persistIncluded), but state.included - the Set
  // "Play all" iterates and every row's In Mix / Add label reads - was only
  // ever populated by startPlayback/toggleIncluded during a session, or by
  // maybeResumeOnLaunch (which only runs when the app was actually *playing*,
  // not merely paused, on close). So closing the app while paused dropped the
  // whole mix: every sound showed "Add", the Current Mix section was empty,
  // and Play all had nothing to start. Seed it from the persisted flags,
  // once, on the first load (missing sounds excluded, matching
  // maybeResumeOnLaunch).
  if (!includedSeeded) {
    for (const entry of baseline) {
      if (entry.included && entry.status !== 'missing') state.included.add(entry.id)
    }
    includedSeeded = true
  }
  for (const entry of baseline) {
    // Seeds state.volumes from the persisted value the first time this
    // entry is seen in a session (e.g. right after app startup, when
    // state.volumes is empty) - never overwrites a value already set this
    // session, so it doesn't fight an in-progress slider drag.
    if (!state.volumes.has(entry.id)) state.volumes.set(entry.id, entry.volume ?? DEFAULT_VOLUME)
  }
  recomputeEffectiveLibrary()
  for (const entry of state.library) reconcileSource(entry)
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
//
// BUG FIX (v0.1.223): this used to skip any sound that had *ever* been
// baked, so a clip that went stale (a preset override changed without a
// Remix save, another preset's settings baked over the shared clip, a
// Remix render that failed) left the sound streaming for good - no Pitch,
// Reverse, Doppler or noise reduction, and a rougher seam. It now re-bakes
// whenever the clip doesn't match the sound's current effective settings.
function maybeAutoBake(entry) {
  if (loopClipEligible(entry) || autoBaking.has(entry.id)) return
  const loopEnd = entry.loopEnd ?? entry.durationSeconds
  if (loopEnd == null) return
  if (loopEnd - entry.loopStart > MAX_BUFFER_CLIP_SECONDS) return
  const snapshot = bufferBakeSnapshot(entry)
  if (autoBakedSnapshots.get(entry.id) === snapshot) return
  autoBakedSnapshots.set(entry.id, snapshot)

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
    // presetId (planned 2026-09-12, "presets as primary context"): lets the
    // main process check bake-eligibility against this preset's effective
    // (possibly overridden) view of the sound, not just its raw baseline -
    // see library.js's getLoopClipPathForId.
    const response = await fetch(`sound://${entry.id}?variant=clip&presetId=${state.activePresetId ?? ''}`)
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const audioBuffer = await engine.context.decodeAudioData(arrayBuffer)
    const volume = state.volumes.get(entry.id) ?? DEFAULT_VOLUME
    let source
    if (isScatter) {
      source = new BufferScatterSource(engine, { audioBuffer, volume, scatter: effectiveScatter(entry), oneShot })
      if (!oneShot) source.onShotStart = () => propagateSync(entry.id)
    } else if (isScheduled) {
      source = new BufferScheduledSource(engine, { audioBuffer, volume, schedule: effectiveSchedule(entry) })
    } else {
      source = new BufferSoundSource(engine, { audioBuffer, volume, fluctuation: effectiveFluctuation(entry) })
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
  // routeSound is idempotent (a no-op once already routed correctly, see its
  // own comment in AudioEngine.js) - calling it here too, not just right
  // after a fresh source is constructed below, means a cached source's Sound
  // Groups routing self-heals on every access instead of depending on every
  // future group-membership change remembering to loop over state.sources
  // and re-route each one by hand.
  //
  // BUG FIX: a cached source used to be trusted on its settings as much as
  // its routing - but nothing actually re-checks settings just by playing a
  // sound, only specific edit-time bridge events do (sound-override-changed,
  // sound-baseline-changed, sound-fluctuation-changed, sound-groups-changed).
  // A source sitting paused (stopPlayback never disposes it - see its own
  // comment) stays in state.sources indefinitely, so any edit path that
  // reaches this entry without going through one of those specific events -
  // or a future one that doesn't yet exist - left the *next* play (a toggle
  // back on, or the global Play-all resume loop, which calls startPlayback
  // for every included sound without reconciling any of them first) silently
  // serving stale filters/speed/pitch/loop-points/scatter-or-schedule config,
  // or a stale baked clip, with no self-heal short of some *other* action
  // happening to sweep the whole library (switching presets, a group
  // membership change, a tab-switch refresh) - reported directly as sounds
  // playing with the wrong settings, or in one case likely silence (a stale
  // buffer clip surviving what should have been a swap). Same "don't trust
  // the cache, verify on every access" fix as the routeSound call above,
  // now applied to what the source actually plays, not just where it's
  // plugged in.
  if (source) {
    if (sourceNeedsSwap(entry, source)) {
      source.dispose()
      state.sources.delete(entry.id)
      source = null
    } else {
      patchSourceSettings(entry, source, desiredSourceKind(entry))
      engine.routeSound(entry.id, source)
      return source
    }
  }

  if (loopClipEligible(entry)) {
    source = await tryCreateBufferSource(entry)
  }

  if (!source) {
    const isScatter = entry.playMode === 'scatter'
    const isScheduled = entry.playMode === 'scheduled'
    const volume = state.volumes.get(entry.id) ?? DEFAULT_VOLUME
    source = isScatter
      ? new StreamScatterSource(engine, {
          soundId: entry.id,
          loopStart: entry.loopStart,
          loopEnd: entry.loopEnd,
          volume,
          filters: entry.filters,
          scatter: effectiveScatter(entry)
        })
      : isScheduled
        ? new StreamScheduledSource(engine, {
            soundId: entry.id,
            loopStart: entry.loopStart,
            loopEnd: entry.loopEnd,
            volume,
            filters: entry.filters,
            schedule: effectiveSchedule(entry)
          })
        : new LocalFileSoundSource(engine, {
            soundId: entry.id,
            loopStart: entry.loopStart,
            loopEnd: entry.loopEnd,
            volume,
            filters: entry.filters,
            speed: entry.speedPitch?.speed,
            crossfadeSeconds: entry.crossfadeSeconds,
            fluctuation: effectiveFluctuation(entry)
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
  engine.routeSound(entry.id, source)
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
  return state.mutedSounds.has(id) ? 0 : (state.volumes.get(id) ?? DEFAULT_VOLUME)
}

async function startPlayback(id, entry) {
  state.errors.delete(id)
  state.loading.add(id)
  render()
  try {
    const source = await getOrCreateSource(entry)
    if (!state.volumes.has(id)) state.volumes.set(id, entry.volume ?? DEFAULT_VOLUME)
    source.setVolume(effectiveVolume(id))
    await source.play()
    const newlyIncluded = !state.included.has(id)
    state.playing.add(id)
    state.included.add(id)
    persistIncluded(id, true)
    persistPlayingState()
    if (newlyIncluded) autosaveActivePreset()
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
    autosaveActivePreset()
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
  // A volume tweak on a sound that's part of the loaded preset is a preset
  // edit too - persist it back (only matters when this id is in state.included).
  if (state.included.has(id)) autosaveActivePreset()
}

// Sets several sounds' volumes at once without touching mute (unlike
// changeVolume, which unmutes on a drag). Used by the Clip report's fixes.
function setSoundVolumes(volumes) {
  for (const [id, volume] of volumes) {
    state.volumes.set(id, volume)
    state.sources.get(id)?.setVolume(effectiveVolume(id))
    api.library.updateVolume(id, volume)
  }
  autosaveActivePreset()
  render()
}

// Clip report (Clip Diagnostics Design): a red light's click lands here.
function showClipReport({ kind, id, meter }, anchor) {
  const nameOf = (soundId) => state.library.find((s) => s.id === soundId)?.name ?? 'Unknown sound'
  const memberIds = kind === 'group' ? engine.groupMemberIds(id) : kind === 'mix' ? [...state.included] : []
  // Peaks caught at the moment it clipped; a sound's current peak if the
  // snapshot missed it (it started after the clip).
  const members = memberIds.map((soundId) => ({
    id: soundId,
    name: nameOf(soundId),
    peak: meter.blame?.get(soundId) ?? engine.soundMeters.get(soundId)?.maxPeak ?? 0
  }))
  const name = kind === 'sound' ? nameOf(id) : kind === 'group' ? state.groups.find((g) => g.id === id)?.name ?? 'Group' : null
  const report = buildClipReport({ kind, id, name, maxPeak: meter.maxPeak, members })
  const reset = () => (kind === 'mix' ? engine.resetAllMeters() : meter.reset())
  openClipReport(anchor, { report, onFix: (fix) => applyClipFix(fix, reset), onReset: reset })
}

// Applies a Clip report fix and returns its undo.
async function applyClipFix(fix, resetLight) {
  if (fix.kind === 'group') {
    let before = null
    await setGroupGainDb(fix.id, (gainDb) => {
      before = gainDb
      return lowerGroupGainDb(gainDb, fix.lowerDb).gainDb
    })
    resetLight()
    return () => setGroupGainDb(fix.id, () => before)
  }
  const ids = fix.kind === 'sound' ? [fix.id] : [...state.included]
  const before = new Map(ids.map((id) => [id, state.volumes.get(id) ?? DEFAULT_VOLUME]))
  setSoundVolumes(new Map([...before].map(([id, v]) => [id, lowerGain(v, fix.lowerDb)])))
  resetLight()
  return () => setSoundVolumes(before)
}

// Same queue as membership edits, so a fix can't race another group write.
function setGroupGainDb(groupId, nextGainDb) {
  _groupMembershipQueue = _groupMembershipQueue.then(async () => {
    const presetId = state.activePresetId
    if (!presetId) return
    const updated = state.groups.map((g) =>
      g.id === groupId ? { ...g, filters: { ...(g.filters ?? {}), gainDb: nextGainDb(g.filters?.gainDb ?? 0) } } : g
    )
    const saved = await api.presets.updateGroups(presetId, updated)
    if (presetId !== state.activePresetId) return
    state.groups = saved?.groups ?? updated
    engine.setSoundGroups(state.groups)
    window.dispatchEvent(new CustomEvent('noctivago:sound-groups-changed', { detail: { presetId, joinedSoundId: null } }))
  })
  return _groupMembershipQueue
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
// Shared mechanics for both solo flavors below (single-sound and group) -
// only mutes sounds actually in state.included (muting an excluded sound
// would do nothing audible and could confuse the un-solo step), and only
// ones not already muted, so a sound the user muted by hand stays muted
// after either kind of solo releases. The two *states* (soloedSoundId vs.
// soloedGroupId) stay genuinely separate, not generalized into one - several
// places (SoundRow highlighting) read soloedSoundId as a scalar "is this the
// one" - but there's no reason the mute/unmute loop itself needs two copies.
function muteAllExcept(keepIds, mutedSet) {
  for (const id of state.included) {
    if (keepIds.has(id) || state.mutedSounds.has(id)) continue
    state.mutedSounds.add(id)
    mutedSet.add(id)
    state.sources.get(id)?.setVolume(effectiveVolume(id))
  }
}

function releaseMuted(mutedSet) {
  for (const id of mutedSet) {
    state.mutedSounds.delete(id)
    state.sources.get(id)?.setVolume(effectiveVolume(id))
  }
  mutedSet.clear()
}

// Single-target solo (like a DAW's own solo buttons, not a solo *group*):
// soloing a second sound while one's already soloed switches the target
// rather than stacking. releaseSolo() is the one path that ever un-mutes
// what solo itself muted, called both by a plain toggle-off and by
// applySolo() itself when the target changes - this makes applySolo(id,
// true) safe to call from either entry point at any time, even mid-solo
// from the *other* one, without ever leaving the new target itself stuck
// muted from the previous solo's own mute pass.
function releaseSolo() {
  releaseMuted(state.soloMutedIds)
  state.soloedSoundId = null
}

function applySolo(soloId, active) {
  if (active) {
    // BUG FIX (self-review, v0.1.149): a caught-live-in-review asymmetry -
    // releaseGroupSolo() already released the single-sound solo before
    // taking over, but this direction never released a group solo, so
    // soloing a group then soloing one sound left both active at once
    // (contradicting the "mutually exclusive" doc comment on
    // applyGroupSolo below), with groupSoloMutedIds stuck stale.
    if (state.soloedGroupId) releaseGroupSolo()
    if (state.soloedSoundId && state.soloedSoundId !== soloId) releaseSolo()
    state.soloedSoundId = soloId
    muteAllExcept(new Set([soloId]), state.soloMutedIds)
  } else if (state.soloedSoundId === soloId) {
    releaseSolo()
  }
  render()
}

function toggleSolo(id) {
  applySolo(id, state.soloedSoundId !== id)
}

// Group solo (v0.1.148) - the merged Remix tab's Group-mode "hear just this
// group" Play/Solo button, same shared mechanics as applySolo/releaseSolo
// above but for a set of ids at once. Mutually exclusive with the
// single-sound solo (each releases the other) rather than stacking, since
// "solo this group" and "solo this one sound" are two different answers to
// the same question ("what do I want to hear right now").
function releaseGroupSolo() {
  releaseMuted(state.groupSoloMutedIds)
  state.soloedGroupId = null
  render()
}

function applyGroupSolo(groupId, memberIds) {
  if (state.soloedSoundId) releaseSolo()
  if (state.soloedGroupId && state.soloedGroupId !== groupId) releaseGroupSolo()
  state.soloedGroupId = groupId
  muteAllExcept(new Set(memberIds), state.groupSoloMutedIds)
  render()
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
  const volume = state.volumes.get(id) ?? entry.volume ?? DEFAULT_VOLUME
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
          scatter: effectiveScatter(entry),
          oneShot: true
        })
      : new StreamScheduledSource(engine, {
          soundId: entry.id,
          loopStart: entry.loopStart,
          loopEnd: entry.loopEnd,
          volume,
          filters: entry.filters,
          schedule: effectiveSchedule(entry),
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
  const wasInMix = state.included.has(id)
  state.sources.get(id)?.dispose()
  state.sources.delete(id)
  engine.removeSoundMeter(id)
  state.playing.delete(id)
  state.included.delete(id)
  state.volumes.delete(id)
  state.mutedSounds.delete(id)
  // Deleting a library sound that was in the loaded preset drops it from the
  // preset too (currentMixSounds no longer lists it).
  if (wasInMix) autosaveActivePreset()
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
  // Bipolar slider - centre (50) is unity gain, see core/volumeScale.js.
  const volume = state.globalMuted ? 0 : positionToGain(Number(els.globalVolume.value) / 100)
  const now = engine.context.currentTime
  engine.masterGain.gain.cancelScheduledValues(now)
  engine.masterGain.gain.linearRampToValueAtTime(volume, now + 0.05)
}

// Dragging the slider while muted implicitly unmutes - matches the
// convention most OS/media-player volume controls already use, so muting
// doesn't silently "trap" a manual volume change behind an easy-to-miss
// separate button.
let globalVolumeSaveTimer = null
els.globalVolume.addEventListener('input', () => {
  if (state.globalMuted) {
    state.globalMuted = false
    updateGlobalMuteIcon()
  }
  applyGlobalVolume()

  // BUG FIX (reported directly, "actively harmful": a restart/autoupdate
  // could bring a quieted-down mix back to full, sharp volume while the
  // owner was asleep) - this slider's position was never persisted at all,
  // so every launch silently reset it to the HTML default (unity). Debounced
  // the same way per-sound volume already is (see VOLUME_SAVE_DEBOUNCE_MS
  // above), so a drag doesn't flood settings.js with writes.
  clearTimeout(globalVolumeSaveTimer)
  globalVolumeSaveTimer = setTimeout(() => {
    globalVolumeSaveTimer = null
    api.settings.setGlobalVolumePosition(Number(els.globalVolume.value))
  }, VOLUME_SAVE_DEBOUNCE_MS)
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

els.addSoundRecordItem.addEventListener('click', () => {
  closeAddSoundMenu()
  openRecordDialog()
})

els.addSoundLinkItem.addEventListener('click', () => {
  closeAddSoundMenu()
  openAddLinkDialog()
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

  try {
    const added = await api.library.addFolderSounds(pickedFolder, { keepCopy: els.addFolderPresetKeepCopy.checked })
    if (added.length === 0) {
      els.addFolderPresetConfirm.disabled = false
      els.addFolderPresetStatus.textContent = 'No audio files found in that folder (including subfolders).'
      return
    }

    await api.presets.save({
      name,
      sounds: added.map((entry) => ({ soundId: entry.id, volume: DEFAULT_VOLUME }))
    })

    if (els.addFolderPresetTag.checked && pickedFolderPresetTagName) {
      await Promise.all(added.map((entry) => api.library.updateTags(entry.id, [...(entry.tags ?? []), pickedFolderPresetTagName])))
    }

    pickedFolder = null
    pickedFolderPresetTagName = null
    hideModal(els.addFolderPresetDialog)
    await refreshList()
  } catch {
    els.addFolderPresetStatus.textContent = 'Something went wrong adding that folder. Try again.'
  } finally {
    els.addFolderPresetConfirm.disabled = false
  }
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

  try {
    const added = await api.library.addFolderSounds(pickedFolderForTag, { keepCopy: els.addFolderTagKeepCopy.checked })
    if (added.length === 0) {
      els.addFolderTagConfirm.disabled = false
      els.addFolderTagStatus.textContent = 'No audio files found in that folder (including subfolders).'
      return
    }

    await Promise.all(added.map((entry) => api.library.updateTags(entry.id, [...(entry.tags ?? []), tag])))

    pickedFolderForTag = null
    hideModal(els.addFolderTagDialog)
    await refreshList()
  } catch {
    els.addFolderTagStatus.textContent = 'Something went wrong adding that folder. Try again.'
  } finally {
    els.addFolderTagConfirm.disabled = false
  }
})

async function refreshPresetList() {
  const presets = await api.presets.list()
  renderPresetList(els.presetList, presets, {
    onLoad: loadPreset,
    onDelete: deletePreset,
    onExport: exportPreset
  })
  updateActivePresetButtonState(presets)
}

// Shows/labels the "Save changes" button for whatever preset was last
// loaded (state.activePresetId - set by loadPreset, never cleared just by
// editing the mix by hand, see loadPreset's own comment) - hidden entirely
// if nothing's been loaded yet, or if that preset was deleted since.
function updateActivePresetButtonState(presets) {
  const active = presets.find((p) => p.id === state.activePresetId)
  setActivePresetIndicator(active?.name ?? null)
  if (!active) {
    els.updateActivePresetBtn.classList.add('hidden')
    els.presetAutosaveNote.classList.add('hidden')
    return
  }
  els.updateActivePresetBtn.classList.remove('hidden')
  els.presetAutosaveNote.classList.remove('hidden')
  updatePresetAutosaveNoteText()
  els.updateActivePresetLabel.textContent = `Save "${active.name}" now`
}

// The top-bar preset-name indicator (index.html, left of the Play-all
// controls). Kept in sync from every place state.activePresetId changes -
// loadPreset / restoreLastActivePreset / deletePreset directly (they have
// the preset in hand and don't all round-trip through refreshPresetList),
// plus updateActivePresetButtonState above for renames / external edits.
function setActivePresetIndicator(name) {
  const has = Boolean(name)
  els.activePresetIndicator.classList.toggle('has-preset', has)
  els.activePresetName.textContent = has ? name : 'No preset'
  els.activePresetIndicator.title = has ? `Editing preset "${name}"` : 'No preset loaded'
}

async function exportPreset(preset) {
  els.presetSaveHint.textContent = ''
  const result = await api.presets.export(preset.id)
  if (result.canceled) return
  if (!result.ok) {
    els.presetSaveHint.classList.remove('ok')
    els.presetSaveHint.textContent = result.error ?? 'Export failed.'
    return
  }
  els.presetSaveHint.classList.add('ok')
  const mb = result.totalBytes ? ` · ${(result.totalBytes / (1024 * 1024)).toFixed(1)} MB of audio` : ''
  const missing = result.soundCount - (result.audioCount ?? result.soundCount)
  const missingNote = missing > 0 ? ` (${missing} missing its file)` : ''
  els.presetSaveHint.textContent = `Exported "${preset.name}" — ${result.soundCount} sound${result.soundCount === 1 ? '' : 's'}${missingNote}${mb}.`
}

async function openPresetsModal() {
  els.presetSaveHint.textContent = ''
  els.presetSaveHint.classList.remove('ok')
  // Make sure the list about to be rendered reflects any just-made mix edit
  // that's still inside the autosave debounce window.
  await flushPresetAutosave()
  await refreshPresetList()
  showModal(els.presetsModal)
}

els.openPresetsBtn.addEventListener('click', openPresetsModal)
// The top-bar active-preset indicator (v0.1.165) doubles as a shortcut into
// the Presets modal - it reads as a button, and "which preset am I on → tap
// → load a different one" is the natural next action. Works whether or not a
// preset is currently loaded (the "No preset" state opens it to pick one).
els.activePresetIndicator.addEventListener('click', openPresetsModal)

els.presetsClose.addEventListener('click', () => hideModal(els.presetsModal))

// Shared by both the "Save changes" (update-in-place) and "Save as new
// preset" (always creates) buttons - the currently-included sounds/volumes,
// in the exact shape both api.presets.save and api.presets.updateSounds
// expect.
//
// BUG FIX RISK, avoided here (planned 2026-09-12, "presets as primary
// context"): this function feeds autosave, which fires on nearly every mix
// edit (a volume drag, add/remove) via a 600ms debounce - if it didn't carry
// each sound's existing `overrides` forward, the very next volume drag after
// a Remix per-preset override save would silently erase that override. Look
// it up from state.activePresetSounds (the active preset's own sounds[],
// kept current by loadPresetInner/restoreLastActivePreset/the
// sound-override-changed listener) rather than dropping it.
function currentMixSounds() {
  const existingById = new Map(state.activePresetSounds.map((s) => [s.soundId, s]))
  return [...state.included].map((id) => ({
    soundId: id,
    volume: state.volumes.get(id) ?? DEFAULT_VOLUME,
    overrides: existingById.get(id)?.overrides ?? null
  }))
}

// Autosave-on-edit for the loaded preset (owner request, inbox 2026-09-10:
// "Are presets being autosaved? If not they should be" - matching how the
// Remix tab autosaves its edits). While a preset is loaded, any mix mutation
// - adding or removing a sound, or dragging a per-sound volume - writes the
// new sound list straight back into that preset. Debounced so a volume drag
// doesn't hammer electron-store's synchronous file write. The explicit "Save
// changes to X" button stays as a save-now affordance but is rarely needed.
//
// - `presetAutosaveReady` gates out the startup sequence (restoreLastActive-
//   Preset + maybeResumeOnLaunch fire startPlayback for each resumed sound
//   before the user has touched anything - no need to rewrite the preset with
//   what it already contains).
// - `presetAutosaveLoading` gates out loadPreset() itself, which mutates
//   state.included / state.volumes heavily while converging on the preset's
//   own contents.
// - An empty mix is never persisted (matches the explicit button's own rule)
//   so toggling a preset's last sound off doesn't blow the preset away.
// - The pending write captures the preset id and bails if the active preset
//   changed during the debounce, so a fast A->B switch can't write A's mix
//   into B.
const PRESET_AUTOSAVE_DEBOUNCE_MS = 600
let presetAutosaveReady = false
let presetAutosaveLoading = false
let presetAutosaveTimer = null
// Owner inbox (2026-09-12): "Autosave should be a toggle on the preset
// modal" - a plain opt-out for the whole autosave behavior above, on by
// default. Mirrors settings.js's presetAutosaveEnabled; kept as a live local
// var (rather than re-reading api.settings.get() on every mix edit) since
// autosaveActivePreset() can fire on every volume drag.
let presetAutosaveUserEnabled = true

function updatePresetAutosaveNoteText() {
  els.presetAutosaveNote.textContent = presetAutosaveUserEnabled
    ? 'Changes to the loaded preset save automatically as you edit the mix.'
    : 'Autosave is off - use "Save … now" below to update this preset by hand.'
}

// BUG FIX (v0.1.223): state.activePresetSounds used to be set only when a
// preset loaded, so it went stale as soon as the mix changed (a sound added
// mid-session wasn't in it). Remix's override events for such a sound were
// dropped, and currentMixSounds() sent its overrides as null. After every
// preset write, the stored preset (which main keeps the overrides on - see
// presets.js's updatePresetSounds) becomes the Mixer's copy again.
function adoptActivePresetSounds(preset) {
  if (!preset || preset.id !== state.activePresetId) return
  state.activePresetSounds = preset.sounds ?? []
  recomputeEffectiveLibrary()
  for (const entry of state.library) reconcileSource(entry)
}

function autosaveActivePreset() {
  if (!presetAutosaveReady || presetAutosaveLoading || !presetAutosaveUserEnabled) return
  const presetId = state.activePresetId
  if (!presetId || state.included.size === 0) return
  clearTimeout(presetAutosaveTimer)
  presetAutosaveTimer = setTimeout(async () => {
    presetAutosaveTimer = null
    if (state.activePresetId !== presetId || state.included.size === 0) return
    const updated = await api.presets.updateSounds(presetId, currentMixSounds())
    adoptActivePresetSounds(updated)
    if (updated && !els.presetsModal.classList.contains('hidden')) {
      els.presetSaveHint.classList.add('ok')
      els.presetSaveHint.textContent = `Autosaved changes to "${updated.name}".`
      await refreshPresetList()
    }
  }, PRESET_AUTOSAVE_DEBOUNCE_MS)
}

// Forces any pending autosave to land immediately (and synchronously awaits
// it) - called before switching presets or opening the Presets modal, so the
// debounce window can't drop the last edit or land it against the wrong
// preset.
async function flushPresetAutosave() {
  if (!presetAutosaveTimer) return
  clearTimeout(presetAutosaveTimer)
  presetAutosaveTimer = null
  const presetId = state.activePresetId
  if (!presetId || state.included.size === 0) return
  adoptActivePresetSounds(await api.presets.updateSounds(presetId, currentMixSounds()))
}

els.updateActivePresetBtn.addEventListener('click', async () => {
  if (!state.activePresetId) return
  if (state.included.size === 0) {
    els.presetSaveHint.classList.remove('ok')
    els.presetSaveHint.textContent = 'Add at least one sound to the mix before saving.'
    return
  }
  const updated = await api.presets.updateSounds(state.activePresetId, currentMixSounds())
  adoptActivePresetSounds(updated)
  els.presetSaveHint.classList.add('ok')
  els.presetSaveHint.textContent = updated ? `Saved changes to "${updated.name}".` : 'Could not save - that preset may have been deleted.'
  await refreshPresetList()
})

els.savePresetBtn.addEventListener('click', async () => {
  const name = els.newPresetName.value.trim()
  if (!name) {
    els.newPresetName.focus()
    els.newPresetName.placeholder = 'Enter a name first'
    return
  }
  if (state.included.size === 0) {
    els.presetSaveHint.classList.remove('ok')
    els.presetSaveHint.textContent = 'Add at least one sound to the mix before saving a preset.'
    return
  }
  els.presetSaveHint.textContent = ''
  // BUG FIX (reported directly, "obviously a bug"): this used to send only
  // `sounds`, so saving the current mix as a new preset silently dropped
  // whatever whole-mix filters/EQ and Sound Groups the currently-loaded
  // preset had. state.groups already tracks "the active preset's groups, or
  // [] if none" (see loadPresetInner/deletePreset); wholeMix isn't cached in
  // state at all (it's applied straight onto the live engine.wholeMix node),
  // so it's re-fetched from the active preset's own record here.
  const activePreset = state.activePresetId
    ? (await api.presets.list()).find((p) => p.id === state.activePresetId)
    : null
  const storedOverrides = new Map((activePreset?.sounds ?? []).map((item) => [item.soundId, item.overrides]))
  await api.presets.save({
    name,
    sounds: currentMixSounds().map((item) =>
      storedOverrides.has(item.soundId) ? { ...item, overrides: storedOverrides.get(item.soundId) } : item
    ),
    wholeMix: activePreset?.wholeMix ?? null,
    groups: state.groups
  })
  els.newPresetName.value = ''
  await refreshPresetList()
})

// Owner inbox (2026-09-12): "creating a new preset there should be 2
// options" - a clean-slate preset alongside the existing (now-renamed,
// same note) "based on the current mix" save above. Always empty regardless
// of what's currently in the mix, then loaded like any other preset (via
// the same loadPreset every other entry point uses) so the Mixer actually
// clears down to nothing, ready to build up from scratch.
els.newPresetBlankBtn.addEventListener('click', async () => {
  const name = els.newPresetName.value.trim()
  if (!name) {
    els.newPresetName.focus()
    els.newPresetName.placeholder = 'Enter a name first'
    return
  }
  els.presetSaveHint.textContent = ''
  const created = await api.presets.save({ name, sounds: [], wholeMix: null, groups: [] })
  els.newPresetName.value = ''
  await refreshPresetList()
  if (created) await loadPreset(created)
})

els.presetAutosaveToggle.addEventListener('change', () => {
  presetAutosaveUserEnabled = els.presetAutosaveToggle.checked
  api.settings.setPresetAutosaveEnabled(presetAutosaveUserEnabled)
  updatePresetAutosaveNoteText()
})

// Only touches sounds that actually changed between the current mix and the
// preset being loaded, so sounds common to both keep playing uninterrupted
// (just a volume update) instead of being stopped and immediately restarted.
async function loadPreset(preset) {
  // Land any pending autosave against the *current* preset before we switch
  // away from it, then suppress autosave for the duration of this load (it
  // churns state.included / state.volumes heavily while converging on the
  // new preset's own contents).
  await flushPresetAutosave()
  presetAutosaveLoading = true
  try {
    await loadPresetInner(preset)
  } finally {
    presetAutosaveLoading = false
  }
}

async function loadPresetInner(preset) {
  // A group solo from the *previous* preset means nothing once its sounds
  // are gone from the mix - releasing it here avoids leaving unrelated
  // sounds from the newly-loaded preset stuck muted by a stale solo.
  if (state.soloedGroupId) releaseGroupSolo()

  const newIds = new Set(preset.sounds.map((s) => s.soundId))

  for (const id of [...state.included]) {
    if (!newIds.has(id)) {
      state.included.delete(id)
      persistIncluded(id, false)
      stopPlayback(id)
    }
  }

  await engine.resume()

  // Per-preset sound overrides (planned 2026-09-12, "presets as primary
  // context"): activePresetId/activePresetSounds must be current, and
  // state.library re-merged, BEFORE the per-item startPlayback loop below -
  // otherwise a sound would start playing under the *previous* preset's (or
  // no) overrides for one tick. Moved up from where this used to sit (after
  // the loop) for exactly this reason.
  state.activePresetId = preset.id
  state.activePresetSounds = preset.sounds ?? []
  recomputeEffectiveLibrary()
  // BUG FIX (reported directly, "actively harmful"): which preset was
  // loaded was never persisted, so a restart/autoupdate silently dropped
  // whatever Sound Group EQ/whole-mix processing was shaping the mix - see
  // restoreLastActivePreset(), called on next launch.
  api.settings.setLastActivePresetId(preset.id)
  setActivePresetIndicator(preset.name)

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

  // Whole-mix processing (Preset Remix plugin). Installed on the shared
  // engine chain here, with the preset's fade-in only on an actual load;
  // swapped out / reset to neutral whenever another preset is loaded.
  engine.wholeMix.set(preset.wholeMix ?? null, { fadeInSeconds: preset.wholeMix?.fadeInSeconds ?? 0 })

  // Sound Groups (see AudioEngine.js's SoundGroupChain) - install this
  // preset's groups and re-route every already-live source to match, since
  // switching presets can change (or clear) which group a given sound
  // belongs to.
  state.groups = preset.groups ?? []
  state.groupFilterPreviews.clear()
  engine.setSoundGroups(state.groups)
  for (const [id, source] of state.sources) engine.routeSound(id, source)
  // Sounds above started before this preset's groups were installed, so a
  // group's pan-drift override (effectiveFluctuation) needs re-applying.
  for (const entry of state.library) reconcileSource(entry)

  // Lets the Remix plugin's Sound mode (a separate, sandboxed JS realm) know
  // the active preset changed, so a sound it has open can offer to reload
  // under the new editing context - see plugins/editor/index.js's own
  // listener.
  window.dispatchEvent(new CustomEvent('noctivago:active-preset-changed', { detail: { presetId: state.activePresetId } }))

  hideModal(els.presetsModal)
  render()
}

// "Always a preset loaded" (planned 2026-09-12, "presets as primary
// context"): deleting a preset can no longer leave the app with nothing
// active. presets.js's deletePreset already force-creates a replacement
// "Default" (carrying the deleted preset's own per-sound overrides forward)
// whenever the deletion empties the list entirely; this picks that up (or,
// if other presets remain, auto-selects one of them) rather than leaving
// state.activePresetId null the way it used to.
async function deletePreset(id) {
  const replacement = await api.presets.delete(id)
  // If the deleted preset was the active one, its groups no longer exist
  // anywhere - clear the cache the context menu reads (state.groups) and
  // re-route every live source back to masterGain, the same reset loadPreset
  // already does when switching to a preset with no groups.
  if (id === state.activePresetId) {
    if (state.soloedGroupId) releaseGroupSolo()
    state.activePresetId = null
    state.groups = []
    engine.setSoundGroups([])
    for (const [sourceId, source] of state.sources) engine.routeSound(sourceId, source)

    if (replacement) {
      // The deletion emptied the list - the main process already force-
      // created a fresh Default. Load it immediately rather than waiting for
      // the next restart to notice.
      await loadPreset(replacement)
    } else {
      // Other presets still exist - auto-select one instead of leaving
      // nothing active.
      const remaining = await api.presets.list()
      if (remaining[0]) {
        await loadPreset(remaining[0])
      } else {
        api.settings.setLastActivePresetId(null)
        setActivePresetIndicator(null)
        window.dispatchEvent(new CustomEvent('noctivago:active-preset-changed', { detail: { presetId: null } }))
      }
    }
  }
  await refreshPresetList()
}

// Portable preset import. The analyzed manifest (from presets:pickImport) is
// held here while the dialog is open; each sound's `matchedSoundId` starts
// either set (already in the library) or null (needs a file), and a Locate…
// resolves it in place.
let importAnalysis = null

function renderImport() {
  els.presetImportName.textContent = importAnalysis.name
  renderPresetImportList(els.presetImportList, importAnalysis.sounds, { onLocate: locateImportSound })
  const resolved = importAnalysis.sounds.filter((s) => s.matchedSoundId || s.fromBundle || s.fromFreesound).length
  const total = importAnalysis.sounds.length
  els.presetImportConfirm.disabled = resolved === 0
  els.presetImportStatus.textContent =
    resolved === total
      ? `All ${total} sound${total === 1 ? '' : 's'} ready.`
      : `${resolved} of ${total} ready — unresolved sounds will be left out of the preset.`
}

function openImportDialog(analysis) {
  if (importAnalysis?.importSessionId) api.presets.cancelImport(importAnalysis.importSessionId)
  importAnalysis = analysis
  renderImport()
  showModal(els.presetImportDialog)
}

els.importPresetBtn.addEventListener('click', async () => {
  const result = await api.presets.pickImport()
  if (result.canceled) return
  if (!result.ok) {
    els.presetSaveHint.classList.remove('ok')
    els.presetSaveHint.textContent = result.error ?? 'Could not read that preset file.'
    return
  }
  openImportDialog(result)
})

// The Community plugin downloads a shared preset and hands its analysis here
// (the same shape presets:pickImport returns), so both entry points share one
// import dialog. Dispatched synchronously; detail.handled tells the plugin
// the dialog actually opened.
window.addEventListener('noctivago:open-preset-import', (event) => {
  const analysis = event.detail?.analysis
  if (!analysis?.ok) return
  openImportDialog(analysis)
  event.detail.handled = true
})

async function locateImportSound(index) {
  const sound = importAnalysis.sounds[index]
  const result = await api.presets.resolveImportedSound(sound)
  if (result.canceled) return
  if (!result.ok) {
    els.presetImportStatus.textContent = result.error ?? 'Could not import that file.'
    return
  }
  sound.matchedSoundId = result.soundId
  await refreshList()
  renderImport()
}

els.presetImportCancel.addEventListener('click', () => {
  if (importAnalysis?.importSessionId) api.presets.cancelImport(importAnalysis.importSessionId)
  importAnalysis = null
  hideModal(els.presetImportDialog)
  window.dispatchEvent(new CustomEvent('noctivago:preset-import-finished', { detail: { result: { ok: false, canceled: true } } }))
})

els.presetImportConfirm.addEventListener('click', async () => {
  if (!importAnalysis) return
  const anyResolvable = importAnalysis.sounds.some((s) => s.matchedSoundId || s.fromBundle || s.fromFreesound)
  if (!anyResolvable) return
  els.presetImportConfirm.disabled = true
  els.presetImportStatus.textContent = 'Adding sounds…'
  const result = await api.presets.finalizeImport({
    importSessionId: importAnalysis.importSessionId ?? null,
    name: importAnalysis.name,
    sounds: importAnalysis.sounds,
    wholeMix: importAnalysis.wholeMix ?? null,
    groups: importAnalysis.groups ?? []
  })
  importAnalysis = null
  hideModal(els.presetImportDialog)
  await refreshList()
  await refreshPresetList()
  els.presetSaveHint.classList.toggle('ok', Boolean(result.ok))
  els.presetSaveHint.textContent = result.ok
    ? `Preset imported — ${result.soundCount} sound${result.soundCount === 1 ? '' : 's'}${result.failedCount ? ` (${result.failedCount} couldn't be added)` : ''}.`
    : result.error ?? 'Import failed.'
  window.dispatchEvent(new CustomEvent('noctivago:preset-import-finished', { detail: { result } }))
})

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
// back to the Mixer tab. `settings` is passed in (not re-fetched) so this
// runs against the exact same read restoreLastActivePreset() already used,
// and so restoreLastActivePreset() is guaranteed to have installed the
// right Sound Group routing/whole-mix processing before any of these
// sounds actually starts playing.
async function maybeResumeOnLaunch(settings) {
  if (!settings.wasPlayingOnClose) return

  const toResume = state.library.filter((entry) => entry.included && entry.status !== 'missing')
  if (toResume.length === 0) return

  await engine.resume()
  for (const entry of toResume) {
    await startPlayback(entry.id, entry)
  }
}

// BUG FIX (reported directly, "actively harmful": "every app restart/update
// resets volumes, which preset was loaded, and Sound Group EQ/filters back
// to some earlier state... if the app autoupdates while i'm sleeping and
// there's thunder noises it goes REALLY LOUD AND SHARP"). Whichever preset
// was actively loaded before the app closed silently had zero effect on the
// next launch - any Sound Group EQ/filters or whole-mix processing shaping
// the mix (e.g. taming a loud sound) was gone the moment the app restarted,
// with every sound reverting to its raw, unprocessed settings. Runs before
// maybeResumeOnLaunch so a resumed sound is already correctly routed/
// filtered from its very first frame, not just eventually reconciled.
// Falls back to the first available preset if the remembered one is gone
// (deleted from another machine/session since) or was never set (a fresh
// install, or the very first launch after "presets as primary context"
// bootstraps a Default preset) - "always a preset loaded" is an invariant
// now (planned 2026-09-12), not just a zero-presets special case, so this
// no longer ever leaves the mix with nothing active as long as at least one
// preset exists (which main's bootstrapDefaultPreset guarantees on startup).
async function restoreLastActivePreset(settings) {
  const presets = await api.presets.list()
  let preset = presets.find((p) => p.id === settings.lastActivePresetId)
  if (!preset && presets.length > 0) preset = presets[0]
  if (!preset) {
    // Only reachable if presets.list() is somehow still empty - shouldn't
    // happen given main's startup bootstrap, but leaves the mix neutral
    // rather than throwing if it ever does.
    api.settings.setLastActivePresetId(null)
    return
  }

  state.activePresetId = preset.id
  state.activePresetSounds = preset.sounds ?? []
  recomputeEffectiveLibrary()
  api.settings.setLastActivePresetId(preset.id)
  setActivePresetIndicator(preset.name)
  engine.wholeMix.set(preset.wholeMix ?? null)
  state.groups = preset.groups ?? []
  state.groupFilterPreviews.clear()
  engine.setSoundGroups(state.groups)
  window.dispatchEvent(new CustomEvent('noctivago:active-preset-changed', { detail: { presetId: preset.id } }))
  // No live sources exist yet at this point in mount()'s startup sequence -
  // future ones (from maybeResumeOnLaunch just after, or the user pressing
  // play by hand) pick up the right routing automatically via
  // getOrCreateSource's own routeSound call, same as any other source
  // creation.
}

export function mount(container) {
  container.innerHTML = `
    <input id="sound-search" type="text" class="sound-search" placeholder="Search sounds…" />
    <div class="sound-list-controls">
      <select id="sound-sort" class="sound-sort-select" title="Sort"></select>
      <select id="sound-group" class="sound-group-select" title="Group by"></select>
      <button id="bulk-select-toggle" class="btn btn-small" type="button" title="Select several sounds to apply an effect preset to all of them at once">Select…</button>
    </div>
    <div id="bulk-select-bar" class="bulk-select-bar hidden">
      <span id="bulk-select-count" class="bulk-select-count">0 selected</span>
      <div class="bulk-select-presets">
        <button class="btn btn-small" type="button" data-bulk-preset="muffled">Muffled</button>
        <button class="btn btn-small" type="button" data-bulk-preset="phone">Over the Phone</button>
        <button class="btn btn-small" type="button" data-bulk-preset="radio">On the Radio</button>
        <button class="btn btn-small" type="button" data-bulk-preset="distant">Distant</button>
        <button class="btn btn-small" type="button" data-bulk-preset="echo">Echo</button>
        <button class="btn btn-small" type="button" data-bulk-preset="reverb">Reverb</button>
        <button class="btn btn-small" type="button" data-bulk-preset="underwater">Underwater</button>
        <button id="bulk-select-reset" class="btn btn-small" type="button">Reset filters</button>
      </div>
      <button id="bulk-select-done" class="btn btn-small" type="button">Done</button>
    </div>
    <div id="tag-filter-bar" class="tag-filter-bar hidden"></div>
    <ul id="sound-list" class="sound-list"></ul>
    <p id="empty-state" class="empty-state">No sounds yet. Click "Add Sound" to import one.</p>
  `
  els.soundSearch = container.querySelector('#sound-search')
  els.soundSort = container.querySelector('#sound-sort')
  els.soundGroup = container.querySelector('#sound-group')
  els.bulkSelectToggle = container.querySelector('#bulk-select-toggle')
  els.bulkSelectBar = container.querySelector('#bulk-select-bar')
  els.bulkSelectCount = container.querySelector('#bulk-select-count')
  els.bulkSelectPresetButtons = container.querySelectorAll('[data-bulk-preset]')
  els.bulkSelectReset = container.querySelector('#bulk-select-reset')
  els.bulkSelectDone = container.querySelector('#bulk-select-done')
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
  els.bulkSelectToggle.addEventListener('click', () => {
    state.selectMode = !state.selectMode
    if (!state.selectMode) state.selectedIds.clear()
    updateBulkSelectUI()
    render()
  })
  els.bulkSelectDone.addEventListener('click', () => {
    state.selectMode = false
    state.selectedIds.clear()
    updateBulkSelectUI()
    render()
  })
  for (const button of els.bulkSelectPresetButtons) {
    button.addEventListener('click', () => applyBulkFilterPreset(BULK_FILTER_PRESETS[button.dataset.bulkPreset]))
  }
  els.bulkSelectReset.addEventListener('click', () => applyBulkFilterPreset(BULK_NEUTRAL_FILTERS))
  updateBulkSelectUI()
  // One settings read up front, reused by all three startup steps below
  // instead of each re-fetching its own copy: restore the master volume
  // slider immediately (before anything can play), then restore whichever
  // preset's Sound Group/whole-mix processing was active, then (only then)
  // actually resume playback - see restoreLastActivePreset's own doc
  // comment for why the ordering matters.
  api.settings.get().then(async (settings) => {
    els.globalVolume.value = String(settings.globalVolumePosition)
    applyGlobalVolume()
    presetAutosaveUserEnabled = settings.presetAutosaveEnabled
    els.presetAutosaveToggle.checked = presetAutosaveUserEnabled
    updatePresetAutosaveNoteText()
    await refreshList()
    await restoreLastActivePreset(settings)
    await maybeResumeOnLaunch(settings)
    // Startup is done converging on the restored/resumed state - from here on,
    // mix edits are the user's and should autosave into the loaded preset.
    presetAutosaveReady = true
  })
  // mount() only ever runs once (TabHost lazily mounts each tab a single
  // time), so this is a one-time listener registration, not a per-mount leak.
  window.noctivago.tray.onTogglePlayPause(toggleGlobalPlayback)
  // Lets a sound auto-imported by a watched folder show up immediately even
  // if the user never leaves the Mixer tab (onShow's refresh alone would
  // only catch it on the next tab switch).
  window.noctivago.library.onChanged(refreshList)
  // RecordDialog.js dispatches this on the document (rather than a direct
  // call) since it has no import path back into this module - same "core
  // module talks to the Mixer via a DOM event" pattern the Solo bridge below
  // already established.
  document.addEventListener('library:recorded', refreshList)
document.addEventListener('library:linked', refreshList)
  // See applySolo's own comment for why this is a window event rather than a
  // direct call - Remix's Solo button dispatches { soundId, active }.
  window.addEventListener('noctivago:solo', (e) => {
    applySolo(e.detail.soundId, e.detail.active)
  })
  // The sleep timer (core/SleepTimer.js) dispatches this when its timer
  // elapses with the "stop all sounds" action - same DOM-event bridge, since
  // that core module has no import path into the Mixer's playback state.
  window.addEventListener('noctivago:stop-all-playback', () => {
    for (const id of [...state.playing]) stopPlayback(id)
    render()
  })
  // The Remix plugin's Sound mode dispatches this (debounced) whenever the
  // Fluctuation controls change, having already persisted the new value via
  // library.updateFluctuation. Patch the cached entry and reconcile just
  // that live source, so a sound already in the mix picks up the new drift
  // immediately rather than only on the next full tab-switch refresh -
  // matching how the whole-mix/group preview bridges keep the Mixer in sync.
  window.addEventListener('noctivago:sound-fluctuation-changed', (e) => {
    const { soundId, fluctuation } = e.detail ?? {}
    if (!soundId) return
    const entry = state.library.find((s) => s.id === soundId)
    if (!entry) return
    entry.fluctuation = fluctuation
    reconcileSource(entry)
  })
  // Per-preset sound overrides (planned 2026-09-12, "presets as primary
  // context") - the Remix plugin's Sound mode dispatches this after a
  // successful override save (see plugins/editor/index.js's performSave),
  // having already persisted it via presets:updateSoundOverride. Same
  // "patch the cache, reconcile just that source" pattern as the
  // fluctuation listener above, scoped to the active preset the same way
  // the whole-mix/group preview bridges already are.
  // BUG FIX (v0.1.194): the baked loop clip (getUserData()/clips/<id>.wav)
  // and its loopClipReady/Start/End/Filters/CrossfadeSeconds/SpeedPitch
  // bookkeeping always live on the *shared* baseline sound record (see
  // library.js's setLoopClipReady, called from the same audio:renderLoopClip
  // handler regardless of whether the edit that triggered it came from an
  // override or a baseline Save) - a per-preset override never gets its own
  // separate clip file. So patching only the override here (as this listener
  // used to) left state.baselineById's own loopClip* fields pointing at
  // whatever they were before the bake, which loopClipEligible then compared
  // the freshly-changed speedPitch/filters against and correctly found
  // stale - permanently falling back to stream mode (no live pitch-shift
  // there) instead of picking up the just-baked, already-correct clip. Both
  // listeners now funnel the event's `loopClip` payload through this same
  // helper so the shared baseline record - which every path's eligibility
  // check reads from - always reflects the bake that actually just happened.
  //
  // A pure field-mapper rather than a get-spread-set itself (self-review,
  // v0.1.196: the original shape did its own get+set here, then the
  // sound-baseline-changed listener below did a *second* get+set of the
  // same entry for its own `patch` fields - two full object clones and two
  // Map writes per event where one merged spread does) - each call site
  // folds this into its own single state.baselineById.set().
  const loopClipPatchFields = (loopClip) =>
    loopClip
      ? {
          loopClipReady: loopClip.ready,
          loopClipStart: loopClip.start,
          loopClipEnd: loopClip.end,
          loopClipFilters: loopClip.filters,
          loopClipCrossfadeSeconds: loopClip.crossfadeSeconds,
          loopClipSpeedPitch: loopClip.speedPitch
        }
      : {}
  window.addEventListener('noctivago:sound-override-changed', (e) => {
    const { presetId, soundId, overrides, loopClip } = e.detail ?? {}
    if (!soundId) return
    // BUG FIX (self-review, v0.1.196): this used to sit behind the
    // presetId !== state.activePresetId check below, so saving an override
    // for a preset that *isn't* the one currently loaded in the Mixer never
    // patched the baseline's own loopClip* bookkeeping - even though the
    // bake it describes always lands on the one shared clip file every
    // preset's override reads from (see patchBaselineLoopClip's own comment
    // above). Left unpatched, the baseline's stale loopClipSpeedPitch/
    // Filters could coincidentally still match whatever preset *is* active,
    // making loopClipEligible wrongly report the bake valid - so buffer mode
    // would play a clip that now actually contains a *different* preset's
    // baked settings, with no staleness indicator to catch it. The physical
    // file was overwritten regardless of which preset is active, so this
    // must run unconditionally; only the live-reconcile below (which only
    // matters for whatever's actually audible right now) stays gated on the
    // active preset.
    if (loopClip) {
      const overrideBaseline = state.baselineById.get(soundId)
      if (overrideBaseline) state.baselineById.set(soundId, { ...overrideBaseline, ...loopClipPatchFields(loopClip) })
    }
    if (presetId !== state.activePresetId) return
    // Remix only writes an override for a sound the stored preset contains,
    // so a missing entry just means this copy is behind - add it rather than
    // drop the edit.
    const item = state.activePresetSounds.find((s) => s.soundId === soundId)
    if (item) item.overrides = overrides
    else {
      state.activePresetSounds = [
        ...state.activePresetSounds,
        { soundId, volume: state.volumes.get(soundId) ?? DEFAULT_VOLUME, overrides }
      ]
    }
    recomputeEffectiveLibrary()
    const entry = state.library.find((s) => s.id === soundId)
    if (entry) reconcileSource(entry)
  })
  // BUG FIX (reported directly): a Remix Sound-mode Save whose sound isn't a
  // member of the pinned preset writes straight to the shared baseline (see
  // plugins/editor/index.js's performSave, the `else` branch) instead of a
  // preset override - and unlike the override path above, that write had no
  // push channel back to an already-mounted Mixer at all. `library:changed`
  // (window.noctivago.library.onChanged, wired above) is watch-folder-only,
  // so a sound already playing kept using its old in-memory trim/filters/
  // crossfade/Speed-Pitch/play-mode/scatter/schedule until the next tab
  // switch happened to rerun refreshList(). Reported case: disabling a
  // scatter sound's pitch/speed range "still kept pitch randomized and also
  // speed" - the edit was saved correctly, it just never reached the sound
  // actually playing. Same "patch the cache, recompute, reconcile just that
  // source" shape as the override listener above, but patching
  // state.baselineById (the raw cache recomputeEffectiveLibrary rebuilds
  // state.library from) rather than an override, since there's no override
  // involved here.
  window.addEventListener('noctivago:sound-baseline-changed', (e) => {
    const { soundId, loopClip, ...patch } = e.detail ?? {}
    if (!soundId) return
    const baseline = state.baselineById.get(soundId)
    if (!baseline) return
    state.baselineById.set(soundId, { ...baseline, ...patch, ...loopClipPatchFields(loopClip) })
    recomputeEffectiveLibrary()
    const entry = state.library.find((s) => s.id === soundId)
    if (entry) reconcileSource(entry)
  })
  // The Remix plugin's Preset mode (plugins/editor/) dispatches this on
  // every control change while editing a preset, and once more with the
  // saved values when leaving that mode (so an unsaved preview reverts). Same
  // window-CustomEvent bridge as the Solo button - the plugin only has the
  // curated window.noctivago IPC surface, no line to this module's engine.
  // Only the currently-loaded preset's edits are applied, so editing preset A
  // while preset B is the live mix changes nothing you can hear.
  window.addEventListener('noctivago:whole-mix-preview', (e) => {
    if (!e.detail || e.detail.presetId !== state.activePresetId) return
    engine.wholeMix.set(e.detail.wholeMix ?? null)
  })
  // Sound Groups (see AudioEngine.js's SoundGroupChain) - same two-event
  // shape as whole-mix-preview above, split for the same reason: a live
  // filter/EQ drag needs no re-fetch (just forwarded straight to the
  // already-installed chain), while a structural change (create/delete/
  // membership, from either this Mixer's own context menu or the Preset
  // Remix plugin) needs a fresh copy of the preset's groups and every live
  // source re-routed to match.
  window.addEventListener('noctivago:sound-group-preview', (e) => {
    if (!e.detail || e.detail.presetId !== state.activePresetId) return
    engine.previewGroup(e.detail.groupId, e.detail.filters)
    const groupId = e.detail.groupId
    const before = groupDriftMemberKey(groupFluctuationForGroup(groupId))
    state.groupFilterPreviews.set(groupId, e.detail.filters ?? null)
    // Only a change to what the group hands its members (a per-sound axis's
    // settings, or the shared pan switch) needs the members reconciled.
    if (before !== groupDriftMemberKey(e.detail.filters?.fluctuation)) {
      for (const entry of state.library) reconcileSource(entry)
    }
  })
  window.addEventListener('noctivago:sound-groups-changed', async (e) => {
    if (!e.detail || e.detail.presetId !== state.activePresetId) return
    const presets = await api.presets.list()
    const preset = presets.find((p) => p.id === state.activePresetId)
    state.groups = preset?.groups ?? []
    state.groupFilterPreviews.clear()
    engine.setSoundGroups(state.groups)
    // "Adding to group adds to mix" (owner request, 2026-09-17: a group's
    // sounds silently weren't in the mix at all, easy to miss since a
    // group's member checklist looks like membership on its own).
    // presets:updateGroups (src/main/presets.js) already adds a newly-joined
    // sound to the preset's own sounds[] and flips its shared `included`
    // flag - adoptActivePresetSounds picks up the sounds[] side. Only the
    // one soundId the dispatching call site says it just joined (not every
    // current group member) is auto-played here - scanning all members
    // instead could resurrect a sound the user deliberately removed from
    // the mix earlier but that's still listed as a group member (group
    // membership is sticky; mix membership isn't), if this event fires
    // again for an unrelated group edit before that removal's own autosave
    // has committed to disk.
    if (preset) adoptActivePresetSounds(preset)
    const joinedId = e.detail.joinedSoundId
    if (preset && joinedId && !state.included.has(joinedId)) {
      const entry = state.library.find((s) => s.id === joinedId)
      if (entry && entry.status !== 'missing') {
        startPlayback(joinedId, entry).catch((err) => console.error('Failed to auto-play newly grouped sound', entry.name, err))
      }
    }
    for (const entry of state.library) reconcileSource(entry)
    for (const [id, source] of state.sources) engine.routeSound(id, source)
    // BUG FIX (self-review, v0.1.149): a group solo's own member snapshot
    // (applyGroupSolo's memberIds) is only ever captured at the moment
    // solo started - deleting the soloed group here (or editing its
    // membership) previously left state.soloedGroupId pointing at a group
    // that either no longer exists (its own sounds stay muted forever, with
    // no UI left to un-stick them since the group itself is gone) or has
    // stale members (added sounds stay muted, removed ones stay silenced).
    // Re-derive it from the freshly-fetched groups every time this fires.
    if (state.soloedGroupId) {
      const stillActive = state.groups.find((g) => g.id === state.soloedGroupId)
      if (stillActive) applyGroupSolo(stillActive.id, stillActive.soundIds)
      else releaseGroupSolo()
    }
    // v0.1.147: each Mixer row now shows a group-membership badge
    // (SoundRow.js's groupName), so a membership change needs to actually
    // re-render the list - previously this listener only ever fed the
    // right-click context menu (computed fresh on each open), so a missing
    // render() here was invisible.
    render()
  })
  // The merged Remix tab's live spectrogram, for Preset/Group mode: unlike
  // every other bridge above (one-way, core reacts to a plugin's edit), this
  // one is a synchronous request/response over the same window-CustomEvent
  // mechanism - the plugin dispatches with a mutable `detail` object and
  // reads `detail.node` right after dispatchEvent() returns, since listeners
  // run synchronously in the same tick. A real AnalyserNode reference (not
  // serialized data) is safe to hand across here because plugin code and
  // this module run in the same JS realm (both are plain renderer-process
  // code loaded into the same window - only the main-process/Node boundary
  // is actually sandboxed, see CLAUDE.md's Plugins section) - polling the
  // node every animation frame this way costs nothing extra per frame, no
  // recurring event traffic. Only ever resolves a node for whichever
  // preset/group is *actually the live one* (state.activePresetId /
  // engine.groupChains), same scoping every other whole-mix/group bridge
  // above already enforces - editing a preset/group that isn't loaded
  // correctly gets `null` back (nothing playing to visualize).
  window.addEventListener('noctivago:request-analyser', (e) => {
    const d = e.detail
    if (!d || d.presetId !== state.activePresetId) return
    if (d.kind === 'whole-mix') d.node = engine.wholeMix.analyser
    else if (d.kind === 'group') d.node = engine.groupChains.get(d.groupId)?.analyser ?? null
  })

  // The merged Remix tab's Preset/Group-mode Play button (v0.1.148) -
  // reported directly ("where's the play button for the preset and group?")
  // since Preset/Group mode previously only ever previewed live if that
  // preset already happened to be playing in the Mixer, with no way to
  // actually start it from Remix itself. Fire-and-forget, same window-
  // CustomEvent bridge as every other plugin/core crossing in this app -
  // loadPreset() is async (awaits engine.resume() + a startPlayback per
  // sound), so this can't be the same synchronous request/response shape
  // request-analyser uses; the plugin instead polls noctivago:request-
  // mixer-status (below) on its own tick loop to learn when the load lands.
  window.addEventListener('noctivago:remix-load-preset', async (e) => {
    const { presetId, soloGroupId } = e.detail ?? {}
    if (!presetId) return
    const presets = await api.presets.list()
    const preset = presets.find((p) => p.id === presetId)
    if (preset) await loadPreset(preset)
    // Optional: the Group-mode Solo button firing this when its preset
    // wasn't loaded yet - loadPreset() is async, so soloing has to wait
    // for it to actually land rather than firing as a separate, immediately
    // -dispatched event that would race ahead of the load and silently
    // no-op against a still-stale state.activePresetId.
    if (soloGroupId && state.activePresetId === presetId) {
      const group = state.groups.find((g) => g.id === soloGroupId)
      if (group) applyGroupSolo(soloGroupId, group.soundIds)
    }
  })
  window.addEventListener('noctivago:remix-toggle-playback', () => {
    toggleGlobalPlayback()
  })
  window.addEventListener('noctivago:remix-solo-group', (e) => {
    const { presetId, groupId } = e.detail ?? {}
    if (!presetId || presetId !== state.activePresetId) return
    const group = state.groups.find((g) => g.id === groupId)
    if (!group) return
    applyGroupSolo(groupId, group.soundIds)
  })
  window.addEventListener('noctivago:remix-unsolo-group', () => releaseGroupSolo())
  // Synchronous request/response, same shape as request-analyser - the
  // Remix tab's Play/Pause icon and Group-mode Solo button need to reflect
  // real Mixer state (is anything playing, is this preset the active one,
  // is a group currently soloed) without holding a direct reference into
  // this module.
  window.addEventListener('noctivago:request-mixer-status', (e) => {
    const d = e.detail
    if (!d) return
    d.activePresetId = state.activePresetId
    d.isPlaying = state.playing.size > 0
    d.soloedGroupId = state.soloedGroupId
  })
}
