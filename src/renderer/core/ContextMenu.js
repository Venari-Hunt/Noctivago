// A minimal floating right-click menu - first real use is the Mixer's
// per-sound "Add to group…" menu (Sound Groups, see AudioEngine.js's
// SoundGroupChain), kept generic since a right-click menu is a reusable
// primitive rather than something worth building bespoke per call site.
// Single active instance at a time (a second call closes whatever's open) -
// this app never needs two context menus open at once.

let activeMenu = null
let outsideHandler = null
let keyHandler = null

export function closeContextMenu() {
  if (!activeMenu) return
  activeMenu.remove()
  activeMenu = null
  if (outsideHandler) document.removeEventListener('mousedown', outsideHandler)
  if (keyHandler) document.removeEventListener('keydown', keyHandler)
  outsideHandler = null
  keyHandler = null
}

// items: array of either { separator: true } or { label, onClick, disabled }.
export function openContextMenu(x, y, items) {
  closeContextMenu()

  const menu = document.createElement('div')
  menu.className = 'context-menu'
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`

  for (const item of items) {
    if (item.separator) {
      menu.appendChild(document.createElement('hr'))
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'context-menu-item'
    btn.textContent = item.label
    btn.disabled = Boolean(item.disabled)
    if (!item.disabled) {
      btn.addEventListener('click', () => {
        closeContextMenu()
        item.onClick?.()
      })
    }
    menu.appendChild(btn)
  }

  document.body.appendChild(menu)

  // Clamp inside the viewport - a right-click near the window's right/bottom
  // edge would otherwise render partly (or fully) off-screen.
  const rect = menu.getBoundingClientRect()
  if (rect.right > window.innerWidth) menu.style.left = `${Math.max(0, window.innerWidth - rect.width - 4)}px`
  if (rect.bottom > window.innerHeight) menu.style.top = `${Math.max(0, window.innerHeight - rect.height - 4)}px`

  activeMenu = menu
  // Deferred so the click/contextmenu event that opened this menu doesn't
  // immediately bubble into "outside click" and close it in the same tick.
  setTimeout(() => {
    outsideHandler = (evt) => {
      if (activeMenu && !activeMenu.contains(evt.target)) closeContextMenu()
    }
    keyHandler = (evt) => {
      if (evt.key === 'Escape') closeContextMenu()
    }
    document.addEventListener('mousedown', outsideHandler)
    document.addEventListener('keydown', keyHandler)
  }, 0)
}
