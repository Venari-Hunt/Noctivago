// Browse Sounds - a dedicated tab for internet-sourced sound discovery,
// split out of the old "Search Freesound…" add-sound-menu dialog per the
// owner's own 2026-09-15 direction: browsing/discovering unknown sounds
// needs fundamentally more screen space and richer UI than importing a file
// you already have and know (which is why the old dialog felt "underbaked").
// Local file/folder/watch-folder/record imports explicitly stay in core's
// "+" menu, unchanged - only internet-sourced search moves here.
//
// Two sources, searched together and combined into one grid, each card
// tagged with its own source badge - the owner's own answer (2026-09-15) to
// "should this be a toggle or combined": "search both sources at once,
// combined, tagged by source."
//
// - Freesound: its own search/preview/import plumbing (src/main/freesound/)
//   was already fully built (v0.1.190) - a card grid instead of a cramped
//   modal list, infinite scroll instead of a "Load more" button, a sort
//   picker the old dialog never exposed, and every field the API already
//   returns (tags, description, rating).
// - YouTube (v0.1.206, after a 2026-09-15 research pass - see CLAUDE.md):
//   the official Data API's quota is per-project, not per-user, so a single
//   app-wide key would cap this app's entire userbase combined at ~100
//   searches/day - a non-starter. Instead this reuses the yt-dlp binary
//   already bundled for "Add from link" (src/main/ytdlp/search.js), which
//   searches with no key and no quota. No in-app audio preview (no cheap
//   streaming preview URL the way Freesound has) - a "Watch ↗" link opens
//   the real video externally instead. Import reuses the exact same
//   yt-dlp-download pipeline "Add from link" already uses
//   (library:addSoundFromUrl), capped at the same 10-minute default.
//
// Isolation between the two sources is deliberate, not incidental (owner's
// own direction): every YouTube-specific call - availability check, search,
// import - is independently try/caught so a yt-dlp failure (missing binary,
// network error, a search timeout, a malformed result) never blocks,
// clears, or otherwise affects Freesound's half, and vice versa. Each
// source tracks its own page/loading/hasMore state; the shared grid and
// infinite-scroll sentinel just reflect whichever source(s) still have more.
//
// Self-contained per the plugin sandbox's own rule (can't import outside
// its own directory) - this plugin has no core logic to duplicate, though,
// since window.noctivago.freesound/ytdlp/library are already the full API
// surface a plugin needs (see PluginLoader.js: app.noctivago is
// window.noctivago handed through wholesale).

const SORT_OPTIONS = [
  ['score', 'Best match'],
  ['rating_desc', 'Highest rated'],
  ['downloads_desc', 'Most downloaded'],
  ['duration_desc', 'Longest'],
  ['duration_asc', 'Shortest'],
  ['created_desc', 'Newest']
]

const FREESOUND_PAGE_SIZE = 24
// Smaller than Freesound's page - each yt-dlp search call takes a couple of
// real seconds (verified against the real bundled binary), unlike
// Freesound's near-instant API call, so a smaller page keeps infinite
// scroll feeling responsive rather than pausing for a large batch.
const YOUTUBE_PAGE_SIZE = 12
const MAX_TAGS_SHOWN = 6
// Matches AddLinkDialog's own DEFAULT_MAX_MINUTES - same yt-dlp download
// pipeline, same reasoning ("so you don't download a 10h file since you can
// loop and crossfade it on the app").
const YOUTUBE_DEFAULT_MAX_SECONDS = 10 * 60

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

function cleanErrorMessage(err, fallback) {
  const clean = (err?.message || fallback).replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
  return clean.split(/[.(\n]/)[0].trim()
}

function freshSourceState() {
  return { available: false, page: 0, hasMore: false, loading: false, error: null }
}

export default class BrowseSoundsPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.els = {}
    this.query = ''
    this.sort = 'score'
    this.sources = { freesound: freshSourceState(), youtube: freshSourceState() }
    this.previewAudio = null
    this.previewBtn = null
    this.observer = null
    this.requestId = 0
    // YouTube-only (Freesound's API gives a stable cursor): each page is a
    // fresh yt-dlp search re-scraping up through its own end index rather
    // than continuing a saved cursor (see search.js) - verified live that
    // consecutive pages can rank a couple of videos differently between
    // calls, producing the odd repeat at a page boundary. Tracked per
    // search (cleared in search(), not loadMore()) so a genuine "same video
    // shown twice" doesn't slip through infinite scroll.
    this.seenYoutubeIds = new Set()
    this.youtubeImporting = false
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
        <p class="browse-hint">Search and import ambient sounds from Freesound.org and YouTube straight into your library. Freesound downloads only the compressed preview (not the original file) — attribution is kept automatically for licenses that require it. YouTube results download through the same tool "Add from link" already uses, capped at 10 minutes.</p>

        <div class="browse-search-row">
          <input id="browse-query" type="text" placeholder="rain, wind, birds…" autocomplete="off" />
          <select id="browse-sort" title="Sorts Freesound results - YouTube results follow its own relevance order">
            ${SORT_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
          </select>
          <button id="browse-search-btn" class="btn btn-primary" type="button">Search</button>
        </div>

        <p id="browse-unavailable" class="modal-hint hidden"></p>
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

  // Each source's own availability check is independent - a throwing
  // YouTube check (e.g. an older cached preload with no ytdlp namespace)
  // must never stop Freesound's own check from running or being trusted.
  async checkAvailability() {
    const [freesoundAvailable, youtubeAvailable] = await Promise.all([
      this.api.freesound.isAvailable().catch(() => false),
      Promise.resolve()
        .then(() => this.api.ytdlp?.isSearchAvailable())
        .catch(() => false)
    ])

    this.sources.freesound.available = freesoundAvailable
    this.sources.youtube.available = Boolean(youtubeAvailable)

    const anyAvailable = freesoundAvailable || youtubeAvailable
    this.els.unavailable.classList.toggle('hidden', freesoundAvailable && youtubeAvailable)
    if (!freesoundAvailable && !youtubeAvailable) {
      this.els.unavailable.textContent = "Search isn't available in this build."
    } else if (!freesoundAvailable) {
      this.els.unavailable.textContent = "Freesound import isn't available in this build (no API key baked in) — YouTube search still works."
    } else if (!youtubeAvailable) {
      this.els.unavailable.textContent = "YouTube search isn't available in this build — Freesound still works."
    }
    this.els.query.disabled = !anyAvailable
    this.els.searchBtn.disabled = !anyAvailable
    if (anyAvailable) this.els.query.focus()
  }

  search() {
    const query = this.els.query.value.trim()
    if (!query) return
    this.stopPreview()
    this.query = query
    this.sort = this.els.sort.value
    this.requestId += 1
    for (const key of Object.keys(this.sources)) {
      const s = this.sources[key]
      s.page = 0
      s.hasMore = s.available
      s.error = null
    }
    this.els.results.replaceChildren()
    this.els.sentinel.classList.add('hidden')
    this.els.status.textContent = 'Searching…'
    this.seenYoutubeIds.clear()

    for (const key of Object.keys(this.sources)) {
      if (this.sources[key].available) this.fetchSource(key, { append: false })
    }
  }

  loadMore() {
    if (!this.query) return
    for (const key of Object.keys(this.sources)) {
      const s = this.sources[key]
      if (s.available && s.hasMore && !s.loading) this.fetchSource(key, { append: true })
    }
  }

  // Isolation (owner's own direction, 2026-09-15): each source is fetched
  // and rendered independently, wrapped in its own try/catch, so a failure
  // in one (a thrown IPC error, a malformed result crashing renderCard)
  // never wipes or blocks the other source's results already on screen.
  async fetchSource(key, { append }) {
    const s = this.sources[key]
    s.loading = true
    s.page += 1
    this.updateSearchButtonState()

    const requestId = this.requestId
    let result
    try {
      result = key === 'freesound' ? await this.searchFreesound(s.page) : await this.searchYouTube(s.page)
    } catch (err) {
      result = { ok: false, error: cleanErrorMessage(err, 'Search failed.') }
    }

    if (requestId !== this.requestId) return // superseded by a newer search
    s.loading = false
    this.updateSearchButtonState()

    if (!result.ok) {
      s.hasMore = false
      s.error = result.error || 'Search failed.'
      this.updateStatus()
      return
    }

    s.error = null
    if (!append) {
      // A source that returns late (e.g. YouTube's slower search) must not
      // wipe cards the other source already appended for this same fresh
      // search - only ever clear this source's own prior cards.
      for (const el of this.els.results.querySelectorAll(`[data-source="${key}"]`)) el.remove()
    }
    for (const sound of result.results) {
      if (key === 'youtube') {
        if (this.seenYoutubeIds.has(sound.id)) continue
        this.seenYoutubeIds.add(sound.id)
      }
      try {
        this.els.results.appendChild(this.renderCard(sound, key))
      } catch (err) {
        console.error('Browse Sounds: failed to render a result card', key, err)
      }
    }
    s.hasMore = Boolean(result.hasMore)
    this.updateStatus()
    this.els.sentinel.classList.toggle('hidden', !(this.sources.freesound.hasMore || this.sources.youtube.hasMore))
  }

  async searchFreesound(page) {
    return this.api.freesound.search({ query: this.query, page, sort: this.sort, pageSize: FREESOUND_PAGE_SIZE })
  }

  async searchYouTube(page) {
    return this.api.ytdlp.searchYouTube({ query: this.query, page, pageSize: YOUTUBE_PAGE_SIZE })
  }

  updateSearchButtonState() {
    this.els.searchBtn.disabled = this.sources.freesound.loading || this.sources.youtube.loading
  }

  updateStatus() {
    const count = this.els.results.children.length
    const anyLoading = this.sources.freesound.loading || this.sources.youtube.loading
    if (count === 0 && anyLoading) {
      this.els.status.textContent = 'Searching…'
      return
    }
    if (count === 0) {
      const errors = [this.sources.freesound.error, this.sources.youtube.error].filter(Boolean)
      this.els.status.textContent = errors[0] || 'No results.'
      return
    }
    this.els.status.textContent = `${count} result${count === 1 ? '' : 's'}`
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
      status.textContent = `Failed: ${cleanErrorMessage(err, 'Import failed')}`
    }
  }

  // yt-dlp downloads (audio extraction + optional trim to the 10-minute
  // cap) take real wall-clock time, unlike Freesound's near-instant preview
  // download - reuses library:addSoundFromUrl's own progress channel
  // (the same one AddLinkDialog.js drives) to show real status instead of a
  // bare spinner. Only one YouTube import can run at a time (the progress
  // channel is a single global stream with no per-request id to route by -
  // same constraint AddLinkDialog's own single-download-at-a-time dialog
  // already has), so every other YouTube Import button is disabled while
  // one is in flight; Freesound imports are unaffected since they use a
  // separate channel and finish fast enough to not need this guard.
  async importYouTubeResult(sound, card) {
    if (this.youtubeImporting) return
    this.youtubeImporting = true
    const importBtn = card.querySelector('.browse-import-btn')
    const status = card.querySelector('.browse-card-status')
    const otherYoutubeButtons = this.els.results.querySelectorAll('[data-source="youtube"] .browse-import-btn')
    for (const btn of otherYoutubeButtons) btn.disabled = true
    status.textContent = 'Starting…'

    const unsubscribe = this.api.library.onAddSoundFromUrlProgress((update) => {
      if (!update) return
      if (update.type === 'progress') {
        status.textContent = `Downloading… ${Math.round(update.percent)}%`
      } else if (update.message) {
        status.textContent = update.message
      }
    })

    try {
      await this.api.library.addSoundFromUrl({ url: sound.url, name: sound.title, maxSeconds: YOUTUBE_DEFAULT_MAX_SECONDS })
      status.textContent = 'Added ✓'
      document.dispatchEvent(new CustomEvent('library:linked'))
    } catch (err) {
      status.textContent = `Failed: ${cleanErrorMessage(err, 'Import failed')}`
      importBtn.disabled = false
    } finally {
      unsubscribe()
      this.youtubeImporting = false
      for (const btn of otherYoutubeButtons) {
        if (btn !== importBtn) btn.disabled = false
      }
    }
  }

  renderCard(sound, source) {
    const card = document.createElement('div')
    card.className = 'browse-card'
    card.dataset.source = source

    if (source === 'youtube' && sound.thumbnailUrl) {
      const thumb = document.createElement('img')
      thumb.className = 'browse-card-thumb'
      thumb.src = sound.thumbnailUrl
      thumb.alt = ''
      thumb.loading = 'lazy'
      card.appendChild(thumb)
    }

    const header = document.createElement('div')
    header.className = 'browse-card-header'

    if (source === 'freesound') {
      const previewBtn = document.createElement('button')
      previewBtn.type = 'button'
      previewBtn.className = 'browse-preview-btn'
      previewBtn.title = 'Preview'
      previewBtn.textContent = '▶'
      previewBtn.addEventListener('click', () => this.togglePreview(sound, previewBtn))
      header.appendChild(previewBtn)
    } else {
      // No cheap streaming preview for a YouTube result - opens the real
      // video externally instead (the app's window-open handler routes any
      // target="_blank" link to the OS browser via shell.openExternal).
      const watchLink = document.createElement('a')
      watchLink.className = 'browse-preview-btn'
      watchLink.title = 'Watch on YouTube'
      watchLink.textContent = '↗'
      watchLink.href = sound.url
      watchLink.target = '_blank'
      watchLink.rel = 'noopener noreferrer'
      header.appendChild(watchLink)
    }

    const name = document.createElement('span')
    name.className = 'browse-card-name'
    name.textContent = source === 'freesound' ? sound.name : sound.title
    name.title = name.textContent

    const badge = document.createElement('span')
    badge.className = 'browse-card-badge'
    badge.textContent = source === 'freesound' ? 'Freesound' : 'YouTube'

    header.append(name, badge)

    const meta = document.createElement('div')
    meta.className = 'browse-card-meta'
    if (source === 'freesound') {
      const ratingPart = sound.numRatings > 0 && sound.avgRating != null ? ` · ★${sound.avgRating.toFixed(1)} (${sound.numRatings})` : ''
      meta.textContent = `by ${sound.username} · ${formatDuration(sound.durationSeconds)} · ${licenseLabel(sound.license)}${ratingPart}`
    } else {
      meta.textContent = `${sound.channel} · ${formatDuration(sound.durationSeconds)}`
    }

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
    importBtn.addEventListener('click', () =>
      source === 'freesound' ? this.importResult(sound, card) : this.importYouTubeResult(sound, card)
    )
    footer.append(status, importBtn)
    card.appendChild(footer)

    return card
  }
}
