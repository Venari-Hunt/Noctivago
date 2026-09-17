export function renderPresetList(listEl, presets, callbacks) {
  listEl.innerHTML = ''

  if (presets.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'preset-list-empty'
    empty.textContent = 'No presets saved yet.'
    listEl.appendChild(empty)
    return
  }

  for (const preset of presets) {
    const li = document.createElement('li')
    li.className = 'preset-row'

    const name = document.createElement('span')
    name.className = 'preset-row-name'
    name.textContent = preset.name
    name.title = preset.name
    li.appendChild(name)

    const actions = document.createElement('div')
    actions.className = 'preset-row-actions'
    li.appendChild(actions)

    const loadBtn = document.createElement('button')
    loadBtn.className = 'btn btn-small btn-primary btn-icon-text'
    loadBtn.type = 'button'
    loadBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Load'
    loadBtn.addEventListener('click', () => callbacks.onLoad(preset))
    actions.appendChild(loadBtn)

    if (callbacks.onExport) {
      const exportBtn = document.createElement('button')
      exportBtn.className = 'btn btn-small btn-icon-text'
      exportBtn.type = 'button'
      exportBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Export'
      exportBtn.addEventListener('click', () => callbacks.onExport(preset))
      actions.appendChild(exportBtn)
    }

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'btn btn-small btn-danger btn-icon-text'
    deleteBtn.type = 'button'
    deleteBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg> Delete'
    deleteBtn.addEventListener('click', () => callbacks.onDelete(preset.id))
    actions.appendChild(deleteBtn)

    listEl.appendChild(li)
  }
}

// Renders the per-sound status list inside the "Import preset" dialog. Each
// sound is already in the library, included in the preset file itself,
// re-downloaded from Freesound, or still needs its audio located (a
// "Locate…" button). `sounds` is the analyzed array from
// presets:pickImport, mutated in place as sounds resolve.
export function renderPresetImportList(listEl, sounds, callbacks) {
  listEl.innerHTML = ''

  for (const [index, sound] of sounds.entries()) {
    const li = document.createElement('li')
    li.className = 'preset-import-row'

    const info = document.createElement('div')
    info.className = 'preset-import-info'

    const name = document.createElement('span')
    name.className = 'preset-import-sound-name'
    name.textContent = sound.name
    info.appendChild(name)

    const resolved = Boolean(sound.matchedSoundId) || sound.fromBundle || sound.fromFreesound
    const status = document.createElement('span')
    status.className = resolved
      ? 'preset-import-sound-status resolved'
      : 'preset-import-sound-status missing'
    status.textContent = sound.matchedSoundId
      ? 'In your library'
      : sound.fromBundle
        ? 'Included in this file'
        : sound.fromFreesound
          ? 'Downloads from Freesound'
          : `Needs file — ${sound.fileName || 'unknown file'}`
    info.appendChild(status)

    li.appendChild(info)

    if (!resolved) {
      const locateBtn = document.createElement('button')
      locateBtn.className = 'btn btn-small'
      locateBtn.type = 'button'
      locateBtn.textContent = 'Locate…'
      locateBtn.addEventListener('click', () => callbacks.onLocate(index))
      li.appendChild(locateBtn)
    }

    listEl.appendChild(li)
  }
}
