import { formatDuration } from '../util/time.js'

// Matches the default new sounds get in tabs/mixer/index.js's state.volumes
// fallback (state.volumes.get(id) ?? 0.7) — a double-click reset should land
// a sound back at its untampered default, not silence (0).
const DEFAULT_VOLUME = 0.7

// Speaker (unmuted) / speaker-with-X (muted) - same icon pair as the global
// volume mute button in tabs/mixer/index.js (duplicated rather than shared
// across these two core modules, matching this app's general "small UI
// constants live next to where they're used" convention).
const VOLUME_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><path d="M16 8a5 5 0 0 1 0 8"/></svg>'
const MUTE_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/></svg>'

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

// Tag chips (each removable via its own ×) plus a "+ tag" control that
// turns into a text input on click - comma-separated so several tags can be
// added in one go, mirroring the name field's double-click-to-edit pattern
// elsewhere in this row.
function buildTagsRow(entry, callbacks) {
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
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'tag-input'
    input.placeholder = 'tag, tag…'
    addTagBtn.replaceWith(input)
    input.focus()

    let settled = false
    const commit = () => {
      if (settled) return
      settled = true
      const newTags = input.value.split(',').map((t) => t.trim()).filter(Boolean)
      if (newTags.length > 0) {
        const merged = [...new Set([...(entry.tags ?? []), ...newTags])]
        callbacks.onTagsChange(entry.id, merged)
      } else {
        input.replaceWith(addTagBtn)
      }
    }
    const cancel = () => {
      if (settled) return
      settled = true
      input.replaceWith(addTagBtn)
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') input.blur()
      else if (evt.key === 'Escape') cancel()
    })
  })
  tagsRow.appendChild(addTagBtn)

  return tagsRow
}

export function createSoundRow(entry, { included, loading, error, volume, muted }, callbacks) {
  const li = document.createElement('li')
  li.className = 'sound-row' + (entry.status === 'missing' ? ' sound-row-missing' : '')
  li.dataset.id = entry.id

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
  info.appendChild(name)

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

  info.appendChild(buildTagsRow(entry, callbacks))

  li.appendChild(info)

  if (entry.status === 'missing') {
    const missingLabel = document.createElement('span')
    missingLabel.className = 'sound-row-missing-label'
    missingLabel.textContent = 'Missing'
    li.appendChild(missingLabel)

    const relinkBtn = document.createElement('button')
    relinkBtn.className = 'btn btn-small'
    relinkBtn.type = 'button'
    relinkBtn.textContent = 'Relink'
    relinkBtn.addEventListener('click', () => callbacks.onRelink(entry.id))
    li.appendChild(relinkBtn)
  } else {
    const includeBtn = document.createElement('button')
    includeBtn.className = 'btn btn-small' + (included ? ' btn-active' : '')
    includeBtn.type = 'button'
    includeBtn.disabled = loading
    includeBtn.textContent = loading ? 'Loading…' : included ? 'In Mix' : 'Add'
    includeBtn.addEventListener('click', () => callbacks.onToggleIncluded(entry.id))
    li.appendChild(includeBtn)

    const volumeSlider = document.createElement('input')
    volumeSlider.type = 'range'
    volumeSlider.min = '0'
    volumeSlider.max = '100'
    // defaultValue (the fixed reset target for the app-wide double-click-
    // resets-a-slider behavior, see main.js) is set separately from value
    // (this render's live volume) since this element is rebuilt from
    // scratch on every render — value alone wouldn't preserve "what the
    // untampered default is" across re-renders.
    volumeSlider.defaultValue = String(DEFAULT_VOLUME * 100)
    volumeSlider.value = String(Math.round(volume * 100))
    volumeSlider.className = 'sound-row-volume'
    volumeSlider.addEventListener('input', () => {
      callbacks.onVolumeChange(entry.id, Number(volumeSlider.value) / 100)
    })
    li.appendChild(volumeSlider)

    const muteBtn = document.createElement('button')
    muteBtn.className = 'btn btn-svg-icon' + (muted ? ' btn-svg-icon-active' : '')
    muteBtn.type = 'button'
    muteBtn.title = muted ? 'Unmute' : 'Mute'
    muteBtn.innerHTML = muted ? MUTE_ICON_SVG : VOLUME_ICON_SVG
    muteBtn.addEventListener('click', () => callbacks.onToggleMute(entry.id))
    li.appendChild(muteBtn)
  }

  const removeBtn = document.createElement('button')
  removeBtn.className = 'btn btn-small btn-danger'
  removeBtn.type = 'button'
  removeBtn.textContent = 'Remove'
  removeBtn.addEventListener('click', () => callbacks.onRemove(entry.id))
  li.appendChild(removeBtn)

  return li
}
