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
    li.appendChild(name)

    const loadBtn = document.createElement('button')
    loadBtn.className = 'btn btn-small btn-primary btn-icon-text'
    loadBtn.type = 'button'
    loadBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Load'
    loadBtn.addEventListener('click', () => callbacks.onLoad(preset))
    li.appendChild(loadBtn)

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'btn btn-small btn-danger btn-icon-text'
    deleteBtn.type = 'button'
    deleteBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg> Delete'
    deleteBtn.addEventListener('click', () => callbacks.onDelete(preset.id))
    li.appendChild(deleteBtn)

    listEl.appendChild(li)
  }
}
