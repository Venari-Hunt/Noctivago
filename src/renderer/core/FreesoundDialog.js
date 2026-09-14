// Search/preview/import from Freesound.org (2026-09-14 backlog item). Same
// install-once / open-on-demand shape as AddLinkDialog.js/RecordDialog.js -
// only one entry point (the toolbar "+" menu), so no reshow-behind logic is
// needed.
//
// Preview audition streams through the main process's freesound-preview://
// proxy (src/main/freesound/protocol.js) rather than a raw freesound.org
// URL, so the API token never reaches this sandboxed renderer - the plain
// preview URL Freesound's search response already gives us is all this file
// ever touches. Import hands that same plain URL back over IPC and lets the
// main process re-authorize and download it (library.js's
// addSoundFromFreesound), matching how every other network-touching import
// path (link download, watch folders) already keeps the actual fetch on the
// main-process side of the sandbox boundary.
let els = null
let currentQuery = ''
let currentPage = 1
let currentSort = 'score'
let previewAudio = null
let previewBtn = null

const LICENSE_LABELS = [
  [/publicdomain\/zero/i, 'CC0'],
  [/licenses\/by-nc-sa/i, 'CC BY-NC-SA'],
  [/licenses\/by-nc/i, 'CC BY-NC'],
  [/licenses\/by-sa/i, 'CC BY-SA'],
  [/licenses\/by\b/i, 'CC BY'],
  [/licenses\/sampling\+/i, 'Sampling+']
]

function licenseLabel(url) {
  if (!url) return 'Unknown license'
  const match = LICENSE_LABELS.find(([pattern]) => pattern.test(url))
  return match ? match[1] : 'Freesound license'
}

function formatDuration(seconds) {
  const s = Math.round(seconds ?? 0)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause()
    previewAudio.src = ''
    previewAudio = null
  }
  if (previewBtn) {
    previewBtn.textContent = '▶'
    previewBtn.title = 'Preview'
    previewBtn = null
  }
}

function togglePreview(sound, btn) {
  if (previewBtn === btn) {
    stopPreview()
    return
  }
  stopPreview()
  const audio = new Audio(`freesound-preview://p/${encodeURIComponent(sound.previewUrl)}`)
  audio.addEventListener('ended', stopPreview)
  audio.addEventListener('error', stopPreview)
  audio.play().catch(stopPreview)
  previewAudio = audio
  previewBtn = btn
  btn.textContent = '⏸'
  btn.title = 'Stop preview'
}

async function importResult(sound, row) {
  const importBtn = row.querySelector('.freesound-import-btn')
  const status = row.querySelector('.freesound-result-status')
  importBtn.disabled = true
  status.textContent = 'Importing…'
  try {
    await window.noctivago.library.addSoundFromFreesound({
      freesoundId: sound.id,
      name: sound.name,
      username: sound.username,
      license: sound.license,
      pageUrl: sound.pageUrl,
      previewUrl: sound.previewUrl
    })
    status.textContent = 'Added ✓'
    document.dispatchEvent(new CustomEvent('library:linked'))
  } catch (err) {
    importBtn.disabled = false
    const clean = (err.message || 'Import failed').replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
    status.textContent = `Failed: ${clean.split(/[.(\n]/)[0].trim()}`
  }
}

function renderResult(sound) {
  const row = document.createElement('div')
  row.className = 'freesound-result'

  const previewBtnEl = document.createElement('button')
  previewBtnEl.type = 'button'
  previewBtnEl.className = 'freesound-preview-btn'
  previewBtnEl.title = 'Preview'
  previewBtnEl.textContent = '▶'
  previewBtnEl.addEventListener('click', () => togglePreview(sound, previewBtnEl))

  const info = document.createElement('div')
  info.className = 'freesound-result-info'
  const name = document.createElement('div')
  name.className = 'freesound-result-name'
  name.textContent = sound.name
  name.title = sound.name
  const meta = document.createElement('div')
  meta.className = 'freesound-result-meta'
  meta.textContent = `by ${sound.username} · ${formatDuration(sound.durationSeconds)} · ${licenseLabel(sound.license)}`
  const status = document.createElement('div')
  status.className = 'freesound-result-status'
  info.append(name, meta, status)

  const importBtn = document.createElement('button')
  importBtn.type = 'button'
  importBtn.className = 'freesound-import-btn btn btn-icon-text'
  importBtn.textContent = 'Import'
  importBtn.addEventListener('click', () => importResult(sound, row))

  row.append(previewBtnEl, info, importBtn)
  return row
}

async function runSearch({ append } = {}) {
  els.searchBtn.disabled = true
  els.status.textContent = 'Searching…'
  const result = await window.noctivago.freesound.search({
    query: currentQuery,
    page: currentPage,
    sort: currentSort
  })
  els.searchBtn.disabled = false

  if (!result.ok) {
    els.status.textContent = result.error || 'Search failed.'
    els.loadMore.classList.add('hidden')
    return
  }

  if (!append) els.results.replaceChildren()
  for (const sound of result.results) els.results.appendChild(renderResult(sound))

  if (result.results.length === 0 && !append) {
    els.status.textContent = 'No results.'
  } else {
    els.status.textContent = `${result.count} result${result.count === 1 ? '' : 's'}`
  }
  els.loadMore.classList.toggle('hidden', !result.hasMore)
}

function search() {
  const query = els.query.value.trim()
  if (!query) return
  stopPreview()
  currentQuery = query
  currentPage = 1
  runSearch({ append: false })
}

export function installFreesoundDialog() {
  els = {
    dialog: document.getElementById('freesound-dialog'),
    unavailable: document.getElementById('freesound-unavailable'),
    query: document.getElementById('freesound-query'),
    searchBtn: document.getElementById('freesound-search-btn'),
    status: document.getElementById('freesound-status'),
    results: document.getElementById('freesound-results'),
    loadMore: document.getElementById('freesound-load-more'),
    close: document.getElementById('freesound-close')
  }

  els.searchBtn.addEventListener('click', search)
  els.query.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') search()
  })
  els.loadMore.addEventListener('click', () => {
    currentPage += 1
    runSearch({ append: true })
  })
  els.close.addEventListener('click', () => {
    stopPreview()
    els.dialog.classList.add('hidden')
  })
}

export async function openFreesoundDialog() {
  els.dialog.classList.remove('hidden')
  els.results.replaceChildren()
  els.status.textContent = ''
  els.loadMore.classList.add('hidden')
  currentQuery = ''
  currentPage = 1
  els.query.value = ''

  const available = await window.noctivago.freesound.isAvailable()
  els.unavailable.classList.toggle('hidden', available)
  els.query.disabled = !available
  els.searchBtn.disabled = !available
  if (available) els.query.focus()
}
