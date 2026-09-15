// Browse Sounds - a dedicated tab for internet-sourced sound discovery,
// split out of the old "Search Freesound…" add-sound-menu dialog per the
// owner's own 2026-09-15 direction: browsing/discovering unknown sounds
// needs fundamentally more screen space and richer UI than importing a file
// you already have and know (which is why the old dialog felt "underbaked").
// Local file/folder/watch-folder/record imports explicitly stay in core's
// "+" menu, unchanged - only internet-sourced search moves here.
//
// Freesound is the only source wired up so far - its own search/preview/
// import plumbing (src/main/freesound/) was already fully built (v0.1.190),
// so this is mostly a richer front end over the same backend: a responsive
// card grid instead of a cramped modal list, infinite scroll instead of a
// "Load more" button, a sort picker the old dialog never actually exposed
// despite the API already supporting it, and every field Freesound's search
// response already returns (tags, description, rating) instead of just
// name/uploader/duration/license. A YouTube source is planned (per the
// Board) but needs its own research pass first - the "search both sources
// combined, tagged by source" decision only matters once a second source
// actually exists, so there's no toggle here yet, just a small per-card
// source badge so the layout doesn't need to change when one lands.
//
// Self-contained per the plugin sandbox's own rule (can't import outside
// its own directory) - this plugin has no core logic to duplicate, though,
// since window.noctivago.freesound/library are already the full API surface
// a plugin needs (see PluginLoader.js: app.noctivago is window.noctivago
// handed through wholesale).

const SORT_OPTIONS = [
  ['score', 'Best match'],
  ['rating_desc', 'Highest rated'],
  ['downloads_desc', 'Most downloaded'],
  ['duration_desc', 'Longest'],
  ['duration_asc', 'Shortest'],
  ['created_desc', 'Newest']
]

const PAGE_SIZE = 24
const MAX_TAGS_SHOWN = 6

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

export default class BrowseSoundsPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.els = {}
    this.query = ''
    this.sort = 'score'
    this.page = 1
    this.hasMore = false
    this.loading = false
    this.previewAudio = null
    this.previewBtn = null
    this.observer = null
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'browse-sounds',
      title: 'Browse Sounds',
      mount: (container) => this.mount(container),
      onHide: () => this.stopPreview()
    })
  }

  async onunload() {
    this.stopPreview()
    this.observer?.disconnect()
    this.unregister?.()
  }

  mount(container) {
    container.innerHTML = `
      <div class="browse-tab">
        <p class="browse-hint">Search and import ambient sounds from Freesound.org straight into your library. Only the compressed preview is downloaded (not the original file) — attribution is kept automatically for licenses that require it.</p>

        <div class="browse-search-row">
          <input id="browse-query" type="text" placeholder="rain, wind, birds…" autocomplete="off" />
          <select id="browse-sort">
            ${SORT_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
          </select>
          <button id="browse-search-btn" class="btn btn-primary" type="button">Search</button>
        </div>

        <p id="browse-unavailable" class="modal-hint hidden">Freesound import isn't available in this build (no API key baked in).</p>
        <p id="browse-status" class="browse-status"></p>
        <div id="browse-results" class="browse-results"></div>
        <div id="browse-sentinel" class="browse-sentinel hidden"></div>
      </div>
    `

    this.els = {
      query: container.querySelector('#browse-query'),
      sort: container.querySelector('#browse-sort'),
      searchBtn: container.querySelector('#browse-search-btn'),
      unavailable: container.querySelector('#browse-unavailable'),
      status: container.querySelector('#browse-status'),
      results: container.querySelector('#browse-results'),
      sentinel: container.querySelector('#browse-sentinel')
    }

    this.els.searchBtn.addEventListener('click', () => this.search())
    this.els.query.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') this.search()
    })
    this.els.sort.addEventListener('change', () => {
      if (this.query) this.search()
    })

    this.observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) this.loadMore()
    })
    this.observer.observe(this.els.sentinel)

    this.checkAvailability()
  }

  async checkAvailability() {
    const available = await this.api.freesound.isAvailable()
    this.els.unavailable.classList.toggle('hidden', available)
    this.els.query.disabled = !available
    this.els.searchBtn.disabled = !available
    if (available) this.els.query.focus()
  }

  search() {
    const query = this.els.query.value.trim()
    if (!query) return
    this.stopPreview()
    this.query = query
    this.sort = this.els.sort.value
    this.page = 1
    this.hasMore = false
    this.els.results.replaceChildren()
    this.runSearch({ append: false })
  }

  loadMore() {
    if (this.loading || !this.hasMore || !this.query) return
    this.page += 1
    this.runSearch({ append: true })
  }

  async runSearch({ append }) {
    this.loading = true
    this.els.searchBtn.disabled = true
    if (!append) this.els.status.textContent = 'Searching…'

    const result = await this.api.freesound.search({
      query: this.query,
      page: this.page,
      sort: this.sort,
      pageSize: PAGE_SIZE
    })

    this.loading = false
    this.els.searchBtn.disabled = false

    if (!result.ok) {
      this.els.status.textContent = result.error || 'Search failed.'
      this.hasMore = false
      this.els.sentinel.classList.add('hidden')
      return
    }

    for (const sound of result.results) this.els.results.appendChild(this.renderCard(sound))

    if (result.results.length === 0 && !append) {
      this.els.status.textContent = 'No results.'
    } else {
      this.els.status.textContent = `${result.count} result${result.count === 1 ? '' : 's'}`
    }

    this.hasMore = result.hasMore
    this.els.sentinel.classList.toggle('hidden', !this.hasMore)
  }

  stopPreview() {
    if (this.previewAudio) {
      this.previewAudio.pause()
      this.previewAudio.src = ''
      this.previewAudio = null
    }
    if (this.previewBtn) {
      this.previewBtn.textContent = '▶'
      this.previewBtn.title = 'Preview'
      this.previewBtn = null
    }
  }

  togglePreview(sound, btn) {
    if (this.previewBtn === btn) {
      this.stopPreview()
      return
    }
    this.stopPreview()
    const audio = new Audio(`freesound-preview://p/${encodeURIComponent(sound.previewUrl)}`)
    audio.addEventListener('ended', () => this.stopPreview())
    audio.addEventListener('error', () => this.stopPreview())
    audio.play().catch(() => this.stopPreview())
    this.previewAudio = audio
    this.previewBtn = btn
    btn.textContent = '⏸'
    btn.title = 'Stop preview'
  }

  async importResult(sound, card) {
    const importBtn = card.querySelector('.browse-import-btn')
    const status = card.querySelector('.browse-card-status')
    importBtn.disabled = true
    status.textContent = 'Importing…'
    try {
      await this.api.library.addSoundFromFreesound({
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

  renderCard(sound) {
    const card = document.createElement('div')
    card.className = 'browse-card'

    const header = document.createElement('div')
    header.className = 'browse-card-header'

    const previewBtn = document.createElement('button')
    previewBtn.type = 'button'
    previewBtn.className = 'browse-preview-btn'
    previewBtn.title = 'Preview'
    previewBtn.textContent = '▶'
    previewBtn.addEventListener('click', () => this.togglePreview(sound, previewBtn))

    const name = document.createElement('span')
    name.className = 'browse-card-name'
    name.textContent = sound.name
    name.title = sound.name

    const badge = document.createElement('span')
    badge.className = 'browse-card-badge'
    badge.textContent = 'Freesound'

    header.append(previewBtn, name, badge)

    const meta = document.createElement('div')
    meta.className = 'browse-card-meta'
    const ratingPart = sound.numRatings > 0 ? ` · ★${sound.avgRating.toFixed(1)} (${sound.numRatings})` : ''
    meta.textContent = `by ${sound.username} · ${formatDuration(sound.durationSeconds)} · ${licenseLabel(sound.license)}${ratingPart}`

    card.append(header, meta)

    if (sound.description) {
      const desc = document.createElement('p')
      desc.className = 'browse-card-desc'
      desc.textContent = sound.description
      desc.title = sound.description
      card.appendChild(desc)
    }

    if (sound.tags?.length > 0) {
      const tagsEl = document.createElement('div')
      tagsEl.className = 'browse-card-tags'
      for (const tag of sound.tags.slice(0, MAX_TAGS_SHOWN)) {
        const pill = document.createElement('span')
        pill.className = 'browse-tag'
        pill.textContent = tag
        tagsEl.appendChild(pill)
      }
      if (sound.tags.length > MAX_TAGS_SHOWN) {
        const more = document.createElement('span')
        more.className = 'browse-tag browse-tag-more'
        more.textContent = `+${sound.tags.length - MAX_TAGS_SHOWN}`
        tagsEl.appendChild(more)
      }
      card.appendChild(tagsEl)
    }

    const footer = document.createElement('div')
    footer.className = 'browse-card-footer'
    const status = document.createElement('span')
    status.className = 'browse-card-status'
    const importBtn = document.createElement('button')
    importBtn.type = 'button'
    importBtn.className = 'browse-import-btn btn btn-icon-text'
    importBtn.textContent = 'Import'
    importBtn.addEventListener('click', () => this.importResult(sound, card))
    footer.append(status, importBtn)
    card.appendChild(footer)

    return card
  }
}
