// Minimal tab host: a button in the tab bar + a lazily-mounted <section> per
// tab. The first tab ever registered becomes active automatically — core
// registers the Mixer tab synchronously at bootstrap, before any plugin is
// loaded, so it's always tab 0 regardless of plugin state.
//
// A tab can also register a `mountSticky` alongside `mount` - its own
// section in the shared sticky bar directly under the tab bar (outside the
// scrolling tab content, a fixed-height flex sibling in #app, not
// `position: sticky` - simpler and has no scroll-container edge cases to
// get wrong). Distinct from the app-wide toolbar above the tab bar (global
// mix play/pause + master volume, unrelated to any one tab): this is
// per-tab, for controlling whatever's local to that tab (e.g. the Remix
// plugin's own trim preview) - only the currently active tab's sticky
// section is ever visible, and the shared bar itself hides entirely for a
// tab that doesn't provide one (e.g. the Mixer, which has no single
// "current preview" the way Remix does).
//
// A tab can also register `onBeforeHide` - an optional async veto hook,
// checked right before switching *away* from that tab, that can cancel the
// switch by resolving `false` (any other return value, including nothing,
// allows it). Built for the Remix plugin's unsaved-changes leave prompt
// (Yes/No/Don't ask again) - `onHide` alone can't do this, since it's a
// fire-and-forget cleanup call, not a gate the switch itself waits on.
export function createTabHost(tabBarEl, contentEl, stickyBarEl) {
  const tabs = new Map()
  let activeId = null

  // async so a tab can veto leaving it (onBeforeHide, e.g. Remix's unsaved-
  // changes prompt) - callers (the button click handler, register()'s
  // first-tab auto-activate) don't await this, which is fine: they're all
  // fire-and-forget UI triggers, not code that depends on the switch having
  // already happened by the time they return.
  async function activate(id) {
    const tab = tabs.get(id)
    if (!tab) return

    if (activeId && activeId !== id) {
      const prev = tabs.get(activeId)
      if (prev?.onBeforeHide) {
        const allowed = await prev.onBeforeHide()
        if (allowed === false) return // vetoed - stay on the current tab
      }
      if (prev) {
        prev.button.classList.remove('tab-button-active')
        prev.section.classList.add('hidden')
        prev.stickySection?.classList.add('hidden')
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
      if (tab.mountSticky && tab.stickySection) {
        try {
          tab.mountSticky(tab.stickySection)
        } catch (err) {
          console.error(`Plugin tab "${id}" failed to mount its sticky bar`, err)
        }
      }
    }

    tab.button.classList.add('tab-button-active')
    tab.section.classList.remove('hidden')
    if (tab.stickySection) {
      tab.stickySection.classList.remove('hidden')
      stickyBarEl?.classList.remove('hidden')
    } else {
      stickyBarEl?.classList.add('hidden')
    }
    activeId = id
    tab.onShow?.()
  }

  function register({ id, title, mount, mountSticky, onShow, onHide, onBeforeHide, onDestroy }) {
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

    let stickySection = null
    if (mountSticky && stickyBarEl) {
      stickySection = document.createElement('div')
      stickySection.className = 'tab-sticky-panel hidden'
      stickySection.dataset.tabId = id
      stickyBarEl.appendChild(stickySection)
    }

    tabs.set(id, { id, title, mount, mountSticky, onShow, onHide, onBeforeHide, onDestroy, button, section, stickySection, mounted: false })

    if (!activeId) activate(id)

    return () => unregister(id)
  }

  function unregister(id) {
    const tab = tabs.get(id)
    if (!tab) return
    tab.onDestroy?.()
    tab.button.remove()
    tab.section.remove()
    tab.stickySection?.remove()
    tabs.delete(id)
    if (activeId === id) {
      activeId = null
      const next = tabs.keys().next()
      if (!next.done) activate(next.value)
    }
  }

  return { register }
}
