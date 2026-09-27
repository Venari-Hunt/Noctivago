import { BookmarkIcon } from '../../components/icons.jsx'
import { AddSoundMenu } from './AddSoundMenu.jsx'
import { PresetIndicator } from './PresetIndicator.jsx'
import { Transport } from './Transport.jsx'

// Three zones - preset on the left, transport in the middle, app actions on
// the right (layout in main.css, .toolbar).
export function Toolbar({ state, handlers }) {
  return (
    <>
      <div className="toolbar-group toolbar-preset">
        {state.isDev && (
          <span className="dev-badge" title="This is a development build - separate data from any installed copy">
            DEV
          </span>
        )}
        <PresetIndicator presetName={state.presetName} onOpen={handlers.onOpenPresets} />
      </div>
      <Transport state={state} handlers={handlers} />
      <div className="toolbar-group toolbar-actions">
        <button className="btn btn-icon-text" type="button" onClick={handlers.onOpenPresets}>
          <BookmarkIcon />
          Presets
        </button>
        <button className="btn btn-icon" type="button" title="Settings" onClick={handlers.onOpenSettings}>
          ⚙
        </button>
        <AddSoundMenu onPick={handlers.onAddSound} />
      </div>
    </>
  )
}
