import { formatDuration } from '../util/time.js'
import { gainToSlider, sliderToGain, DEFAULT_VOLUME } from '../core/volumeScale.js'

// Speaker (unmuted) / speaker-with-X (muted) - same icon pair as the global
// volume mute button in tabs/mixer/index.js (duplicated rather than shared
// across these two core modules, matching this app's general "small UI
// constants live next to where they're used" convention).
const VOLUME_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>'
const MUTE_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>'
// Plain play triangle - the "test fire" button for a scatter-mode sound
// (plays one shot right now, overriding its gap timer). Reuses the same
// glyph shape the app already uses for Play/Pause elsewhere rather than
// inventing a new "test" icon, since the action fundamentally *is* "play."
const TEST_FIRE_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>'

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatMeta(entry) {
  const parts = []
  if (entry.durationSeconds != null) parts.push(formatDuration(entry.durationSeconds))
  if (entry.fileSizeBytes != null) parts.push(formatSize(entry.fileSizeBytes))
  return parts.join(' · ')
}

// Requested directly: a name truncated by window width should marquee-scroll
// on hover to reveal the full text, "mildly fast, a little faster for really
// long names." .sound-row-name is already white-space:nowrap + overflow:
// hidden + text-overflow:ellipsis (see main.css), so scrollWidth exceeding
// clientWidth is exactly "this name is truncated" - nothing extra to check.
// pxPerSec scales up mildly with how much text needs to scroll (a genuinely
// long name reads a bit brisker, not just proportionally longer), capped so
// it never gets uncomfortably fast.
const MARQUEE_BASE_PX_PER_SEC = 45
const MARQUEE_SPEED_SCALE = 0.06
const MARQUEE_MAX_PX_PER_SEC = 140

function wireMarquee(name) {
  name.addEventListener('mouseenter', () => {
    const overflow = name.scrollWidth - name.clientWidth
    if (overflow <= 0) return
    const pxPerSec = Math.min(MARQUEE_MAX_PX_PER_SEC, MARQUEE_BASE_PX_PER_SEC + overflow * MARQUEE_SPEED_SCALE)
    // Round trip (there and back) plus a little pause budget baked into the
    // keyframes' own held start/end percentages (see main.css) - this is
    // just the moving portion's time budget.
    const duration = (overflow / pxPerSec) * 2 + 0.6
    name.style.setProperty('--marquee-distance', `-${overflow}px`)
    name.style.setProperty('--marquee-duration', `${duration}s`)
    name.classList.add('sound-row-name-marquee')
  })
  name.addEventListener('mouseleave', () => {
    name.classList.remove('sound-row-name-marquee')
  })
}

// Case-insensitive lookup against every tag already used anywhere in the
// library - returns the *existing* tag's own stored casing if there's a
// match, or the typed text unchanged otherwise. Used both by autocomplete
// suggestions and by final-commit normalization, so "rain" always becomes
// "Rain" (matching however it was first capitalized) rather than adding a
// silently-duplicate near-tag.
function normalizeTagCasing(typed, allTags) {
  const match = allTags.find((t) => t.toLowerCase() === typed.toLowerCase())
  return match ?? typed
}

// Tag chips (each removable via its own ×) plus a "+ tag" control that
// turns into a text input on click - comma-separated so several tags can be
// added in one go, mirroring the name field's double-click-to-edit pattern
// elsewhere in this row. allTags (every tag used anywhere in the library,
// deduped) drives Obsidian-style autocomplete: a filtered dropdown of
// existing tags as you type, and casing normalized against an existing
// match on commit - requested directly ("when you start typing a tag name
// it suggests an autocomplete and when you hit enter it formats the tag the
// same way the other tagged items are").
function buildTagsRow(entry, callbacks, allTags) {
  const tagsRow = document.createElement('div')
  tagsRow.className = 'sound-row-tags'

  for (const tag of entry.tags ?? []) {
    const chip = document.createElement('span')
    chip.className = 'tag-chip'
    chip.textContent = tag

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'tag-chip-remove'
    remove.textContent = '×'
    remove.title = `Remove tag "${tag}"`
    remove.addEventListener('click', (evt) => {
      evt.stopPropagation()
      callbacks.onTagsChange(entry.id, (entry.tags ?? []).filter((t) => t !== tag))
    })
    chip.appendChild(remove)
    tagsRow.appendChild(chip)
  }

  const addTagBtn = document.createElement('button')
  addTagBtn.type = 'button'
  addTagBtn.className = 'tag-chip tag-chip-add'
  addTagBtn.textContent = '+ tag'
  addTagBtn.addEventListener('click', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'tag-input-wrapper'

    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tag-input'
    input.placeholder = 'tag, tag…'

    const options = document.createElement('ul')
    options.className = 'tag-autocomplete-options hidden'

    wrapper.appendChild(input)
    wrapper.appendChild(options)
    addTagBtn.replaceWith(wrapper)
    input.focus()

    let settled = false
    let highlightIndex = -1

    // Autocomplete only ever operates on the *current* (last) comma-segment
    // being typed - earlier, already-comma-separated segments are left
    // alone, matching how the plain comma-separated entry already worked.
    function currentSegment() {
      const parts = input.value.split(',')
      return parts[parts.length - 1].trim()
    }

    function matchingTags() {
      const query = currentSegment().toLowerCase()
      if (!query) return []
      return allTags.filter((t) => t.toLowerCase().includes(query) && !(entry.tags ?? []).includes(t))
    }

    function renderOptions() {
      const matches = matchingTags()
      options.innerHTML = ''
      options.classList.toggle('hidden', matches.length === 0)
      highlightIndex = Math.min(highlightIndex, matches.length - 1)
      matches.forEach((tag, i) => {
        const li = document.createElement('li')
        li.className = 'tag-autocomplete-option' + (i === highlightIndex ? ' tag-autocomplete-option-highlighted' : '')
        li.textContent = tag
        // mousedown (not click) fires before the input's own blur, so
        // selecting a suggestion doesn't first trigger a blur-commit on
        // whatever's currently typed - same trick the Remix sound picker's
        // dropdown already uses for its own options.
        li.addEventListener('mousedown', (evt) => {
          evt.preventDefault()
          applySuggestion(tag)
        })
        options.appendChild(li)
      })
    }

    // Replaces just the current (last) segment with the picked suggestion's
    // own exact casing, leaving any already-typed earlier segments (and
    // their trailing ", ") intact - then arms the input for typing another
    // tag right after, matching how comma-separated multi-tag entry already
    // works elsewhere in this control.
    function applySuggestion(tag) {
      const parts = input.value.split(',')
      parts[parts.length - 1] = ` ${tag}`
      input.value = parts.map((p, i) => (i === 0 ? p.trim() : p)).join(',') + ', '
      highlightIndex = -1
      renderOptions()
      input.focus()
    }

    const commit = () => {
      if (settled) return
      settled = true
      const newTags = input.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => normalizeTagCasing(t, allTags))
      if (newTags.length > 0) {
        const merged = [...new Set([...(entry.tags ?? []), ...newTags])]
        callbacks.onTagsChange(entry.id, merged)
      } else {
        wrapper.replaceWith(addTagBtn)
      }
    }
    const cancel = () => {
      if (settled) return
      settled = true
      wrapper.replaceWith(addTagBtn)
    }
    input.addEventListener('blur', commit)
    input.addEventListener('input', () => {
      highlightIndex = -1
      renderOptions()
    })
    input.addEventListener('keydown', (evt) => {
      const matches = matchingTags()
      if (evt.key === 'ArrowDown' && matches.length > 0) {
        evt.preventDefault()
        highlightIndex = (highlightIndex + 1) % matches.length
        renderOptions()
      } else if (evt.key === 'ArrowUp' && matches.length > 0) {
        evt.preventDefault()
        highlightIndex = (highlightIndex - 1 + matches.length) % matches.length
        renderOptions()
      } else if (evt.key === 'Enter') {
        // A highlighted suggestion completes just that segment (so a comma
        // can start the next tag) rather than committing the whole field -
        // only commits outright when nothing's highlighted.
        if (highlightIndex >= 0 && matches[highlightIndex]) {
          evt.preventDefault()
          applySuggestion(matches[highlightIndex])
        } else {
          input.blur()
        }
      } else if (evt.key === 'Escape') {
        cancel()
      }
    })
  })
  tagsRow.appendChild(addTagBtn)

  return tagsRow
}

// A stable (not re-randomized every render), distinct-per-group badge color -
// hashes the group's own id (not its display name, so a rename doesn't shift
// the color) into a slot of a fixed palette, then applies it at the same
// saturation/lightness/alpha the old single hardcoded purple used, so every
// group's badge still reads as "the same kind of thing" at a glance, just
// individually colored. Requested directly: "each group should have a random
// different color" (owner's own suggestion), plus "the tag should be closer
// to the name" - see the .sound-row-name flex fix in main.css for that
// second half.
// FNV-1a, not a plain polynomial rolling hash - verified live that the
// naive version correlated badly on realistic inputs (two group ids
// differing by one trailing character landed only ~2deg apart in hue,
// which read as "the same color" at a glance - not caught by review, only
// by actually creating two groups and comparing the rendered badges).
// FNV-1a's avalanche keeps similar ids from mapping to similar hues.
//
// v0.1.241: hashing straight to `% 360` was still wrong in practice, and the
// owner reported the feature simply never working on their machine. A good
// hash spreads hues *uniformly at random*, which does nothing to stop two
// groups of the same preset landing a few degrees apart - their own "Rain
// Inside" preset drew hues 105/89/102 for its three groups, three greens
// nobody could tell apart, while the same build on another PC (different
// random group ids) looked correctly varied. Fixed by hashing into a slot of
// a fixed, widely-spaced palette and then walking collisions to the next free
// slot within the preset (assignGroupColorSlots), so two groups the user can
// see at once are never given the same or an adjacent color.
// Eight hues 45deg apart - the widest spacing that still gives every preset
// a fresh color for its first eight groups. A 12-entry palette was tried
// first and rejected by measuring it against the owner's own presets: it
// forced 30deg spacing at best, and their three-group preset still drew two
// greens 20deg apart, which is the very complaint being fixed. Past eight
// groups the hues repeat at a darker lightness (GROUP_BADGE_TIERS) rather
// than repeating outright.
const GROUP_BADGE_HUES = [265, 310, 355, 40, 85, 130, 175, 220]
const GROUP_BADGE_TIERS = [68, 52]
const GROUP_BADGE_SLOTS = GROUP_BADGE_HUES.length * GROUP_BADGE_TIERS.length

function hashHue(id) {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Slot per group id. The hash only ever picks a hue; a taken hue walks to the
// next free one, and the darker tier is opened only once all eight hues are
// spoken for. Letting the hash pick a tier directly was tried and measured
// wrong on the owner's own data - two groups of "Rain Inside" drew the same
// pink at two lightnesses, which is barely better than the bug being fixed.
// Order-dependent only when two groups actually collide (the loser takes the
// next free hue), so an untouched preset keeps the same colors run to run.
export function assignGroupColorSlots(groups) {
  const slots = new Map()
  const taken = new Set()
  let tier = 0
  for (const group of groups ?? []) {
    if (!group?.id) continue
    if (taken.size === GROUP_BADGE_HUES.length) {
      taken.clear()
      tier = (tier + 1) % GROUP_BADGE_TIERS.length
    }
    let hue = hashHue(group.id) % GROUP_BADGE_HUES.length
    while (taken.has(hue)) hue = (hue + 1) % GROUP_BADGE_HUES.length
    taken.add(hue)
    slots.set(group.id, tier * GROUP_BADGE_HUES.length + hue)
  }
  return slots
}

function groupBadgeColors(groupId, colorSlot) {
  const slot = Number.isInteger(colorSlot) ? colorSlot : hashHue(groupId) % GROUP_BADGE_SLOTS
  const hue = GROUP_BADGE_HUES[slot % GROUP_BADGE_HUES.length]
  const light = GROUP_BADGE_TIERS[Math.floor(slot / GROUP_BADGE_HUES.length) % GROUP_BADGE_TIERS.length]
  return {
    background: `hsla(${hue}, 70%, ${light}%, 0.22)`,
    borderColor: `hsla(${hue}, 70%, ${light}%, 0.55)`,
    color: `hsl(${hue}, 85%, ${light + 8}%)`
  }
}

export function createSoundRow(entry, { included, loading, error, volume, muted, soloed, groupName = null, groupId = null, groupColorSlot = null, selectMode = false, selected = false }, callbacks, allTags = []) {
  const li = document.createElement('li')
  li.className = 'sound-row' + (entry.status === 'missing' ? ' sound-row-missing' : '')
  li.dataset.id = entry.id

  // Bulk-select checkbox (Board backlog: bulk-apply an effect preset to
  // several sounds at once) - only exists in the DOM at all while select
  // mode is on, so it costs nothing on every other render and can't be
  // accidentally clicked in the normal one-sound-at-a-time flow.
  if (selectMode) {
    li.classList.add('sound-row-selectable')
    if (selected) li.classList.add('sound-row-selected')
    const selectLabel = document.createElement('label')
    selectLabel.className = 'sound-row-select'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = selected
    checkbox.addEventListener('change', () => callbacks.onToggleSelect(entry.id))
    selectLabel.appendChild(checkbox)
    li.appendChild(selectLabel)
  }

  // Right-click menu - currently just Sound Groups ("Add to group…", see
  // AudioEngine.js's SoundGroupChain), left generic (evt handed through
  // whole) so a future menu item doesn't need a second wiring point here.
  if (callbacks.onContextMenu) {
    li.addEventListener('contextmenu', (evt) => {
      evt.preventDefault()
      callbacks.onContextMenu(entry.id, evt)
    })
  }

  // The name gets its own full-width top section so it doesn't compete with
  // the button row for space - requested directly ("the name should
  // populate a top section of the box so it can always or most of the time
  // display it's complete name"). Everything else (meta/tags/buttons) moves
  // to a second row below; the name's existing hover-marquee already covers
  // "still cut off" (a name too long even for the full row width, e.g. at a
  // very narrow window) without any new code.
  const nameRow = document.createElement('div')
  nameRow.className = 'sound-row-name-row'

  const info = document.createElement('div')
  info.className = 'sound-row-info'

  const name = document.createElement('span')
  name.className = 'sound-row-name'
  name.textContent = entry.name
  name.title = 'Double-click to rename'
  name.addEventListener('dblclick', () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'sound-row-name-input'
    input.value = entry.name
    name.replaceWith(input)
    input.focus()
    input.select()

    let settled = false
    const commit = () => {
      if (settled) return
      settled = true
      const value = input.value.trim()
      if (value && value !== entry.name) callbacks.onRename(entry.id, value)
      else input.replaceWith(name)
    }
    const cancel = () => {
      if (settled) return
      settled = true
      input.replaceWith(name)
    }

    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') input.blur()
      else if (evt.key === 'Escape') cancel()
    })
  })
  wireMarquee(name)
  nameRow.appendChild(name)

  // Purely a display marker - a composite-derived sound (see the Composite
  // plugin) is otherwise a completely normal entry with no different
  // playback behavior, but it's baked from multiple other sounds and can be
  // re-opened in the Composite tab to change its recipe, so it's worth
  // flagging at a glance rather than looking identical to a plain import.
  if (entry.compositeSource) {
    const badge = document.createElement('span')
    badge.className = 'sound-row-composite-badge'
    badge.textContent = 'Composite'
    badge.title = `Baked from ${entry.compositeSource.members.length} sounds - open the Composite tab to edit`
    nameRow.appendChild(badge)
  }

  // Freesound import (see library.js's addSoundFromFreesound) - a plain
  // display marker, same reasoning as the Composite badge above, but also
  // the one place a CC-BY (or similar) sound's required attribution is kept
  // visible rather than silently dropped once it's in the library.
  if (entry.source?.type === 'freesound') {
    const badge = document.createElement('span')
    badge.className = 'sound-row-composite-badge'
    badge.textContent = 'Freesound'
    badge.title = `From Freesound.org, by ${entry.source.username || 'unknown'}${entry.source.license ? ` (${entry.source.license})` : ''}`
    nameRow.appendChild(badge)
  }

  // Sound Groups (see AudioEngine.js's SoundGroupChain) - membership used to
  // be invisible unless you right-clicked the sound and checked the menu for
  // a checkmark (reported directly as "actual garbage" UX). This badge makes
  // it visible at a glance; clicking it opens the same right-click menu so
  // changing groups doesn't require finding the exact spot to right-click.
  if (groupName && callbacks.onContextMenu) {
    const groupBadge = document.createElement('button')
    groupBadge.type = 'button'
    groupBadge.className = 'sound-row-group-badge'
    groupBadge.textContent = groupName
    groupBadge.title = `In the "${groupName}" sound group - click to change`
    if (groupId) {
      Object.assign(groupBadge.style, groupBadgeColors(groupId, groupColorSlot))
      // Lit red by ui/levelMeters.js when the group's own bus clips.
      groupBadge.dataset.meterGroup = groupId
    }
    groupBadge.addEventListener('click', (evt) => {
      evt.stopPropagation()
      callbacks.onContextMenu(entry.id, evt)
    })
    nameRow.appendChild(groupBadge)
  }

  li.appendChild(nameRow)

  // Everything below the name - meta/tags plus every button and slider -
  // shares this second row, so the name above never has to shrink to make
  // room for them.
  const controlsRow = document.createElement('div')
  controlsRow.className = 'sound-row-controls'

  const meta = document.createElement('span')
  meta.className = 'sound-row-meta'
  meta.textContent = formatMeta(entry)
  info.appendChild(meta)

  if (error) {
    const errorLabel = document.createElement('span')
    errorLabel.className = 'sound-row-error'
    errorLabel.textContent = error
    info.appendChild(errorLabel)
  }

  info.appendChild(buildTagsRow(entry, callbacks, allTags))

  controlsRow.appendChild(info)

  if (entry.status === 'missing') {
    const missingLabel = document.createElement('span')
    missingLabel.className = 'sound-row-missing-label'
    missingLabel.textContent = 'Missing'
    controlsRow.appendChild(missingLabel)

    const relinkBtn = document.createElement('button')
    relinkBtn.className = 'btn btn-small btn-icon-text'
    relinkBtn.type = 'button'
    relinkBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Relink'
    relinkBtn.addEventListener('click', () => callbacks.onRelink(entry.id))
    controlsRow.appendChild(relinkBtn)
  } else {
    const includeBtn = document.createElement('button')
    includeBtn.className = 'btn btn-small' + (included ? ' btn-active' : '')
    includeBtn.type = 'button'
    includeBtn.disabled = loading
    includeBtn.textContent = loading ? 'Loading…' : included ? 'In Mix' : 'Add'
    includeBtn.addEventListener('click', () => callbacks.onToggleIncluded(entry.id))
    controlsRow.appendChild(includeBtn)

    const volumeSlider = document.createElement('input')
    volumeSlider.type = 'range'
    volumeSlider.min = '0'
    volumeSlider.max = '100'
    // The slider is bipolar: its centre (50) is unity gain, left attenuates,
    // right boosts (see core/volumeScale.js). defaultValue (the fixed reset
    // target for the app-wide double-click-resets-a-slider behavior, see
    // main.js) is set separately from value (this render's live volume) since
    // this element is rebuilt from scratch on every render — value alone
    // wouldn't preserve "what the untampered default is" across re-renders.
    volumeSlider.defaultValue = String(gainToSlider(DEFAULT_VOLUME))
    volumeSlider.value = String(gainToSlider(volume))
    volumeSlider.className = 'sound-row-volume'
    volumeSlider.addEventListener('input', () => {
      callbacks.onVolumeChange(entry.id, sliderToGain(volumeSlider.value))
    })
    // Wrapper carries the centre-tick marker (::after), so "neutral" is
    // eyeball-able on the wider bar.
    const volumeWrap = document.createElement('span')
    volumeWrap.className = 'volume-slider-wrap'
    volumeWrap.appendChild(volumeSlider)
    controlsRow.appendChild(volumeWrap)

    // Live level + clip light, driven by ui/levelMeters.js.
    const meter = document.createElement('span')
    meter.className = 'level-meter'
    meter.dataset.meterSound = entry.id
    meter.innerHTML = '<span class="level-meter-fill"></span>'
    controlsRow.appendChild(meter)

    const muteBtn = document.createElement('button')
    muteBtn.className = 'btn btn-svg-icon' + (muted ? ' btn-svg-icon-active' : '')
    muteBtn.type = 'button'
    muteBtn.title = muted ? 'Unmute' : 'Mute'
    muteBtn.innerHTML = muted ? MUTE_ICON_SVG : VOLUME_ICON_SVG
    muteBtn.addEventListener('click', () => callbacks.onToggleMute(entry.id))
    controlsRow.appendChild(muteBtn)

    // Single-target solo (like a DAW's own Solo button) - mutes every other
    // currently-playing sound so this one can be heard on its own, requested
    // directly ("a solo button for the mixer tab. So you can single one
    // audio out vs the multiple that are playing"). Plain "S" badge rather
    // than an SVG glyph - there's no single universal solo icon the way
    // mute/speaker already has one, and DAWs (Ableton, FL Studio, Reaper)
    // converge on the same letter convention themselves. Accent-colored
    // when active (.btn-svg-icon-solo-active), deliberately not the same
    // red .btn-svg-icon-active uses for mute - soloed means "audible, on
    // purpose," the opposite of what red/danger would suggest here.
    const soloBtn = document.createElement('button')
    soloBtn.className = 'btn btn-svg-icon sound-row-solo' + (soloed ? ' btn-svg-icon-solo-active' : '')
    soloBtn.type = 'button'
    soloBtn.title = soloed ? 'Unsolo' : 'Solo (mute every other sound)'
    soloBtn.textContent = 'S'
    soloBtn.addEventListener('click', () => callbacks.onToggleSolo(entry.id))
    controlsRow.appendChild(soloBtn)

    // Test-fire, scatter and scheduled sounds - requested directly for
    // scatter ("an override play button on the mixer tab for audios that
    // are played at random intervals... play the audio once when pressed
    // so you can test the configuration you set up without having to
    // remove and re-add"), extended to scheduled sounds too (same one-shot-
    // then-wait shape, same benefit from "let me hear it now" instead of
    // waiting for a real clock trigger). Works whether or not the sound is
    // currently included (see tabs/mixer/index.js's testFireOneShot for the
    // two cases), so it's shown regardless of `included` - the whole point
    // is not needing to add it first just to hear it.
    if (entry.playMode === 'scatter' || entry.playMode === 'scheduled') {
      const testFireBtn = document.createElement('button')
      testFireBtn.className = 'btn btn-svg-icon'
      testFireBtn.type = 'button'
      testFireBtn.title = 'Play one shot now (test this configuration)'
      testFireBtn.innerHTML = TEST_FIRE_ICON_SVG
      testFireBtn.addEventListener('click', () => callbacks.onTestFire(entry.id))
      controlsRow.appendChild(testFireBtn)
    }
  }

  const removeBtn = document.createElement('button')
  removeBtn.className = 'btn btn-small btn-danger btn-icon-text'
  removeBtn.type = 'button'
  removeBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg> Remove'
  removeBtn.addEventListener('click', () => callbacks.onRemove(entry.id))
  controlsRow.appendChild(removeBtn)

  li.appendChild(controlsRow)

  return li
}
