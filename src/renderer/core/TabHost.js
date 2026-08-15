// Minimal tab host: a button in the tab bar + a lazily-mounted <section> per
// tab. The first tab ever registered becomes active automatically — core
// registers the Mixer tab synchronously at bootstrap, before any plugin is
// loaded, so it's always tab 0 regardless of plugin state.
export function createTabHost(tabBarEl, contentEl) {
  const tabs = new Map()
  let activeId = null

  function activate(id) {
    const tab = tabs.get(id)
    if (!tab) return

    if (activeId && activeId !== id) {
      const prev = tabs.get(activeId)
      if (prev) {
        prev.button.classList.remove('tab-button-active')
        prev.section.classList.add('hidden')
        prev.onHide?.()
      }
    }

    if (!tab.mounted) {
      tab.mounted = true
      try {
        tab.mount(tab.section)
      } catch (err) {
        console.error(`Plugin tab "${id}" failed to mount`, err)
        tab.section.textContent = `This tab failed to load: ${err.message}`
      }
    }

    tab.button.classList.add('tab-button-active')
    tab.section.classList.remove('hidden')
    activeId = id
    tab.onShow?.()
  }

  function register({ id, title, mount, onShow, onHide, onDestroy }) {
    if (tabs.has(id)) throw new Error(`Tab "${id}" is already registered`)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'tab-button'
    button.textContent = title
    button.addEventListener('click', () => activate(id))
    tabBarEl.appendChild(button)

    const section = document.createElement('section')
    section.className = 'tab-panel hidden'
    section.dataset.tabId = id
    contentEl.appendChild(section)

    tabs.set(id, { id, title, mount, onShow, onHide, onDestroy, button, section, mounted: false })

    if (!activeId) activate(id)

    return () => unregister(id)
  }

  function unregister(id) {
    const tab = tabs.get(id)
    if (!tab) return
    tab.onDestroy?.()
    tab.button.remove()
    tab.section.remove()
    tabs.delete(id)
    if (activeId === id) {
      activeId = null
      const next = tabs.keys().next()
      if (!next.done) activate(next.value)
    }
  }

  return { register }
}
