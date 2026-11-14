import { matchShortcut, isTypingTarget } from './shortcuts.js'

// Wires the shortcut table (shortcuts.js) to the app. Actions press the same
// buttons a click would, so each rule stays where it already lives.
export function installKeymap({ tabHost, toggleSettings, showHelp }) {
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat) return
    const target = event.target
    const hit = matchShortcut(event, {
      typing: isTypingTarget(target),
      onControl: !!target?.closest?.('button, a, [role="button"], [role="slider"], [role="switch"]'),
      modalOpen: !!document.querySelector('.modal:not(.hidden), .context-menu')
    })
    if (!hit) return
    const run = () => {
      if (hit.id === 'play') {
        // On the Remix tab Space drives its own preview (Sound mode, or Preset/Group mode), not the Mixer.
        const remix = [...document.querySelectorAll('#editor-play-pause, #editor-mix-play-pause')].find((b) => b.offsetParent !== null)
        ;(remix ?? document.querySelector('.btn-play'))?.click()
      }
      else if (hit.id === 'search') {
        tabHost.activate('mixer')
        // Search lives in the library rail; open the rail first if it is hidden.
        if (document.querySelector('.mx-studio[data-rail="off"]')) document.getElementById('mx-rail-show')?.click()
        document.getElementById('mx-rail-search')?.focus()
      } else if (hit.id === 'save') document.querySelector('[data-pill-save]')?.click()
      else if (hit.id === 'settings') toggleSettings()
      else if (hit.id === 'tab') document.querySelectorAll('#tab-bar .tab-button')[hit.tab]?.click()
      else if (hit.id === 'fullscreen') window.noctivago.toggleFullscreen()
      else if (hit.id === 'help') showHelp()
      // 'marker' (Ctrl+M) belongs to the Remix plugin's own key handler; nothing to run here.
    }
    event.preventDefault()
    run()
  })
}
