const STROKE = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
}

// Same speaker pair as the global volume mute button in tabs/mixer/index.js.
export function VolumeIcon() {
  return (
    <svg {...STROKE}>
      <polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none" />
      <path d="M16 8a5 5 0 0 1 0 8" />
    </svg>
  )
}

export function MuteIcon() {
  return (
    <svg {...STROKE}>
      <polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none" />
      <line x1="16" y1="9" x2="22" y2="15" />
      <line x1="22" y1="9" x2="16" y2="15" />
    </svg>
  )
}

export function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  )
}

export function LinkIcon() {
  return (
    <svg {...STROKE}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...STROKE}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
