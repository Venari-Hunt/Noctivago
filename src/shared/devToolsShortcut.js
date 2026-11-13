// Ctrl+Shift+I, as Electron's before-input-event reports it. Settings > Advanced >
// Troubleshooting > Developer tools decides whether the main process acts on it.
export function isDevToolsShortcut(input) {
  return input.type === 'keyDown' && Boolean(input.control) && Boolean(input.shift) && !input.alt && !input.meta && String(input.key).toLowerCase() === 'i'
}
