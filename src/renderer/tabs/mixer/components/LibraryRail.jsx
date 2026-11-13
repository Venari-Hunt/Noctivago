import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { MockIcon } from '../../../components/mockIcons.jsx'
import { PLAY_TYPES } from './VolumeKnob.jsx'

// The library rail's list: a row is the in-mix switch (mock
// mock-noctivago-mixer-studio). The chips, search and Add sound around it are
// plain DOM in the Mixer's mount().
function RailRow({ row, onToggle, onToggleGroup, onPeek }) {
  const isGroup = row.kind === 'group'
  const Icon = isGroup ? null : PLAY_TYPES[row.playType].Icon
  const title = row.missing ? 'File missing: relink it from its card' : row.in ? 'In the mix: click to take out' : 'Click to add to the mix'
  return (
    <button
      type="button"
      className={'mx-item' + (row.in ? ' in' : '') + (row.missing ? ' missing' : '')}
      data-id={row.id}
      aria-pressed={row.in}
      disabled={row.missing}
      title={title}
      onClick={() => (isGroup ? onToggleGroup(row) : onToggle(row.id))}
      onMouseEnter={() => onPeek?.(row)}
      onFocus={() => onPeek?.(row)}
    >
      <span className="mx-thumb">{isGroup ? <MockIcon name="layers" /> : <Icon size={16} />}</span>
      <span className="mx-txt">
        <b>{row.name}</b>
        <small>{row.meta}</small>
      </span>
      <span className="mx-sw" aria-hidden="true"><MockIcon name={row.in ? 'check' : 'plus'} /></span>
    </button>
  )
}

function RailList({ rows, emptyText, onToggle, onToggleGroup, onPeek }) {
  if (!rows.length) return <p className="mx-list-empty">{emptyText}</p>
  return rows.map((row) => <RailRow key={row.kind + row.id} row={row} onToggle={onToggle} onToggleGroup={onToggleGroup} onPeek={onPeek} />)
}

const roots = new WeakMap()

export function renderRailList(el, rows, { emptyText, onToggle, onToggleGroup, onPeek }) {
  let root = roots.get(el)
  if (!root) {
    root = createRoot(el)
    roots.set(el, root)
  }
  flushSync(() => root.render(<RailList rows={rows} emptyText={emptyText} onToggle={onToggle} onToggleGroup={onToggleGroup} onPeek={onPeek} />))
}
