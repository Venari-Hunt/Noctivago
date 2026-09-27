import { Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { buildSoundListSections } from '../domain/soundList.js'
import { SoundRow } from './SoundRow.jsx'

function SoundList({ sections, draggable, callbacks, allTags, editRequest }) {
  return sections.map((section) => (
    <Fragment key={section.label ?? ''}>
      {section.label != null && <li className="sound-group-header">{section.label}</li>}
      {section.rows.map((row) => (
        <SoundRow
          key={row.key}
          entry={row.entry}
          state={row.state}
          draggable={draggable}
          callbacks={callbacks}
          allTags={allTags}
          editRequest={editRequest?.id === row.entry.id ? editRequest : null}
        />
      ))}
    </Fragment>
  ))
}

const roots = new WeakMap()

// allTags is every tag in the *full* library (entries may already be
// filtered), for the "+ tag" autocomplete. editRequest ({ id, field, token })
// opens one row's rename or tag editor (the right-click menu). Rendered
// synchronously so the Mixer can keep treating this as a plain DOM update.
export function renderSoundList(listEl, emptyStateEl, entries, playbackState, viewState, callbacks, allTags = [], editRequest = null) {
  let root = roots.get(listEl)
  if (!root) {
    root = createRoot(listEl)
    roots.set(listEl, root)
  }

  const empty = entries.length === 0
  emptyStateEl.classList.toggle('hidden', !empty)
  listEl.classList.toggle('hidden', empty)
  const { sections, draggable } = empty ? { sections: [], draggable: false } : buildSoundListSections(entries, playbackState, viewState)
  flushSync(() => root.render(<SoundList sections={sections} draggable={draggable} callbacks={callbacks} allTags={allTags} editRequest={editRequest} />))
}
