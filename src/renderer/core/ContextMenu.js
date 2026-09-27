// A minimal floating right-click menu - first real use is the Mixer's
// per-sound "Add to group…" menu (Sound Groups, see AudioEngine.js's
// SoundGroupChain), kept generic since a right-click menu is a reusable
// primitive rather than something worth building bespoke per call site.
// Single active instance at a time (a second call closes whatever's open) -
// this app never needs two context menus open at once.

import { menuIconSvg } from './menuIcons.js'

let activeMenu = null
let activeSubmenu = null
let outsideHandler = null
let keyHandler = null

export function closeContextMenu() {
  if (!activeMenu) return
  closeSubmenu()
  activeMenu.remove()
  activeMenu = null
  if (outsideHandler) document.removeEventListener('mousedown', outsideHandler)
  if (keyHandler) document.removeEventListener('keydown', keyHandler)
  outsideHandler = null
  keyHandler = null
}

function closeSubmenu() {
  activeSubmenu?.remove()
  activeSubmenu = null
}

// Clamp inside the viewport - a right-click near the window's right/bottom
// edge would otherwise render partly (or fully) off-screen.
function clampToViewport(menu) {
  const rect = menu.getBoundingClientRect()
  if (rect.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - rect.width - 4)}px`
  if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - rect.height - 4)}px`
}

function openSubmenu(parentMenu, btn, items) {
  closeSubmenu()
  const rect = btn.getBoundingClientRect()
  const submenu = buildMenu(rect.right + 2, rect.top - 4, items, { isSubmenu: true })
  document.body.appendChild(submenu)
  // No room on the right: open on the parent menu's left instead.
  if (submenu.getBoundingClientRect().right > window.innerWidth) {
    submenu.style.left = `${Math.max(0, parentMenu.getBoundingClientRect().left - submenu.offsetWidth - 2)}px`
  }
  clampToViewport(submenu)
  activeSubmenu = submenu
  activeSubmenu.owner = btn
}

function buildMenu(x, y, items, { isSubmenu = false } = {}) {
  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  const hasIcons = items.some((item) => item.icon)

  for (const item of items) {
    if (item.separator) {
      menu.appendChild(document.createElement('hr'))
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'context-menu-item'
    // Once any item in this menu has an icon, every item gets the slot
    // (blank when it has none) so the labels line up.
    if (hasIcons) {
      const icon = document.createElement('span')
      icon.className = 'context-menu-icon'
      icon.innerHTML = menuIconSvg(item.icon)
      btn.appendChild(icon)
    }
    const label = document.createElement('span')
    label.className = 'context-menu-label'
    label.textContent = item.label
    btn.appendChild(label)
    btn.disabled = Boolean(item.disabled)
    if (item.submenu) {
      btn.classList.add('context-menu-item-submenu')
      const open = () => {
        if (activeSubmenu?.owner !== btn) openSubmenu(menu, btn, item.submenu)
      }
      if (!item.disabled) {
        btn.addEventListener('mouseenter', open)
        btn.addEventListener('click', open)
      }
    } else {
      // Hovering a plain item of the main menu closes an open submenu.
      if (!isSubmenu) btn.addEventListener('mouseenter', closeSubmenu)
      if (!item.disabled) {
        btn.addEventListener('click', () => {
          closeContextMenu()
          item.onClick?.()
        })
      }
    }
    menu.appendChild(btn)
  }
  return menu
}

// items: array of { separator: true }, { label, icon, onClick, disabled },
// or { label, icon, submenu: items, disabled } - icon is a menuIcons.js
// name; submenus are one level deep, open on hover or click.
export function openContextMenu(x, y, items) {
  closeContextMenu()

  const menu = buildMenu(x, y, items)
  document.body.appendChild(menu)
  clampToViewport(menu)

  activeMenu = menu
  // Deferred so the click/contextmenu event that opened this menu doesn't
  // immediately bubble into "outside click" and close it in the same tick.
  setTimeout(() => {
    outsideHandler = (evt) => {
      if (activeMenu && !activeMenu.contains(evt.target) && !activeSubmenu?.contains(evt.target)) closeContextMenu()
    }
    keyHandler = (evt) => {
      if (evt.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('mousedown', outsideHandler)
    document.addEventListener('keydown', keyHandler)
  }, 0)
}
