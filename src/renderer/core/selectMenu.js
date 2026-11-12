// App-wide convention: every <select> (core or any plugin) opens a styled
// menu instead of the browser's plain popup. One delegated listener set on the
// document, same pattern as numberBoxStepper.js, so no call site changes: the
// real <select> stays in the page as the control (value, change events, focus,
// layout, its label), only its popup is replaced.
//
// An <option> can carry data-icon="<name>" (names in ICONS below) for an icon
// in front of its label. Keyboard in the open menu: Up/Down, Home/End, Enter
// or Space to choose, Esc to close, Tab closes, typing jumps to a label.
// Closed select: Enter, Space or Alt+Down open it (plain arrows still step
// the value natively). Skipped: multiple and size > 1 selects.
import { stepIndex, firstEnabled, lastEnabled, typeAhead, placeMenu } from './selectMenuCore.js'

const svg = (body) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const ICONS = {
  check: svg('<polyline points="20 6 9 17 4 12"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>'),
  sort: svg('<line x1="4" y1="7" x2="14" y2="7"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="17" x2="8" y2="17"/><polyline points="17 9 17 19"/><polyline points="14 16 17 19 20 16"/>'),
  name: svg('<path d="M5 18 9 6l4 12"/><line x1="6.5" y1="14" x2="11.5" y2="14"/><line x1="16" y1="7" x2="20" y2="7"/><line x1="16" y1="12" x2="19" y2="12"/>'),
  speaker: svg('<polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9"/><path d="M16 8a5 5 0 0 1 0 8"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  none: svg('<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>'),
  star: svg('<polygon points="12 3 14.8 9 21 9.7 16.4 14 17.7 21 12 17.6 6.3 21 7.6 14 3 9.7 9.2 9"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  filter: svg('<polygon points="3 4 21 4 14 12.5 14 20 10 18 10 12.5 3 4"/>')
}

let menu = null // { el, select, items, nodes, active, typed, typedAt, raf }

function isEnhanceable(el) {
  return el instanceof HTMLSelectElement && !el.multiple && !(el.size > 1) && !el.disabled
}

function readItems(select) {
  const items = []
  const walk = (node) => {
    for (const child of node.children) {
      if (child instanceof HTMLOptGroupElement) {
        items.push({ label: child.label, header: true, disabled: true })
        walk(child)
      } else if (child instanceof HTMLOptionElement && !child.hidden) {
        items.push({ label: child.textContent.trim(), value: child.value, icon: child.dataset.icon, disabled: child.disabled, option: child })
      }
    }
  }
  walk(select)
  return items
}

function close(refocus = true) {
  if (!menu) return
  cancelAnimationFrame(menu.raf)
  menu.el.remove()
  menu.select.setAttribute('aria-expanded', 'false')
  if (refocus && menu.select.isConnected) menu.select.focus({ preventScroll: true })
  menu = null
}

function setActive(i) {
  if (!menu || i < 0) return
  menu.active = i
  menu.nodes.forEach((n, k) => n && n.classList.toggle('select-menu-active', k === i))
  const node = menu.nodes[i]
  if (node) node.scrollIntoView({ block: 'nearest' })
  menu.el.setAttribute('aria-activedescendant', node ? node.id : '')
}

function choose(i) {
  if (!menu) return
  const item = menu.items[i]
  if (!item || item.disabled) return
  const { select } = menu
  close()
  if (select.value !== item.value) {
    select.value = item.value
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

function open(select) {
  if (menu && menu.select === select) return close()
  close(false)
  const items = readItems(select)
  if (!items.length) return
  const el = document.createElement('div')
  el.className = 'select-menu'
  el.setAttribute('role', 'listbox')
  el.tabIndex = -1
  const selected = items.findIndex((it) => it.option && it.option.selected)
  const nodes = items.map((it, i) => {
    if (it.header) {
      const h = document.createElement('div')
      h.className = 'select-menu-group'
      h.textContent = it.label
      el.append(h)
      return null
    }
    const row = document.createElement('div')
    row.className = 'select-menu-item'
    row.id = `select-menu-opt-${i}`
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', String(i === selected))
    if (it.disabled) row.setAttribute('aria-disabled', 'true')
    const icon = document.createElement('span')
    icon.className = 'select-menu-icon'
    icon.innerHTML = ICONS[it.icon] || ''
    const label = document.createElement('span')
    label.className = 'select-menu-label'
    label.textContent = it.label
    const tick = document.createElement('span')
    tick.className = 'select-menu-tick'
    tick.innerHTML = i === selected ? ICONS.check : ''
    row.append(icon, label, tick)
    row.addEventListener('mousemove', () => !it.disabled && menu && menu.active !== i && setActive(i))
    row.addEventListener('click', () => choose(i))
    el.append(row)
    return row
  })
  const rect = select.getBoundingClientRect()
  el.style.minWidth = `${Math.round(rect.width)}px`
  el.style.left = `${Math.round(rect.left)}px`
  el.style.visibility = 'hidden'
  document.body.append(el)
  const pos = placeMenu(rect, el.scrollHeight, window.innerHeight)
  el.style.top = `${Math.round(pos.top)}px`
  el.style.maxHeight = `${Math.round(pos.height)}px`
  const overflow = rect.left + el.offsetWidth - (window.innerWidth - 8)
  if (overflow > 0) el.style.left = `${Math.max(8, Math.round(rect.left - overflow))}px`
  el.style.visibility = ''
  select.setAttribute('aria-expanded', 'true')
  menu = { el, select, items, nodes, active: -1, typed: '', typedAt: 0, raf: 0 }
  setActive(selected >= 0 ? selected : firstEnabled(items))
  // A plugin may rebuild its selects while the menu is open (Composite refetches
  // on a timer): close if the select left the page.
  const watch = () => {
    if (!menu) return
    if (!select.isConnected) return close(false)
    menu.raf = requestAnimationFrame(watch)
  }
  menu.raf = requestAnimationFrame(watch)
}

function onKeydown(e) {
  if (menu) {
    const { items } = menu
    let handled = true
    if (e.key === 'ArrowDown') setActive(stepIndex(items, Math.max(menu.active, 0), 1))
    else if (e.key === 'ArrowUp') setActive(stepIndex(items, Math.max(menu.active, 0), -1))
    else if (e.key === 'Home') setActive(firstEnabled(items))
    else if (e.key === 'End') setActive(lastEnabled(items))
    else if (e.key === 'Enter' || e.key === ' ') choose(menu.active)
    else if (e.key === 'Escape') close()
    else if (e.key === 'Tab') close(false)
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now()
      menu.typed = now - menu.typedAt > 1000 ? e.key : menu.typed + e.key
      menu.typedAt = now
      setActive(typeAhead(items, menu.active, menu.typed))
    } else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
    return
  }
  const t = e.target
  if (!isEnhanceable(t)) return
  if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) {
    e.preventDefault()
    open(t)
  }
}

function onMousedown(e) {
  if (menu && !menu.el.contains(e.target)) {
    const onOwnSelect = e.target === menu.select
    close(false)
    if (onOwnSelect) {
      e.preventDefault() // the click that closes it must not reopen the native popup
      return
    }
  }
  const t = e.target
  if (e.button !== 0 || !isEnhanceable(t)) return
  e.preventDefault() // suppresses the native popup, keeps focus on the select
  t.focus({ preventScroll: true })
  open(t)
}

export function installSelectMenu() {
  document.addEventListener('mousedown', onMousedown, true)
  document.addEventListener('keydown', onKeydown, true)
  window.addEventListener('blur', () => close(false))
  window.addEventListener('resize', () => close(false))
  document.addEventListener('scroll', (e) => menu && !menu.el.contains(e.target) && close(false), true)
}
