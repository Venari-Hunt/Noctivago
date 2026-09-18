// ipcRenderer.invoke wraps main-process errors as "Error invoking remote
// method '...': Error: <msg>" - only <msg> is worth showing.
export function errorText(err) {
  return String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
