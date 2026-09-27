import { useState } from 'react'
import { formatMeta, groupBadgeColors } from '../domain/soundRow.js'
import { SoundName } from './SoundName.jsx'
import { SoundTags } from './SoundTags.jsx'
import { MissingControls, SoundControls } from './SoundControls.jsx'
import { PlayIcon, TrashIcon } from '../../../components/icons.jsx'

// Composite and Freesound sounds play like any other; the badge says where
// they came from, and for Freesound keeps the license attribution visible.
function SourceBadges({ entry }) {
  return (
    <>
      {entry.compositeSource && (
        <span
          className="sound-row-composite-badge"
          title={`Baked from ${entry.compositeSource.members.length} sounds - open the Composite tab to edit`}
        >
          Composite
        </span>
      )}
      {entry.source?.type === 'freesound' && (
        <span
          className="sound-row-composite-badge"
          title={`From Freesound.org, by ${entry.source.username || 'unknown'}${entry.source.license ? ` (${entry.source.license})` : ''}`}
        >
          Freesound
        </span>
      )}
    </>
  )
}

// Clicking opens the same menu as right-clicking the row. ui/levelMeters.js
// lights it red when the group's bus clips and caches its title; keying on
// the name remounts it on rename so that cache can't go stale.
function GroupBadge({ name, id, colorSlot, onOpenMenu }) {
  return (
    <button
      type="button"
      className="sound-row-group-badge"
      title={`In the "${name}" sound group - click to change`}
      style={id ? groupBadgeColors(id, colorSlot) : undefined}
      data-meter-group={id ?? undefined}
      onClick={(evt) => {
        evt.stopPropagation()
        onOpenMenu(evt)
      }}
    >
      {name}
    </button>
  )
}

// Pinned top-right so they sit in the same spot on every card.
function RowActions({ entry, callbacks }) {
  // Scatter and scheduled sounds only: fire one shot now to test the
  // settings, whether or not the sound is in the mix.
  const canTestFire = entry.status !== 'missing' && (entry.playMode === 'scatter' || entry.playMode === 'scheduled')
  return (
    <div className="sound-row-actions">
      {canTestFire && (
        <button
          type="button"
          className="btn btn-small btn-svg-icon"
          title="Play one shot now (test this configuration)"
          onClick={() => callbacks.onTestFire(entry.id)}
        >
          <PlayIcon />
        </button>
      )}
      <button
        type="button"
        className="btn btn-small btn-svg-icon sound-row-remove"
        title="Remove from library"
        onClick={() => callbacks.onRemove(entry.id)}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

function useRowDrag(entry, draggable, callbacks) {
  const [dragging, setDragging] = useState(false)
  if (!draggable) return { props: {}, dragging: false }
  return {
    dragging,
    props: {
      draggable: true,
      onDragStart: (evt) => {
        evt.dataTransfer.setData('text/plain', entry.id)
        evt.dataTransfer.effectAllowed = 'move'
        setDragging(true)
      },
      onDragEnd: () => setDragging(false),
      onDragOver: (evt) => {
        evt.preventDefault()
        evt.dataTransfer.dropEffect = 'move'
      },
      onDrop: (evt) => {
        evt.preventDefault()
        const draggedId = evt.dataTransfer.getData('text/plain')
        if (draggedId && draggedId !== entry.id) callbacks.onReorderDrop(draggedId, entry.id)
      }
    }
  }
}

// One card: name line, meta + tags, controls (see main.css's three-line
// .sound-row layout).
export function SoundRow({ entry, state, draggable, callbacks, allTags }) {
  const missing = entry.status === 'missing'
  const drag = useRowDrag(entry, draggable, callbacks)
  const className = [
    'sound-row',
    missing && 'sound-row-missing',
    state.selectMode && 'sound-row-selectable',
    state.selected && 'sound-row-selected',
    draggable && 'sound-row-draggable',
    drag.dragging && 'dragging'
  ]
    .filter(Boolean)
    .join(' ')
  const openMenu = (evt) => callbacks.onContextMenu(entry.id, evt)

  return (
    <li
      className={className}
      data-id={entry.id}
      onContextMenu={(evt) => {
        evt.preventDefault()
        openMenu(evt)
      }}
      {...drag.props}
    >
      {state.selectMode && (
        <label className="sound-row-select">
          <input type="checkbox" checked={state.selected} onChange={() => callbacks.onToggleSelect(entry.id)} />
        </label>
      )}
      <div className="sound-row-name-row">
        <SoundName name={entry.name} onRename={(name) => callbacks.onRename(entry.id, name)} />
        <SourceBadges entry={entry} />
        {state.groupName && (
          <GroupBadge key={state.groupName} name={state.groupName} id={state.groupId} colorSlot={state.groupColorSlot} onOpenMenu={openMenu} />
        )}
        <RowActions entry={entry} callbacks={callbacks} />
      </div>
      <div className="sound-row-info">
        <span className="sound-row-meta">{formatMeta(entry)}</span>
        {state.error && <span className="sound-row-error">{state.error}</span>}
        <SoundTags tags={entry.tags ?? []} allTags={allTags} onChange={(tags) => callbacks.onTagsChange(entry.id, tags)} />
      </div>
      {missing ? (
        <MissingControls onRelink={() => callbacks.onRelink(entry.id)} />
      ) : (
        <SoundControls id={entry.id} state={state} callbacks={callbacks} />
      )}
    </li>
  )
}
