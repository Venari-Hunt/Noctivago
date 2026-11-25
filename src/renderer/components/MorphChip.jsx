import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MockIcon } from './mockIcons.jsx'
import { MORPH_TIMING } from '../ui/domain/morphStates.js'

// React twin of ui/morphButton.js (approved mock mock-noctivago-micro.html): a small status
// control that morphs in place. Same CSS (.btn.morph, .morph-row), same timing.
//   working: spinner + words · done: drawn check · fail: soft red x + reason · canceled: undo arrow
const STATE_CLASS = { working: 'busy', done: 'done', fail: 'fail', canceled: 'undone' }

function Row({ state, text }) {
  if (state === 'working')
    return (
      <>
        <i className="pill-spin" />
        {text}
      </>
    )
  if (state === 'done')
    return (
      <>
        <svg className="pill-check" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
        {text}
      </>
    )
  if (state === 'fail')
    return (
      <>
        <span className="morph-bad">
          <MockIcon name="x" size={16} />
        </span>
        {text}
      </>
    )
  return (
    <>
      <MockIcon name="undo-2" size={16} />
      {text}
    </>
  )
}

export function MorphChip({ state, text, small = true }) {
  const rowRef = useRef(null)
  const [width, setWidth] = useState(null)
  const [shown, setShown] = useState(false)
  useLayoutEffect(() => {
    if (rowRef.current) setWidth(Math.ceil(rowRef.current.offsetWidth))
    setShown(false)
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [state, text])
  return (
    <span
      className={`btn${small ? ' btn-small' : ''} morph ${STATE_CLASS[state] || ''}`}
      role="status"
      aria-live="polite"
      aria-busy={state === 'working'}
      style={width ? { width } : undefined}
    >
      <span ref={rowRef} key={state + text} className={'morph-row' + (shown ? '' : ' in')}>
        <Row state={state} text={text} />
      </span>
    </span>
  )
}

// Per-item operations with the micro-interaction timing: the spinner only after 400 ms, done held
// 1.4 s, a failure 4.2 s. ops[id] is null (show the normal controls), 'pending' (first 400 ms: keep
// the controls, but disabled) or { state, text } (show a MorphChip).
export function useMorphOps() {
  const [ops, setOps] = useState({})
  const timers = useRef({})
  const set = (id, v) => setOps((o) => ({ ...o, [id]: v }))
  const clear = (id) => {
    for (const t of timers.current[id] || []) clearTimeout(t)
    timers.current[id] = []
  }
  const later = (id, fn, ms) => (timers.current[id] = [...(timers.current[id] || []), setTimeout(fn, ms)])
  useEffect(() => () => Object.keys(timers.current).forEach(clear), [])

  // run(id, { working, done, fail }, action): fail may be a function of the error.
  const run = useCallback(async (id, words, action) => {
    clear(id)
    set(id, 'pending')
    later(id, () => set(id, { state: 'working', text: words.working }), MORPH_TIMING.workingDelay)
    try {
      const out = await action()
      clear(id)
      set(id, { state: 'done', text: words.done })
      later(id, () => set(id, null), MORPH_TIMING.doneHold)
      return { ok: true, out }
    } catch (err) {
      clear(id)
      const text = typeof words.fail === 'function' ? words.fail(err) : words.fail
      set(id, { state: 'fail', text })
      later(id, () => set(id, null), MORPH_TIMING.failHold)
      return { ok: false, err }
    }
  }, [])
  return [ops, run]
}
