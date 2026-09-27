import { useRef, useState } from 'react'
import { marqueeDurationSeconds } from '../domain/soundRow.js'

// .sound-row-name is nowrap + ellipsis (main.css), so scrollWidth past
// clientWidth is exactly "this name is truncated".
function startMarquee(evt) {
  const el = evt.currentTarget
  const overflow = el.scrollWidth - el.clientWidth
  if (overflow <= 0) return
  el.style.setProperty('--marquee-distance', `-${overflow}px`)
  el.style.setProperty('--marquee-duration', `${marqueeDurationSeconds(overflow)}s`)
  el.classList.add('sound-row-name-marquee')
}

function stopMarquee(evt) {
  evt.currentTarget.classList.remove('sound-row-name-marquee')
}

function RenameInput({ name, onDone }) {
  // Escape unmounts the input, and Chromium can fire blur on the way out;
  // without this the cancelled name would be committed anyway.
  const settled = useRef(false)
  function finish(value) {
    if (settled.current) return
    settled.current = true
    onDone(value)
  }
  function commit(evt) {
    const value = evt.currentTarget.value.trim()
    finish(value && value !== name ? value : null)
  }

  return (
    <input
      type="text"
      className="sound-row-name-input"
      defaultValue={name}
      autoFocus
      onFocus={(evt) => evt.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(evt) => {
        if (evt.key === 'Enter') evt.currentTarget.blur()
        else if (evt.key === 'Escape') finish(null)
      }}
    />
  )
}

export function SoundName({ name, onRename }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <RenameInput
        name={name}
        onDone={(newName) => {
          setEditing(false)
          if (newName) onRename(newName)
        }}
      />
    )
  }

  return (
    <span
      className="sound-row-name"
      title="Double-click to rename"
      onDoubleClick={() => setEditing(true)}
      onMouseEnter={startMarquee}
      onMouseLeave={stopMarquee}
    >
      {name}
    </span>
  )
}
