import { BookmarkIcon } from '../../components/icons.jsx'
import { presetIndicator } from '../domain/toolbar.js'

// Which preset the Mixer / Remix tab is editing. Doubles as a shortcut into
// the Presets modal - "which preset am I on → tap → load a different one".
export function PresetIndicator({ presetName, onOpen }) {
  const { hasPreset, label, title } = presetIndicator(presetName)
  return (
    <span className={'active-preset-indicator' + (hasPreset ? ' has-preset' : '')} title={title} onClick={onOpen}>
      <BookmarkIcon size={13} className="active-preset-icon" />
      <span className="active-preset-name">{label}</span>
    </span>
  )
}
