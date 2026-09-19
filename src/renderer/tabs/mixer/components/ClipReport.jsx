import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

// The Clip report popover (Clip Diagnostics Design): what clipped, by how
// much, and a one-click fix. `report` comes from domain/clipReport.js;
// onFix applies report.fix and resolves to an undo function.
export function ClipReport({ report, onFix, onReset, onClose }) {
  const [undo, setUndo] = useState(null)
  const [busy, setBusy] = useState(false)

  async function fix() {
    setBusy(true)
    try {
      const undoFn = await onFix(report.fix)
      setUndo(() => undoFn)
    } finally {
      setBusy(false)
    }
  }

  async function undoFix() {
    setBusy(true)
    try {
      await undo()
      setUndo(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clip-report" role="dialog" aria-label="Clip report">
      <p className="clip-report-heading">{report.heading}</p>
      <p className="clip-report-detail">{report.detail}</p>
      {report.loudest.length > 0 && (
        <p className="clip-report-loudest">Loudest: {report.loudest.map((m) => m.label).join(', ')}</p>
      )}
      {undo ? (
        <p className="clip-report-done">Done. The light is reset, so you'll see if it clips again.</p>
      ) : (
        report.note && <p className="clip-report-note">{report.note}</p>
      )}
      <div className="clip-report-actions">
        {report.fix && !undo && (
          <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={fix}>
            {report.fix.label}
          </button>
        )}
        {undo && (
          <button type="button" className="btn btn-small" disabled={busy} onClick={undoFix}>
            Undo
          </button>
        )}
        {!undo && (
          <button type="button" className="btn btn-small" onClick={() => { onReset(); onClose() }}>
            Reset light
          </button>
        )}
        <button type="button" className="btn btn-small" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

function Popover({ anchorRect, children, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: anchorRect.left, top: anchorRect.bottom + 6 })

  // Keep it on screen: flip above the anchor or slide left when needed.
  useEffect(() => {
    const box = ref.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - box.width - 8))
    const below = anchorRect.bottom + 6
    const top = below + box.height > window.innerHeight - 8 ? Math.max(8, anchorRect.top - box.height - 6) : below
    setPos({ left, top })
  }, [anchorRect])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    window.addEventListener('keydown', onKey)
    // Next tick, so the click that opened it doesn't close it again.
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  return (
    <div ref={ref} className="clip-report-popover" style={{ left: pos.left, top: pos.top }}>
      {children}
    </div>
  )
}

let host = null
let root = null

// Opens (or replaces) the one Clip report popover next to `anchor`.
export function openClipReport(anchor, { report, onFix, onReset }) {
  if (!host) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  const close = () => root.render(null)
  root.render(
    <Popover key={Math.random()} anchorRect={anchor.getBoundingClientRect()} onClose={close}>
      <ClipReport report={report} onFix={onFix} onReset={onReset} onClose={close} />
    </Popover>
  )
}
