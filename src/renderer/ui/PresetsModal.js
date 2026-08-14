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
    loadBtn.className = 'btn btn-small btn-primary'
    loadBtn.type = 'button'
    loadBtn.textContent = 'Load'
    loadBtn.addEventListener('click', () => callbacks.onLoad(preset))
    li.appendChild(loadBtn)

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'btn btn-small btn-danger'
    deleteBtn.type = 'button'
    deleteBtn.textContent = 'Delete'
    deleteBtn.addEventListener('click', () => callbacks.onDelete(preset.id))
    li.appendChild(deleteBtn)

    listEl.appendChild(li)
  }
}
