import fs from 'node:fs'
import { app, clipboard, shell } from 'electron'
import log from 'electron-log/main'
import { describePlugins } from './plugins/registry.js'
import { buildReport, issueUrl } from '../shared/bugReport.js'

const REPO_URL = 'https://github.com/Venari-Hunt/Noctivago'

function readLog() {
  try {
    return fs.readFileSync(log.transports.file.getFile().path, 'utf8')
  } catch {
    return ''
  }
}

function snapshot() {
  const plugins = describePlugins().map((p) => ({ id: p.id, name: p.manifest?.name, version: p.manifest?.version }))
  return { appVersion: app.getVersion(), plugins, log: readLog() }
}

// Settings > Advanced > Troubleshooting > Copy logs.
export function copyLogs() {
  clipboard.writeText(buildReport(snapshot()))
  return { ok: true }
}

// Report a bug: opens a GitHub issue prefilled with versions and the log tail.
export function reportBug() {
  shell.openExternal(issueUrl(REPO_URL, snapshot()))
  return { ok: true }
}
