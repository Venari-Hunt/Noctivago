// Community - browse, import and share presets made by other users.
//
// The server is a Cloudflare Worker (community/ at the repo root); the main
// process talks to it (src/main/community/client.js) and this tab only goes
// through window.noctivago.community. Importing reuses the Mixer's own
// "Import preset" dialog: the downloaded bundle is analyzed in the main
// process exactly like a local .ncvpreset, then handed to the Mixer with a
// synchronous `noctivago:open-preset-import` event.
//
// Everything that comes from the server is rendered with textContent, never
// innerHTML - preset names, descriptions and tags are user-written.

const PAGE_SIZE = 24
const MAX_TAGS_SHOWN = 6
const REPORT_REASONS = [
  ['copyright', 'Copyrighted audio'],
  ['offensive', 'Offensive content'],
  ['broken', "Doesn't work / broken"],
  ['spam', 'Spam']
]

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function parseTags(text) {
  return String(text ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8)
}

export default class CommunityPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.els = {}
    this.view = 'browse'
    this.page = 0
    this.hasMore = false
    this.loading = false
    this.requestId = 0
    this.pendingImportCard = null
    this.publishing = false
    this.localPresets = []
  }

  async onload() {
    // No server configured in this build (COMMUNITY_API_URL unset) - skip the
    // tab entirely rather than showing one that can't do anything.
    try {
      if (!(await this.api.community.getProfile()).available) return
    } catch {
      return
    }
    this.onImportFinished = (event) => this.handleImportFinished(event.detail?.result)
    window.addEventListener('noctivago:preset-import-finished', this.onImportFinished)
    this.unregister = this.app.tabs.register({
      id: 'community',
      title: 'Community',
      mount: (container) => this.mount(container)
    })
  }

  async onunload() {
    window.removeEventListener('noctivago:preset-import-finished', this.onImportFinished)
    this.observer?.disconnect()
    this.unregister?.()
  }

  mount(container) {
    container.innerHTML = `
      <div class="community-tab">
        <p class="community-hint">Ambiences made by other Noctívago users. Importing adds the preset and its sounds to your library. Sounds from Freesound are downloaded from Freesound; the rest come with the preset.</p>
        <div class="community-view-switch" role="tablist">
          <button type="button" class="community-pill active" data-view="browse">Browse</button>
          <button type="button" class="community-pill" data-view="mine">My uploads</button>
          <button type="button" class="community-pill" data-view="share">Share a preset</button>
        </div>
        <p id="community-unavailable" class="modal-hint hidden"></p>

        <section id="community-browse" class="community-view">
          <div class="community-search-row">
            <input id="community-query" type="text" placeholder="rain, cabin, forest night…" autocomplete="off" />
            <select id="community-sort">
              <option value="new">Newest</option>
              <option value="popular">Most downloaded</option>
            </select>
            <button id="community-search-btn" class="btn btn-primary" type="button">Search</button>
          </div>
          <p id="community-status" class="community-status"></p>
          <div id="community-results" class="community-results"></div>
          <div id="community-sentinel" class="community-sentinel hidden"></div>
        </section>

        <section id="community-mine" class="community-view hidden">
          <p id="community-mine-status" class="community-status"></p>
          <div id="community-mine-results" class="community-results"></div>
        </section>

        <section id="community-share" class="community-view hidden">
          <form id="community-share-form" class="community-share-form">
            <p id="community-share-mode" class="community-share-mode hidden"></p>
            <label class="field-label">Preset to share
              <select id="community-share-preset"></select>
            </label>
            <label class="field-label">Name
              <input id="community-share-name" type="text" maxlength="80" />
            </label>
            <label class="field-label">Your name (shown on the preset)
              <input id="community-share-author" type="text" maxlength="40" />
            </label>
            <label class="field-label">Description
              <textarea id="community-share-description" rows="3" maxlength="600" placeholder="What does it sound like? Where does it take you?"></textarea>
            </label>
            <label class="field-label">Tags (comma-separated)
              <input id="community-share-tags" type="text" placeholder="rain, night, cozy" />
            </label>
            <label class="community-rights">
              <input id="community-share-rights" type="checkbox" />
              I made these sounds or have the right to share them. Sounds imported from Freesound are linked, not re-uploaded.
            </label>
            <div class="community-share-actions">
              <button id="community-share-cancel" class="btn hidden" type="button">Cancel update</button>
              <button id="community-share-submit" class="btn btn-primary" type="submit">Share</button>
            </div>
            <p id="community-share-status" class="community-status"></p>
          </form>
        </section>
      </div>
    `

    const q = (sel) => container.querySelector(sel)
    this.els = {
      pills: [...container.querySelectorAll('.community-pill')],
      unavailable: q('#community-unavailable'),
      views: { browse: q('#community-browse'), mine: q('#community-mine'), share: q('#community-share') },
      query: q('#community-query'),
      sort: q('#community-sort'),
      searchBtn: q('#community-search-btn'),
      status: q('#community-status'),
      results: q('#community-results'),
      sentinel: q('#community-sentinel'),
      mineStatus: q('#community-mine-status'),
      mineResults: q('#community-mine-results'),
      shareForm: q('#community-share-form'),
      shareMode: q('#community-share-mode'),
      sharePreset: q('#community-share-preset'),
      shareName: q('#community-share-name'),
      shareAuthor: q('#community-share-author'),
      shareDescription: q('#community-share-description'),
      shareTags: q('#community-share-tags'),
      shareRights: q('#community-share-rights'),
      shareCancel: q('#community-share-cancel'),
      shareSubmit: q('#community-share-submit'),
      shareStatus: q('#community-share-status')
    }

    for (const pill of this.els.pills) {
      pill.addEventListener('click', () => this.showView(pill.dataset.view))
    }
    this.els.searchBtn.addEventListener('click', () => this.search())
    this.els.query.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') this.search()
    })
    this.els.sort.addEventListener('change', () => this.search())
    this.els.sharePreset.addEventListener('change', () => {
      const preset = this.localPresets.find((p) => p.id === this.els.sharePreset.value)
      if (preset && !this.shareTarget) this.els.shareName.value = preset.name
    })
    this.els.shareForm.addEventListener('submit', (evt) => {
      evt.preventDefault()
      this.publish()
    })
    this.els.shareCancel.addEventListener('click', () => this.setShareTarget(null))

    this.observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) this.loadMore()
    })
    this.observer.observe(this.els.sentinel)

    this.init()
  }

  async init() {
    let profile
    try {
      profile = await this.api.community.getProfile()
    } catch {
      profile = { available: false }
    }
    this.available = Boolean(profile.available)
    this.els.shareAuthor.value = profile.authorName || ''
    if (!this.available) {
      this.els.unavailable.textContent = 'Community presets are not available in this build.'
      this.els.unavailable.classList.remove('hidden')
      for (const btn of [this.els.searchBtn, this.els.shareSubmit]) btn.disabled = true
      return
    }
    this.search()
  }

  showView(view) {
    this.view = view
    for (const pill of this.els.pills) pill.classList.toggle('active', pill.dataset.view === view)
    for (const [key, section] of Object.entries(this.els.views)) section.classList.toggle('hidden', key !== view)
    if (!this.available) return
    if (view === 'mine') this.loadMine()
    if (view === 'share') this.refreshLocalPresets()
  }

  // --- browse ---------------------------------------------------------------

  async search() {
    if (!this.available) return
    this.page = 0
    this.hasMore = false
    this.requestId += 1
    this.loading = false
    this.els.results.replaceChildren()
    await this.fetchPage()
  }

  loadMore() {
    if (this.loading || !this.hasMore || this.view !== 'browse') return
    this.fetchPage()
  }

  async fetchPage() {
    const requestId = this.requestId
    this.loading = true
    this.els.status.textContent = this.page === 0 ? 'Loading…' : 'Loading more…'
    let result
    try {
      result = await this.api.community.list({
        query: this.els.query.value.trim(),
        sort: this.els.sort.value,
        page: this.page + 1,
        pageSize: PAGE_SIZE
      })
    } catch (err) {
      result = { ok: false, error: err?.message }
    }
    if (requestId !== this.requestId) return
    this.loading = false
    if (!result.ok) {
      this.els.status.textContent = result.error || 'Could not load presets.'
      this.els.sentinel.classList.add('hidden')
      return
    }
    this.page += 1
    this.hasMore = result.hasMore
    for (const preset of result.results) this.els.results.appendChild(this.renderCard(preset, { mine: false }))
    const count = this.els.results.children.length
    this.els.status.textContent =
      count === 0
        ? this.els.query.value.trim()
          ? 'No presets match that search.'
          : 'No presets shared yet. Be the first!'
        : plural(count, 'preset')
    this.els.sentinel.classList.toggle('hidden', !this.hasMore)
  }

  renderCard(preset, { mine }) {
    const card = el('article', 'community-card')
    card.dataset.id = preset.id

    const header = el('div', 'community-card-header')
    header.appendChild(el('span', 'community-card-name', preset.name))
    if (preset.hidden) header.appendChild(el('span', 'community-card-badge', 'Hidden (reported)'))
    card.appendChild(header)

    const meta = [
      `by ${preset.author}`,
      plural(preset.soundCount, 'sound'),
      formatSize(preset.sizeBytes),
      plural(preset.downloads ?? 0, 'download'),
      formatDate(preset.updatedAt || preset.createdAt)
    ].filter(Boolean)
    card.appendChild(el('div', 'community-card-meta', meta.join(' · ')))

    if (preset.description) card.appendChild(el('p', 'community-card-desc', preset.description))

    if (preset.tags?.length) {
      const tags = el('div', 'community-card-tags')
      for (const tag of preset.tags.slice(0, MAX_TAGS_SHOWN)) tags.appendChild(el('span', 'community-tag', tag))
      if (preset.tags.length > MAX_TAGS_SHOWN) {
        tags.appendChild(el('span', 'community-tag community-tag-more', `+${preset.tags.length - MAX_TAGS_SHOWN}`))
      }
      card.appendChild(tags)
    }

    const status = el('div', 'community-card-status')
    const footer = el('div', 'community-card-footer')
    footer.appendChild(status)

    if (mine) {
      const updateBtn = el('button', 'btn btn-small', 'Update…')
      updateBtn.type = 'button'
      updateBtn.title = 'Replace this upload with the current version of one of your presets'
      updateBtn.addEventListener('click', () => {
        this.setShareTarget(preset)
        this.showView('share')
      })
      const deleteBtn = el('button', 'btn btn-small', 'Delete')
      deleteBtn.type = 'button'
      deleteBtn.addEventListener('click', () => this.deleteUpload(preset, card, status))
      footer.append(updateBtn, deleteBtn)
    } else {
      const reportBtn = el('button', 'community-report-link', 'Report')
      reportBtn.type = 'button'
      reportBtn.addEventListener('click', () => this.toggleReportForm(card, preset, status))
      const importBtn = el('button', 'btn btn-primary btn-small', 'Import')
      importBtn.type = 'button'
      importBtn.addEventListener('click', () => this.importPreset(preset, importBtn, status))
      footer.append(reportBtn, importBtn)
    }
    card.appendChild(footer)
    return card
  }

  async importPreset(preset, button, status) {
    button.disabled = true
    status.textContent = 'Downloading…'
    let analysis
    try {
      analysis = await this.api.community.download(preset.id)
    } catch (err) {
      analysis = { ok: false, error: err?.message }
    }
    if (!analysis.ok) {
      button.disabled = false
      status.textContent = analysis.error || 'Download failed.'
      return
    }
    // Use the listing's name, not whatever the bundle's manifest says - the
    // author may have renamed it when sharing.
    analysis.name = preset.name
    const detail = { analysis, handled: false }
    window.dispatchEvent(new CustomEvent('noctivago:open-preset-import', { detail }))
    if (!detail.handled) {
      button.disabled = false
      status.textContent = 'Could not open the import dialog.'
      return
    }
    this.pendingImportCard = { button, status }
    status.textContent = 'Review the sounds and confirm…'
  }

  handleImportFinished(result) {
    const pending = this.pendingImportCard
    if (!pending) return
    this.pendingImportCard = null
    pending.button.disabled = false
    if (result?.canceled) {
      pending.status.textContent = ''
    } else if (result?.ok) {
      const failed = result.failedCount ? `, ${result.failedCount} couldn't be added` : ''
      pending.status.textContent = `Imported (${plural(result.soundCount, 'sound')}${failed}). Open it from Presets.`
    } else {
      pending.status.textContent = result?.error || 'Import failed.'
    }
  }

  toggleReportForm(card, preset, status) {
    const existing = card.querySelector('.community-report-form')
    if (existing) {
      existing.remove()
      return
    }
    const form = el('div', 'community-report-form')
    const select = el('select')
    for (const [value, label] of REPORT_REASONS) {
      const option = el('option', null, label)
      option.value = value
      select.appendChild(option)
    }
    const send = el('button', 'btn btn-small', 'Send report')
    send.type = 'button'
    send.addEventListener('click', async () => {
      send.disabled = true
      let result
      try {
        result = await this.api.community.report(preset.id, select.value)
      } catch (err) {
        result = { ok: false, error: err?.message }
      }
      form.remove()
      status.textContent = result.ok ? 'Thanks, reported.' : result.error || 'Report failed.'
    })
    form.append(select, send)
    card.appendChild(form)
  }

  // --- my uploads -----------------------------------------------------------

  async loadMine() {
    this.els.mineStatus.textContent = 'Loading…'
    this.els.mineResults.replaceChildren()
    let result
    try {
      result = await this.api.community.listMine()
    } catch (err) {
      result = { ok: false, error: err?.message }
    }
    if (!result.ok) {
      this.els.mineStatus.textContent = result.error || 'Could not load your uploads.'
      return
    }
    this.els.mineStatus.textContent =
      result.results.length === 0
        ? "You haven't shared any presets from this computer yet."
        : `${plural(result.results.length, 'preset')} shared from this computer.`
    for (const preset of result.results) this.els.mineResults.appendChild(this.renderCard(preset, { mine: true }))
  }

  async deleteUpload(preset, card, status) {
    if (!window.confirm(`Delete "${preset.name}" from the community? This can't be undone.`)) return
    status.textContent = 'Deleting…'
    let result
    try {
      result = await this.api.community.delete(preset.id)
    } catch (err) {
      result = { ok: false, error: err?.message }
    }
    if (!result.ok) {
      status.textContent = result.error || 'Delete failed.'
      return
    }
    card.remove()
    this.els.results.querySelector(`[data-id="${preset.id}"]`)?.remove()
    this.els.mineStatus.textContent = 'Deleted.'
  }

  // --- share ----------------------------------------------------------------

  async refreshLocalPresets() {
    try {
      this.localPresets = await this.api.presets.list()
    } catch {
      this.localPresets = []
    }
    const previous = this.els.sharePreset.value
    this.els.sharePreset.replaceChildren()
    for (const preset of this.localPresets) {
      const option = el('option', null, `${preset.name} (${plural(preset.sounds.length, 'sound')})`)
      option.value = preset.id
      this.els.sharePreset.appendChild(option)
    }
    if (this.localPresets.some((p) => p.id === previous)) this.els.sharePreset.value = previous
    if (!this.shareTarget && !this.els.shareName.value) {
      const selected = this.localPresets.find((p) => p.id === this.els.sharePreset.value)
      if (selected) this.els.shareName.value = selected.name
    }
    this.els.shareSubmit.disabled = this.publishing || this.localPresets.length === 0
  }

  // remote: a "My uploads" entry to replace, or null for a new share.
  setShareTarget(remote) {
    this.shareTarget = remote
    this.els.shareMode.classList.toggle('hidden', !remote)
    this.els.shareCancel.classList.toggle('hidden', !remote)
    this.els.shareSubmit.textContent = remote ? 'Update' : 'Share'
    this.els.shareStatus.textContent = ''
    if (remote) {
      this.els.shareMode.textContent = `Updating "${remote.name}" - pick the local preset to upload in its place.`
      this.els.shareName.value = remote.name
      this.els.shareDescription.value = remote.description || ''
      this.els.shareTags.value = (remote.tags || []).join(', ')
    } else {
      this.els.shareName.value = ''
      this.els.shareDescription.value = ''
      this.els.shareTags.value = ''
    }
    this.els.shareRights.checked = false
  }

  async publish() {
    if (this.publishing) return
    const presetId = this.els.sharePreset.value
    const name = this.els.shareName.value.trim()
    const author = this.els.shareAuthor.value.trim()
    const status = this.els.shareStatus
    if (!presetId) return (status.textContent = 'Pick a preset to share.')
    if (!name) return (status.textContent = 'Give the preset a name.')
    if (!author) return (status.textContent = 'Add your name.')
    if (!this.els.shareRights.checked) return (status.textContent = 'Confirm you have the right to share these sounds.')

    this.publishing = true
    this.els.shareSubmit.disabled = true
    status.textContent = 'Preparing…'
    const stopProgress = this.api.community.onPublishProgress((update) => {
      if (update?.message) status.textContent = update.message
    })
    let result
    try {
      result = await this.api.community.publish({
        presetId,
        remoteId: this.shareTarget?.id ?? null,
        name,
        author,
        description: this.els.shareDescription.value,
        tags: parseTags(this.els.shareTags.value),
        rightsConfirmed: true
      })
    } catch (err) {
      result = { ok: false, error: err?.message }
    } finally {
      stopProgress()
      this.publishing = false
      this.els.shareSubmit.disabled = false
    }
    if (!result.ok) {
      status.textContent = result.error || 'Sharing failed.'
      return
    }
    const wasUpdate = Boolean(this.shareTarget)
    this.setShareTarget(null)
    const linked = result.freesoundCount ? `, ${result.freesoundCount} linked from Freesound` : ''
    status.textContent = `${wasUpdate ? 'Updated' : 'Shared'} "${result.preset.name}" (${plural(result.uploadedAudioCount, 'sound')} uploaded${linked}).`
    this.search()
  }
}
