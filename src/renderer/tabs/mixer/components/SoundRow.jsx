import { useState } from 'react'
import { formatMeta, groupBadgeColors } from '../domain/soundRow.js'
import { SoundName } from './SoundName.jsx'
import { SoundTags } from './SoundTags.jsx'
import { KnobLine, MissingControls, MixFoot } from './SoundControls.jsx'
import { PLAY_TYPES, playTypeOf } from './VolumeKnob.jsx'
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

// Corner buttons, shown on hover or focus: test shot top-left, remove top-right.
function RowCorners({ entry, callbacks }) {
  // Scatter and scheduled sounds only: fire one shot now to test the
  // settings, whether or not the sound is in the mix.
  const canTestFire = entry.status !== 'missing' && (entry.playMode === 'scatter' || entry.playMode === 'scheduled')
  return (
    <>
      <div className="sound-row-corner sound-row-corner-l">
        {canTestFire && (
          <button
            type="button"
            className="btn btn-small btn-svg-icon"
            title="Play one shot now (test this configuration)"
            aria-label="Play one shot now"
            onClick={() => callbacks.onTestFire(entry.id)}
          >
            <PlayIcon />
          </button>
        )}
      </div>
      <div className="sound-row-corner sound-row-corner-r">
        <button
          type="button"
          className="btn btn-small btn-svg-icon sound-row-remove"
          title="Remove from library"
          aria-label="Remove from library"
          onClick={() => callbacks.onRemove(entry.id)}
        >
          <TrashIcon />
        </button>
      </div>
    </>
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

// One knob card, one centered column: corner buttons, mute / knob / solo,
// name, play type, length and size, badges and tags, In Mix and the level
// meter (see main.css's .sound-row).
export function SoundRow({ entry, state, draggable, callbacks, allTags, editRequest }) {
  const missing = entry.status === 'missing'
  const drag = useRowDrag(entry, draggable, callbacks)
  const className = [
    'sound-row',
    state.included && 'sound-row-on',
    state.muted && 'sound-row-muted',
    missing && 'sound-row-missing',
    state.selectMode && 'sound-row-selectable',
    state.selected && 'sound-row-selected',
    draggable && 'sound-row-draggable',
    drag.dragging && 'dragging'
  ]
    .filter(Boolean)
    .join(' ')
  const openMenu = (evt) => callbacks.onContextMenu(entry.id, evt)
  const playType = PLAY_TYPES[playTypeOf(entry)]

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
      <RowCorners entry={entry} callbacks={callbacks} />
      {!missing && <KnobLine entry={entry} state={state} callbacks={callbacks} />}
      <div className="sound-row-name-row">
        <SoundName
          name={entry.name}
          editToken={editRequest?.field === 'name' ? editRequest.token : 0}
          onRename={(name) => callbacks.onRename(entry.id, name)}
        />
      </div>
      {!missing && (
        <div className="sound-row-mode">
          <playType.Icon size={12} />
          <span>{playType.label}</span>
        </div>
      )}
      <div className="sound-row-meta-line">
        <span className="sound-row-meta">{formatMeta(entry)}</span>
        {state.error && <span className="sound-row-error">{state.error}</span>}
      </div>
      <div className="sound-row-info">
        <SourceBadges entry={entry} />
        {state.groupName && (
          <GroupBadge key={state.groupName} name={state.groupName} id={state.groupId} colorSlot={state.groupColorSlot} onOpenMenu={openMenu} />
        )}
        <SoundTags
          tags={entry.tags ?? []}
          allTags={allTags}
          editToken={editRequest?.field === 'tags' ? editRequest.token : 0}
          onChange={(tags) => callbacks.onTagsChange(entry.id, tags)}
        />
      </div>
      {missing ? (
        <MissingControls onRelink={() => callbacks.onRelink(entry.id)} />
      ) : (
        <MixFoot id={entry.id} state={state} callbacks={callbacks} />
      )}
    </li>
  )
}
