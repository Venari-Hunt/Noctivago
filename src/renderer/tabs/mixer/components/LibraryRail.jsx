import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MockIcon } from '../../../components/mockIcons.jsx'
import { PLAY_TYPES } from './VolumeKnob.jsx'

// The library rail's list (mock mock-noctivago-mixer-studio). Clicking a row
// selects it (owner, 2026-11-16): the preview loads it, nothing else changes.
// The + / check button at the row's end puts it in or takes it out of the mix;
// it lights up on the selected row. The chips, search and Add sound around it
// are plain DOM in the Mixer's mount().
function RailRow({ row, selected, onToggle, onToggleGroup, onPickTag, onSelect }) {
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
    <div className={'mx-item' + (row.in ? ' in' : '') + (selected ? ' sel' : '') + (row.missing ? ' missing' : '')} data-id={row.id}>
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

function RailList({ rows, emptyText, selectedKey, onToggle, onToggleGroup, onPickTag, onSelect }) {
  if (!rows.length) return <p className="mx-list-empty">{emptyText}</p>
  return rows.map((row, i) => <RailRow key={row.kind === 'heading' ? 'h' + i : row.kind + row.id + (i > 0 && rows.slice(0, i).some((r) => r.kind === row.kind && r.id === row.id) ? '#' + i : '')} row={row} selected={selectedKey === row.kind + ':' + row.id} onToggle={onToggle} onToggleGroup={onToggleGroup} onPickTag={onPickTag} onSelect={onSelect} />)
}

const roots = new WeakMap()

export function renderRailList(el, rows, { emptyText, selectedKey, onToggle, onToggleGroup, onPickTag, onSelect }) {
  let root = roots.get(el)
  if (!root) {
    root = createRoot(el)
    roots.set(el, root)
  }
  flushSync(() => root.render(<RailList rows={rows} emptyText={emptyText} selectedKey={selectedKey} onToggle={onToggle} onToggleGroup={onToggleGroup} onPickTag={onPickTag} onSelect={onSelect} />))
}
