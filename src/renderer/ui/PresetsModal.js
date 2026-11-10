import { mockIconSvg } from '../components/mockIcons.jsx'

// Draws the Presets rail / gallery cards (Desktop 2.0, mock screens "presets" and
// "presets-gallery"). `cards` come from tabs/mixer/domain/presetCard.js. Each card
// loads its preset on click or Enter; the corner button opens the card menu
// (rename, duplicate, export, delete); the last card saves the current mix as new.
export function renderPresetCards(listEl, cards, { activeId, onLoad, onMenu, onSaveNew }) {
  listEl.replaceChildren()

  for (const card of cards) {
    const el = document.createElement('div')
    el.className = 'pcard' + (card.id === activeId ? ' cur' : '')
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    el.setAttribute('aria-label', `Load ${card.name}`)
    el.dataset.presetId = card.id

    const corner = document.createElement('div')
    corner.className = 'pcard-corner'
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'pcard-more'
    more.title = 'Rename, duplicate, export, delete'
    more.setAttribute('aria-label', `More for ${card.name}`)
    more.innerHTML = mockIconSvg('ellipsis', 16)
    more.addEventListener('click', (event) => {
      event.stopPropagation()
      const rect = more.getBoundingClientRect()
      onMenu(card, rect.left, rect.bottom + 4)
    })
    corner.appendChild(more)
    el.appendChild(corner)

    const print = document.createElement('div')
    print.className = 'pcard-print'
    print.setAttribute('aria-hidden', 'true')
    for (const bar of card.bars) {
      const i = document.createElement('i')
      i.className = bar.event ? 'ev' : 'lp'
      i.style.height = `${bar.height}px`
      print.appendChild(i)
    }
    el.appendChild(print)

    const name = document.createElement('div')
    name.className = 'pcard-name'
    name.textContent = card.name
    name.title = card.name
    el.appendChild(name)

    const meta = document.createElement('div')
    meta.className = 'pcard-meta'
    meta.textContent = card.modeText ? `${card.countText} · ${card.modeText}` : card.countText
    el.appendChild(meta)

    const chips = document.createElement('div')
    chips.className = 'pcard-chips'
    for (const tag of card.tags) {
      const chip = document.createElement('span')
      chip.className = 'pcard-chip'
      chip.textContent = tag
      chips.appendChild(chip)
    }
    el.appendChild(chips)

    const state = document.createElement('div')
    state.className = 'pcard-state'
    if (card.id === activeId) state.innerHTML = mockIconSvg('check', 14) + 'Loaded'
    else state.textContent = card.createdText
    el.appendChild(state)

    el.addEventListener('click', () => onLoad(card.id))
    el.addEventListener('keydown', (event) => {
      if (event.target !== el) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onLoad(card.id)
      }
    })
    listEl.appendChild(el)
  }

  const save = document.createElement('button')
  save.type = 'button'
  save.className = 'pcard pcard-save'
  save.title = 'Save everything in the mix (sounds, whole-mix filters, Sound Groups) as a new preset'
  save.innerHTML = mockIconSvg('save', 24) + '<b>Save mix as new</b><span>Keeps these sounds and volumes</span>'
  save.addEventListener('click', onSaveNew)
  listEl.appendChild(save)
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
