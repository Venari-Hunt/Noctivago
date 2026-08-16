export function renderWatchedFolderList(listEl, folders, callbacks) {
  listEl.innerHTML = ''

  if (folders.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'preset-list-empty'
    empty.textContent = 'No watched folders yet.'
    listEl.appendChild(empty)
    return
  }

  for (const folder of folders) {
    const li = document.createElement('li')
    li.className = 'preset-row'

    const info = document.createElement('span')
    info.className = 'preset-row-name'
    info.textContent = folder.status === 'missing' ? `${folder.path} (not found)` : folder.path
    if (folder.status === 'missing') info.classList.add('watched-folder-missing')
    li.appendChild(info)

    const removeBtn = document.createElement('button')
    removeBtn.className = 'btn btn-small btn-danger'
    removeBtn.type = 'button'
    removeBtn.textContent = 'Stop watching'
    removeBtn.addEventListener('click', () => callbacks.onRemove(folder.id))
    li.appendChild(removeBtn)

    listEl.appendChild(li)
  }
}
