import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

// editToken: a new non-zero value opens the tag input (the right-click
// menu's Edit tags…).
export function SoundTags({ tags, allTags, editToken, onChange }) {
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    if (editToken) setAdding(true)
  }, [editToken])

  // Show every tag that fits whole; the rest fold into a "+N" chip (its title lists
  // them). Chips are always rendered so they can be measured; the ones that do not
  // fit are taken out of the layout (.tag-chip-hide), never squeezed to "n…".
  const rowRef = useRef(null)
  const [fit, setFit] = useState(tags.length)
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return undefined
    const measure = () => {
      const chips = [...row.querySelectorAll('.tag-chip-fixed')]
      const gap = 4
      const moreWidth = 36 + gap
      const reserved = (row.querySelector('.tag-input-wrapper')?.offsetWidth ?? 0) + gap
      let used = reserved
      let count = 0
      for (const chip of chips) {
        const rest = chips.length - count - 1
        if (used + chip.offsetWidth + gap + (rest > 0 ? moreWidth : 0) > row.clientWidth) break
        used += chip.offsetWidth + gap
        count++
      }
      setFit(count)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [tags, adding])
  const hidden = tags.slice(fit)

  return (
    <div className="sound-row-tags" ref={rowRef}>
      {tags.map((tag, i) => (
        <span key={tag} className={'tag-chip tag-chip-fixed' + (i >= fit ? ' tag-chip-hide' : '')}>
          <span className="tag-chip-name">{tag}</span>
          <button
            type="button"
            className="tag-chip-remove"
            title={`Remove tag "${tag}"`}
            onClick={(evt) => {
              evt.stopPropagation()
              onChange(tags.filter((t) => t !== tag))
            }}
          >
            <svg width="8" height="8" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z" /></svg>
          </button>
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="tag-chip tag-chip-more" title={hidden.join(', ')}>
          +{hidden.length}
        </span>
      )}
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
