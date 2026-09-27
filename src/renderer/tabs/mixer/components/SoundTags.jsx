import { useRef, useState } from 'react'
import { applyTagSuggestion, matchingTags, mergeTypedTags } from '../domain/soundRow.js'

// Comma-separated, with Obsidian-style autocomplete from every tag already
// in the library (allTags).
function TagInput({ tags, allTags, onDone }) {
  const [value, setValue] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const inputRef = useRef(null)
  const settled = useRef(false)
  const matches = matchingTags(value, allTags, tags)
  const highlighted = Math.min(highlight, matches.length - 1)

  function finish(newTags) {
    if (settled.current) return
    settled.current = true
    onDone(newTags)
  }

  function pick(tag) {
    setValue(applyTagSuggestion(value, tag))
    setHighlight(-1)
    inputRef.current.focus()
  }

  function onKeyDown(evt) {
    if (evt.key === 'ArrowDown' && matches.length > 0) {
      evt.preventDefault()
      setHighlight((highlighted + 1) % matches.length)
    } else if (evt.key === 'ArrowUp' && matches.length > 0) {
      evt.preventDefault()
      setHighlight((highlighted - 1 + matches.length) % matches.length)
    } else if (evt.key === 'Enter') {
      // A highlighted suggestion completes just that segment, so a comma can
      // start the next tag; Enter with nothing highlighted commits.
      if (highlighted >= 0) {
        evt.preventDefault()
        pick(matches[highlighted])
      } else {
        evt.currentTarget.blur()
      }
    } else if (evt.key === 'Escape') {
      finish(null)
    }
  }

  return (
    <div className="tag-input-wrapper">
      <input
        ref={inputRef}
        type="text"
        className="tag-input"
        placeholder="tag, tag…"
        autoFocus
        value={value}
        onChange={(evt) => {
          setValue(evt.target.value)
          setHighlight(-1)
        }}
        onBlur={() => finish(mergeTypedTags(value, tags, allTags))}
        onKeyDown={onKeyDown}
      />
      <ul className={'tag-autocomplete-options' + (matches.length === 0 ? ' hidden' : '')}>
        {matches.map((tag, i) => (
          <li
            key={tag}
            className={'tag-autocomplete-option' + (i === highlighted ? ' tag-autocomplete-option-highlighted' : '')}
            // mousedown, not click: it fires before the input's blur, so
            // picking a suggestion doesn't first commit what's typed.
            onMouseDown={(evt) => {
              evt.preventDefault()
              pick(tag)
            }}
          >
            {tag}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SoundTags({ tags, allTags, onChange }) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="sound-row-tags">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            type="button"
            className="tag-chip-remove"
            title={`Remove tag "${tag}"`}
            onClick={(evt) => {
              evt.stopPropagation()
              onChange(tags.filter((t) => t !== tag))
            }}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <TagInput
          tags={tags}
          allTags={allTags}
          onDone={(newTags) => {
            setAdding(false)
            if (newTags) onChange(newTags)
          }}
        />
      ) : (
        <button type="button" className="tag-chip tag-chip-add" onClick={() => setAdding(true)}>
          + tag
        </button>
      )}
    </div>
  )
}
