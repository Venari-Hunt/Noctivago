import { useEffect, useRef, useState } from 'react'
import { ADD_SOUND_ITEMS } from '../domain/toolbar.js'

// The "+" button's dropdown. Closes on an outside click, on Escape, and after
// picking an item.
export function AddSoundMenu({ onPick }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (evt) => {
      if (!wrapperRef.current.contains(evt.target)) setOpen(false)
    }
    const onKey = (evt) => {
      if (evt.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id) => {
    setOpen(false)
    onPick(id)
  }

  return (
    <div ref={wrapperRef} className="add-sound-menu-wrapper">
      <button className="btn btn-icon" type="button" title="Add sound" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        +
      </button>
      {open && (
        <div className="dropdown-menu">
          {ADD_SOUND_ITEMS.map((item) => (
            <button key={item.id} className="dropdown-item" type="button" onClick={() => pick(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
