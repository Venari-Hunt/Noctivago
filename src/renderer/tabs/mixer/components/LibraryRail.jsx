import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MockIcon } from '../../../components/mockIcons.jsx'
import { PLAY_TYPES } from './VolumeKnob.jsx'
import { pendingRow } from '../domain/pendingAdd.js'

// The library rail's list (mock mock-noctivago-mixer-studio). Clicking a row
// selects it (owner, 2026-11-16): the preview loads it, nothing else changes.
// The + / check button at the row's end puts it in or takes it out of the mix;
// it lights up on the selected row. The chips, search and Add sound around it
// are plain DOM in the Mixer's mount().
// A sound still being added from a link (micro-interactions mock, row "Add a sound"): a ring fills
// with the download, then the real row arrives; a failure stays here with Retry and Remove.
function PendingRow({ job, onRetry, onRemove }) {
  const view = pendingRow(job)
  return (
    <div className={'mx-item mx-pending arrive ' + view.tone} role="status" aria-live="polite" title={job.state === 'fail' ? job.reason : job.request?.url}>
      <span className="mx-thumb">
        {view.tone === 'fail' ? (
          <span className="morph-bad"><MockIcon name="x" /></span>
        ) : view.tone === 'done' ? (
          <svg className="pill-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" /></svg>
        ) : view.ring == null ? (
          <i className="pill-spin" />
        ) : (
          <svg className="mx-ring" viewBox="0 0 40 40" aria-hidden="true">
            <circle className="t" cx="20" cy="20" r="16" pathLength="100" />
            <circle className="v" cx="20" cy="20" r="16" pathLength="100" style={{ strokeDashoffset: 100 - view.ring }} />
          </svg>
        )}
      </span>
      <span className="mx-txt">
        <b>{job.name}</b>
        <small>{view.meta}</small>
      </span>
      {job.state === 'fail' ? (
        <span className="mx-pending-acts">
          <button type="button" className="btn btn-small" onClick={onRetry}>Retry</button>
          <button type="button" className="btn btn-small btn-ghost" onClick={onRemove}>Remove</button>
        </span>
      ) : job.state === 'working' ? (
        <button type="button" className="mx-sw" aria-label={`Stop adding ${job.name}`} title="Stop this download" onClick={onRemove}>
          <MockIcon name="x" />
        </button>
      ) : null}
    </div>
  )
}

function RailRow({ row, selected, arrived, onToggle, onToggleGroup, onPickTag, onSelect }) {
  if (row.kind === 'heading') return <h4 className="mx-list-h">{row.name}<span>{row.count}</span></h4>
  if (row.kind === 'tag') {
    return (
      <button type="button" className="mx-item" data-id={row.id} title="Show only the sounds with this tag" onClick={() => onPickTag(row.id)}>
        <span className="mx-thumb"><MockIcon name="tag" /></span>
        <span className="mx-txt">
          <b>{row.name}</b>
          <small>{row.meta}</small>
        </span>
        <span className="mx-sw" aria-hidden="true"><MockIcon name="chevron-right" /></span>
      </button>
    )
  }
  const isGroup = row.kind === 'group'
  const Icon = isGroup ? null : PLAY_TYPES[row.playType].Icon
  const swLabel = (row.in ? 'Take ' : 'Add ') + row.name + (row.in ? ' out of the mix' : ' to the mix')
  return (
    <div className={'mx-item' + (row.in ? ' in' : '') + (selected ? ' sel' : '') + (row.missing ? ' missing' : '') + (arrived ? ' arrive' : '')} data-id={row.id}>
      <button
        type="button"
        className="mx-pick"
        aria-pressed={selected}
        disabled={row.missing}
        title={row.missing ? 'File missing: relink it from its card' : undefined}
        onClick={() => onSelect(row)}
      >
        <span className="mx-thumb">{isGroup ? <MockIcon name="layers" /> : <Icon size={16} />}</span>
        <span className="mx-txt">
          <b>{row.name}</b>
          <small>{row.meta}</small>
        </span>
      </button>
      <button
        type="button"
        className="mx-sw"
        aria-pressed={row.in}
        aria-label={swLabel}
        title={row.in ? 'In the mix: take out' : 'Add to the mix'}
        disabled={row.missing}
        onClick={() => (isGroup ? onToggleGroup(row) : onToggle(row.id))}
      >
        <MockIcon name={row.in ? 'check' : 'plus'} />
      </button>
    </div>
  )
}

function RailList({ rows, emptyText, selectedKey, pending, onRetry, onRemove, onToggle, onToggleGroup, onPickTag, onSelect }) {
  // Sound rows that were not here on the last render arrive with a short fade and scale (any way a
  // sound is added: link, file, recording). Nothing animates on the first render.
  const seen = useRef(null)
  const ids = rows.filter((r) => r.kind === 'sound').map((r) => r.id)
  const fresh = seen.current ? new Set(ids.filter((id) => !seen.current.has(id))) : new Set()
  useEffect(() => {
    seen.current = new Set([...(seen.current ?? []), ...ids])
  })
  const ghost = pending ? <PendingRow key="pending" job={pending} onRetry={onRetry} onRemove={onRemove} /> : null
  if (!rows.length) return ghost ?? <p className="mx-list-empty">{emptyText}</p>
  return [ghost, ...rows.map((row, i) => <RailRow key={row.kind === 'heading' ? 'h' + i : row.kind + row.id + (i > 0 && rows.slice(0, i).some((r) => r.kind === row.kind && r.id === row.id) ? '#' + i : '')} row={row} selected={selectedKey === row.kind + ':' + row.id} arrived={row.kind === 'sound' && fresh.has(row.id)} onToggle={onToggle} onToggleGroup={onToggleGroup} onPickTag={onPickTag} onSelect={onSelect} />)]
}

const roots = new WeakMap()

export function renderRailList(el, rows, { emptyText, selectedKey, pending = null, onRetry, onRemove, onToggle, onToggleGroup, onPickTag, onSelect }) {
  let root = roots.get(el)
  if (!root) {
    root = createRoot(el)
    roots.set(el, root)
  }
  flushSync(() => root.render(<RailList rows={rows} emptyText={emptyText} selectedKey={selectedKey} pending={pending} onRetry={onRetry} onRemove={onRemove} onToggle={onToggle} onToggleGroup={onToggleGroup} onPickTag={onPickTag} onSelect={onSelect} />))
}
