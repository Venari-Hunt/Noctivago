import { presetIndicator } from '../domain/toolbar.js'

// Which preset the Mixer / Remix tab is editing. Doubles as a shortcut into
// the Presets modal - "which preset am I on → tap → load a different one".
export function PresetIndicator({ presetName, mixCount, onOpen }) {
  const { hasPreset, label, sub, title } = presetIndicator(presetName, mixCount)
  return (
    <button className={'active-preset-indicator' + (hasPreset ? ' has-preset' : '')} type="button" title={title} onClick={onOpen}>
      <span className="active-preset-name">{label}</span>
      <span className="active-preset-sub">{sub}</span>
    </button>
  )
}
