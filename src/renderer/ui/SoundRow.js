import { formatDuration } from '../util/time.js'

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

export function createSoundRow(entry, { included, loading, error, volume }, callbacks) {
  const li = document.createElement('li')
  li.className = 'sound-row' + (entry.status === 'missing' ? ' sound-row-missing' : '')
  li.dataset.id = entry.id

  const info = document.createElement('div')
  info.className = 'sound-row-info'

  const name = document.createElement('span')
  name.className = 'sound-row-name'
  name.textContent = entry.name
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
    volumeSlider.value = String(Math.round(volume * 100))
    volumeSlider.className = 'sound-row-volume'
    volumeSlider.addEventListener('input', () => {
      callbacks.onVolumeChange(entry.id, Number(volumeSlider.value) / 100)
    })
    li.appendChild(volumeSlider)

    const trimBtn = document.createElement('button')
    trimBtn.className = 'btn btn-small'
    trimBtn.type = 'button'
    trimBtn.textContent = 'Trim'
    trimBtn.addEventListener('click', () => callbacks.onOpenLoopEditor(entry.id))
    li.appendChild(trimBtn)
  }

  const removeBtn = document.createElement('button')
  removeBtn.className = 'btn btn-small btn-danger'
  removeBtn.type = 'button'
  removeBtn.textContent = 'Remove'
  removeBtn.addEventListener('click', () => callbacks.onRemove(entry.id))
  li.appendChild(removeBtn)

  return li
}
