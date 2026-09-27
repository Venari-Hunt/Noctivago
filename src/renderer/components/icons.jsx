// Shared icon set (the Mixer's sound cards and the top bar). `size` defaults
// to the sound cards' 14px; the top bar's transport buttons use 16.
const stroke = (size, strokeWidth = 2) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
})

const solid = (size) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor' })

// Speaker (unmuted) / speaker-with-X (muted) - the same pair everywhere a
// volume slider exists, including the Remix plugin's preview volume.
export function VolumeIcon({ size = 14 }) {
  return (
    <svg {...stroke(size)}>
      <polygon points="3 9 3 15 8 15 13 20 13 4 8 9 3 9" fill="currentColor" stroke="none" />
      <path d="M16 8a5 5 0 0 1 0 8" />
    </svg>
  )
}

export function MuteIcon({ size = 14 }) {
  return (
    <svg {...stroke(size)}>
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

// The top bar's Play all / Pause all pair, mirrored by Remix's own sticky
// Play/Pause button.
export function PlayAllIcon() {
  return (
    <svg {...solid(16)}>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

export function PauseAllIcon() {
  return (
    <svg {...solid(16)}>
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  )
}

export function MoonIcon() {
  return (
    <svg {...stroke(16)}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

export function BookmarkIcon({ size = 14, className }) {
  return (
    <svg {...solid(size)} className={className}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function LinkIcon() {
  return (
    <svg {...stroke(14)}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg {...stroke(14)}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
