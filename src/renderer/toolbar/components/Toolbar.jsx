import { Transport } from './Transport.jsx'

// The bottom media bar (layout in main.css, .toolbar; the mock's .mbar): the
// mix's Play in the middle, sleep / mute / master volume on the right. The
// preset itself moved to the title-bar pill (presetPill.js).
export function Toolbar({ state, handlers }) {
  return (
    <>
      <span className="toolbar-group toolbar-start"></span>
      <Transport state={state} handlers={handlers} />
    </>
  )
}
