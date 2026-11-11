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
      if (hit.id === 'play') document.querySelector('.btn-play')?.click()
      else if (hit.id === 'search') {
        tabHost.activate('mixer')
        document.getElementById('sound-search')?.focus()
      } else if (hit.id === 'save') document.querySelector('[data-pill-save]')?.click()
      else if (hit.id === 'settings') toggleSettings()
      else if (hit.id === 'tab') document.querySelectorAll('#tab-bar .tab-button')[hit.tab]?.click()
      else if (hit.id === 'fullscreen') window.noctivago.toggleFullscreen()
      else if (hit.id === 'help') showHelp()
    }
    event.preventDefault()
    run()
  })
}
