import { useEffect, useRef } from 'react'

// Hosts a plugin's own settings page. The plugin contract is framework-free
// (mount(container)), same as tabs, so the plugin draws into a plain div.
export function PluginOptionsPage({ page }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    try {
      page.mount(container)
    } catch (err) {
      console.error(`Settings page for plugin "${page.pluginId}" failed to mount`, err)
      container.textContent = `This page failed to load: ${err.message}`
    }
    return () => {
      try {
        page.unmount?.(container)
      } catch (err) {
        console.error(`Settings page for plugin "${page.pluginId}" failed to unmount`, err)
      }
      container.replaceChildren()
    }
  }, [page])

  return (
    <>
      <h3 className="settings-page-heading">{page.title}</h3>
      <div ref={containerRef} />
    </>
  )
}
