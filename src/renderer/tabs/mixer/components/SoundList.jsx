import { Fragment } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { buildSoundListSections } from '../domain/soundList.js'
import { SoundRow } from './SoundRow.jsx'

// A group section's heading is the group's chip (mock-noctivago-mixer-studio "By group").
function SectionLabel({ section }) {
  return (
    <li className="sound-group-header">
      {section.groupId ? <span className="mx-sec-grp">{section.label}</span> : section.label}
      {section.count != null && <span>{section.count}</span>}
    </li>
  )
}

function SoundList({ sections, draggable, callbacks, allTags, editRequest }) {
  return sections.map((section) => (
    <Fragment key={section.groupId ?? section.label ?? ''}>
      {section.label != null && <SectionLabel section={section} />}
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

function rootFor(listEl) {
  let root = roots.get(listEl)
  if (!root) {
    root = createRoot(listEl)
    roots.set(listEl, root)
  }
  return root
}

// allTags is every tag in the *full* library (entries may already be
// filtered), for the "+ tag" autocomplete. editRequest ({ id, field, token })
// opens one row's rename or tag editor (the right-click menu). Rendered
// synchronously so the Mixer can keep treating this as a plain DOM update.
export function renderSoundList(listEl, emptyStateEl, entries, playbackState, viewState, callbacks, allTags = [], editRequest = null) {
  const empty = entries.length === 0
  const { sections, draggable } = empty ? { sections: [], draggable: false } : buildSoundListSections(entries, playbackState, viewState)
  renderSections(listEl, emptyStateEl, sections, draggable, callbacks, allTags, editRequest)
}

// The same list from ready-made sections (the Mixer studio center builds
// them with buildMixSections).
export function renderSections(listEl, emptyStateEl, sections, draggable, callbacks, allTags = [], editRequest = null) {
  const empty = sections.length === 0
  emptyStateEl.classList.toggle('hidden', !empty)
  listEl.classList.toggle('hidden', empty)
  flushSync(() => rootFor(listEl).render(<SoundList sections={sections} draggable={draggable} callbacks={callbacks} allTags={allTags} editRequest={editRequest} />))
}
