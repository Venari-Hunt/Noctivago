// Composite multi-sound "effect" groups (e.g. a door: knob turn + creak +
// bell) - design confirmed directly by the owner, superseding an earlier
// Tags-based recommendation: pick multiple existing sounds, arrange them
// with their own relative delay, and *bake* them into one new real audio
// file ("it is in fact a new audio file... so the existing infrastructure
// is still valid for it"). The result is a completely normal library.js
// entry (created via the exact same library.addSound every plain import
// already goes through) - it just carries a `compositeSource` field purely
// for display (a badge, see SoundRow.js) and so this tab can find it again
// to re-edit/re-bake. Zero new playback code anywhere else in the app -
// Loop/Random Interval/Scheduled, filters, EQ, Export, Save as copy all
// already work on it unchanged.
export default class CompositePlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.library = []
    this.members = []
    this.editingId = null
    this.els = {}
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'composite',
      title: 'Composite',
      mount: (container) => this.mount(container),
      onShow: () => this.refresh()
    })
  }

  async onunload() {
    this.unregister?.()
  }

  mount(container) {
    container.innerHTML = `
      <div class="composite-tab">
        <h2>Composite sound</h2>
        <p class="composite-hint">Combine two or more sounds into one new baked sound - each plays with its own existing filters/trim, at the delay you set. The result is a normal sound you can add to presets, loop, randomize, or schedule like any other.</p>

        <label>
          <span>Edit existing</span>
          <select id="composite-existing">
            <option value="">New composite…</option>
          </select>
        </label>
        <label>
          <span>Name</span>
          <input id="composite-name" type="text" placeholder="Door effect" />
        </label>

        <div id="composite-members"></div>
        <button id="composite-add-member" class="btn btn-icon-text" type="button">+ Add sound</button>

        <button id="composite-bake" class="btn btn-icon-text" type="button">Bake</button>
        <p id="composite-status" class="composite-status"></p>
      </div>
    `

    this.els = {
      existing: container.querySelector('#composite-existing'),
      name: container.querySelector('#composite-name'),
      membersContainer: container.querySelector('#composite-members'),
      addMember: container.querySelector('#composite-add-member'),
      bake: container.querySelector('#composite-bake'),
      status: container.querySelector('#composite-status')
    }

    this.els.existing.addEventListener('change', () => this.loadExisting(this.els.existing.value))
    this.els.addMember.addEventListener('click', () => {
      this.members.push({ soundId: '', delayMs: 0 })
      this.renderMembers()
    })
    this.els.bake.addEventListener('click', () => this.bake())

    this.members = [
      { soundId: '', delayMs: 0 },
      { soundId: '', delayMs: 0 }
    ]
    this.renderMembers()
    this.refresh().catch((err) => console.error('Composite: failed to load library', err))
  }

  async refresh() {
    this.library = await this.api.library.list()
    const composites = this.library.filter((s) => s.compositeSource)
    const previouslySelected = this.els.existing.value
    this.els.existing.innerHTML =
      '<option value="">New composite…</option>' + composites.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')
    if (composites.some((c) => c.id === previouslySelected)) this.els.existing.value = previouslySelected
    this.renderMembers()
  }

  loadExisting(id) {
    if (!id) {
      this.editingId = null
      this.els.name.value = ''
      this.members = [
        { soundId: '', delayMs: 0 },
        { soundId: '', delayMs: 0 }
      ]
      this.renderMembers()
      this.els.status.textContent = ''
      return
    }
    const entry = this.library.find((s) => s.id === id)
    if (!entry?.compositeSource) return
    this.editingId = id
    this.els.name.value = entry.name
    this.members = entry.compositeSource.members.map((m) => ({ ...m }))
    this.renderMembers()
    this.els.status.textContent = ''
  }

  renderMembers() {
    const editableSounds = this.library.filter((s) => s.status === 'ok' && s.id !== this.editingId)
    this.els.membersContainer.innerHTML = this.members
      .map(
        (member, index) => `
        <div class="composite-member-row" data-index="${index}">
          <select class="composite-member-sound">
            <option value="">Select a sound…</option>
            ${editableSounds
              .map((s) => `<option value="${s.id}" ${s.id === member.soundId ? 'selected' : ''}>${s.name}</option>`)
              .join('')}
          </select>
          <input class="composite-member-delay" type="number" min="0" step="50" value="${member.delayMs}" />
          <span class="composite-value">ms</span>
          <button class="composite-member-remove btn btn-svg-icon" type="button" title="Remove">✕</button>
        </div>`
      )
      .join('')

    this.els.membersContainer.querySelectorAll('.composite-member-row').forEach((row) => {
      const index = Number(row.dataset.index)
      row.querySelector('.composite-member-sound').addEventListener('change', (evt) => {
        this.members[index].soundId = evt.target.value
      })
      row.querySelector('.composite-member-delay').addEventListener('input', (evt) => {
        this.members[index].delayMs = Number(evt.target.value) || 0
      })
      row.querySelector('.composite-member-remove').addEventListener('click', () => {
        this.members.splice(index, 1)
        this.renderMembers()
      })
    })
  }

  async bake() {
    const name = this.els.name.value.trim()
    if (!name) {
      this.els.status.textContent = 'Give it a name first.'
      return
    }
    const members = this.members.filter((m) => m.soundId)
    if (members.length < 2) {
      this.els.status.textContent = 'Choose at least two sounds.'
      return
    }

    this.els.bake.disabled = true
    this.els.status.textContent = this.editingId ? 'Re-baking…' : 'Baking…'
    try {
      const result = this.editingId
        ? await this.api.composite.rebake({ id: this.editingId, name, members })
        : await this.api.composite.create({ name, members })
      if (result.ok) {
        this.els.status.textContent = `Saved "${name}" - open it in Remix like any other sound.`
        this.editingId = result.entry.id
        await this.refresh()
        this.els.existing.value = this.editingId
      } else {
        this.els.status.textContent = `Failed: ${result.error}`
      }
    } catch (err) {
      console.error('Composite bake failed', err)
      this.els.status.textContent = `Failed: ${err.message}`
    } finally {
      this.els.bake.disabled = false
    }
  }
}
