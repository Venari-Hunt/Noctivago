import { formatDuration } from '../util/time.js'

// Matches the default new sounds get in tabs/mixer/index.js's state.volumes
// fallback (state.volumes.get(id) ?? 0.7) — a double-click reset should land
// a sound back at its untampered default, not silence (0).
const DEFAULT_VOLUME = 0.7

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

export function createSoundRow(entry, { included, loading, error, volume }, callbacks) {
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
  }

  const removeBtn = document.createElement('button')
  removeBtn.className = 'btn btn-small btn-danger'
  removeBtn.type = 'button'
  removeBtn.textContent = 'Remove'
  removeBtn.addEventListener('click', () => callbacks.onRemove(entry.id))
  li.appendChild(removeBtn)

  return li
}
