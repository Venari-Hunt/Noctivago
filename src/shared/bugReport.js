// The text Settings > Advanced > Troubleshooting hands out: versions plus the
// tail of main.log. DOM- and Electron-free so it can be tested.

export const LOG_TAIL_LINES = 200
// A GitHub new-issue link carries the body in the URL; browsers and GitHub cut
// it near 8 KB, so the link gets only the last stretch of the log.
export const ISSUE_LOG_CHARS = 3000

export function tailLines(text, count = LOG_TAIL_LINES) {
  const lines = String(text ?? '').split(/\r?\n/)
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-count).join('\n')
}

export function versionLines(appVersion, plugins = []) {
  const rows = plugins.map((p) => `- ${p.name ?? p.id} ${p.version ?? '?'}`)
  return [`Noctívago ${appVersion}`, ...(rows.length ? ['Plugins:', ...rows] : [])].join('\n')
}

export function buildReport({ appVersion, plugins, log }) {
  const tail = tailLines(log)
  return `${versionLines(appVersion, plugins)}\n\nmain.log (last ${LOG_TAIL_LINES} lines):\n${tail || '(empty)'}`
}

export function issueUrl(repoUrl, { appVersion, plugins, log }) {
  let tail = tailLines(log)
  if (tail.length > ISSUE_LOG_CHARS) tail = '…' + tail.slice(-ISSUE_LOG_CHARS)
  const fence = '```'
  const body = `What happened:\n\n\nVersions:\n${versionLines(appVersion, plugins)}\n\nLog tail:\n${fence}\n${tail || '(empty)'}\n${fence}\n`
  return `${repoUrl}/issues/new?body=${encodeURIComponent(body)}`
}
