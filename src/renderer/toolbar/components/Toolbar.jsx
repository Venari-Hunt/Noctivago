import { PresetIndicator } from './PresetIndicator.jsx'
import { Transport } from './Transport.jsx'

// The player bar (layout in main.css, .toolbar): preset on the left, Play in
// the middle, sleep / mute / master volume on the right.
export function Toolbar({ state, handlers }) {
  return (
    <>
      <div className="toolbar-group toolbar-preset">
        {state.isDev && (
          <span className="dev-badge" title="This is a development build - separate data from any installed copy">
            DEV
          </span>
        )}
        <PresetIndicator presetName={state.presetName} mixCount={state.mixCount} onOpen={handlers.onOpenPresets} />
      </div>
      <Transport state={state} handlers={handlers} />
    </>
  )
}
