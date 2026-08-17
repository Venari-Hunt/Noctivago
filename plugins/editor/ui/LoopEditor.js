import { drawWaveform } from '../audio/waveform.js'

const HANDLE_HIT_PX = 8
const SNAP_PX = 12
const MIN_LOOP_SECONDS = 0.05
// Floor on how far a scroll-zoom can shrink the visible window - without
// this, zooming keeps halving the span forever with no real detail left to
// show past the peaks array's own fixed resolution (see waveform.js).
const MIN_VIEW_SECONDS = 0.5
const ZOOM_IN_FACTOR = 0.8
const ZOOM_OUT_FACTOR = 1.25
// Dragging a handle/playhead within this many pixels of either canvas edge
// auto-scrolls the viewport toward that edge, continuously, for as long as
// the cursor stays there - not just on further mouse movement, since a
// stationary cursor sitting at the edge stops generating mousemove events.
const EDGE_SCROLL_ZONE_PX = 24
// Fraction of the current visible span to scroll per animation frame.
const EDGE_SCROLL_FRACTION = 0.02
// Holding a drag still (within HOLD_ZOOM_STILL_TOLERANCE_PX of where
// stillness began) for this long starts a quick zoom-in animation centered
// on whatever's being precisely positioned - lets the last stretch of a
// drag land pixel-accurately instead of fighting a coarse, zoomed-out view.
const HOLD_ZOOM_DELAY_MS = 450
const HOLD_ZOOM_STILL_TOLERANCE_PX = 2
// How far the hold-zoom shrinks the view, relative to whatever span was
// already visible when the hold triggered - NOT a fixed absolute target
// (that was the original design, MIN_VIEW_SECONDS below, but it made the
// zoom feel "way too strong" on a long clip: converging to a fixed 0.5s
// window is a ~120x zoom on a 60s view but only 2x on a 1s view). Dividing
// the *current* span by this factor instead means the zoom depth scales
// with how zoomed-in you already are, not the file's total length.
// HOLD_ZOOM_FLOOR_SECONDS still caps how tight it can get even from an
// already-small starting span, so it never collapses to something
// unreadable. Both tunable directly - see feedback thread this was added
// for.
const HOLD_ZOOM_TARGET_FACTOR = 8
const HOLD_ZOOM_FLOOR_SECONDS = 0.3
// How long the zoom-in animation itself takes once triggered, and how long
// the reverse (back to whatever the view was before this drag started, on
// release) takes too - both directions, same duration, per direct feedback
// that the original continuous multi-second ramp felt sluggish and that
// staying zoomed in forever after releasing was disorienting rather than
// helpful once the precise positioning it was for is actually done.
const ZOOM_ANIMATION_MS = 200

export function createLoopEditorController(canvas) {
  let duration = 0
  let loopStart = 0
  let loopEnd = 0
  let playhead = null
  let peaks = null
  let dragging = null
  let panStartX = 0
  let panStartViewStart = 0
  let panStartViewEnd = 0
  let moveRegionStartClientX = 0
  let moveRegionStartLoopStart = 0
  let moveRegionStartLoopEnd = 0
  let lastPointerClientX = 0
  let edgeScrollDirection = 0
  let edgeScrollRafId = null
  let holdZoomTimeoutId = null
  let holdZoomRafId = null
  let holdZoomOriginX = 0
  let holdZoomFocusTime = null
  let holdZoomActive = false
  // The viewport as it was at the start of the current drag gesture, before
  // any hold-zoom happens - restored on release via animateViewportTo (see
  // pointerUp) so zooming in to position precisely doesn't leave the
  // waveform stuck zoomed in afterward.
  let dragStartViewStart = 0
  let dragStartViewEnd = 0
  let viewportAnimRafId = null
  // Held while Ctrl is down, disabling snapToPlayhead below - synced from
  // real mouse events (evt.ctrlKey, the most reliable source) and backed up
  // by window keydown/keyup so pressing/releasing Ctrl while the cursor
  // sits still during an edge-scroll (see tickEdgeScroll, which has no real
  // mouse event to read a modifier from) still takes effect immediately.
  let ctrlHeld = false
  let onChange = () => {}
  let onScrub = () => {}
  let onViewportChange = () => {}

  // The currently visible time window - [0, duration] at full zoom-out.
  // Everything below maps time<->x through this, not through [0, duration]
  // directly, so drag/hit-test/drawing all "just work" once zoomed.
  let viewStart = 0
  let viewEnd = 0

  function xToTime(x, displayWidth) {
    const span = viewEnd - viewStart
    const t = viewStart + (x / displayWidth) * span
    return Math.min(Math.max(t, 0), duration)
  }

  function timeToX(t, displayWidth) {
    const span = viewEnd - viewStart
    return ((t - viewStart) / span) * displayWidth
  }

  function redraw() {
    drawWaveform(canvas, duration, { loopStart, loopEnd, playhead, peaks, viewStart, viewEnd })
  }

  // Single place that actually commits a new viewport - clamps to
  // [0, duration] (sliding the window back in bounds rather than shrinking
  // it, so zoom level never changes as a side effect of clamping), redraws,
  // and notifies anything watching (the scrollbar). Every viewport-changing
  // path (wheel zoom, wheel/middle-drag pan, external setViewport from the
  // scrollbar) goes through this one function.
  function applyViewport(newStart, newEnd) {
    let s = newStart
    let e = newEnd
    if (s < 0) {
      e -= s
      s = 0
    }
    if (e > duration) {
      s -= e - duration
      e = duration
    }
    viewStart = Math.max(s, 0)
    viewEnd = Math.min(e, duration)
    redraw()
    onViewportChange({ viewStart, viewEnd, duration })
  }

  function cancelViewportAnim() {
    if (viewportAnimRafId != null) {
      cancelAnimationFrame(viewportAnimRafId)
      viewportAnimRafId = null
    }
  }

  // Smoothly moves the viewport to [targetStart, targetEnd] over
  // ZOOM_ANIMATION_MS, real-time-based (not frame-count-based) so the
  // duration stays consistent regardless of frame rate - used both for the
  // hold-zoom-in animation and for reverting the viewport back on release
  // (see pointerUp). Ease-out cubic so it starts fast and settles gently
  // rather than stopping abruptly.
  function animateViewportTo(targetStart, targetEnd, onDone) {
    cancelViewportAnim()
    const fromStart = viewStart
    const fromEnd = viewEnd
    const startTime = performance.now()

    function tick() {
      const t = Math.min(1, (performance.now() - startTime) / ZOOM_ANIMATION_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      applyViewport(fromStart + (targetStart - fromStart) * eased, fromEnd + (targetEnd - fromEnd) * eased)
      if (t < 1) {
        viewportAnimRafId = requestAnimationFrame(tick)
      } else {
        viewportAnimRafId = null
        onDone?.()
      }
    }
    viewportAnimRafId = requestAnimationFrame(tick)
  }

  // If a dragged start/end handle ends up within SNAP_PX of the playhead,
  // snap it exactly onto the playhead's time instead of the raw drag
  // position - unless Ctrl is held, which disables snapping entirely (an
  // app-wide convention for any drag of this nature, per the owner's own
  // framing, even though this waveform is currently the only place with a
  // real snap target to disable).
  function snapToPlayhead(t, rect) {
    if (ctrlHeld || playhead == null) return t
    const dist = Math.abs(timeToX(t, rect.width) - timeToX(playhead, rect.width))
    return dist <= SNAP_PX ? playhead : t
  }

  function pointerDown(evt) {
    // Middle-click-drag pans the waveform ("grab and drag" semantics - drag
    // right to reveal earlier content, the opposite sign of wheel-scroll
    // panning, which follows normal scroll conventions instead). Browsers
    // otherwise treat a middle click as autoscroll/paste-primary-selection,
    // hence preventDefault here specifically (the other buttons don't need
    // it - loop-handle/playhead dragging never triggered either behavior).
    if (evt.button === 1) {
      evt.preventDefault()
      dragging = 'pan'
      panStartX = evt.clientX
      panStartViewStart = viewStart
      panStartViewEnd = viewEnd
      return
    }

    const rect = canvas.getBoundingClientRect()
    const x = evt.clientX - rect.left

    // Right-click-drag anywhere inside the trimmed region slides the whole
    // loop (both loopStart and loopEnd, same offset) instead of moving just
    // one edge - a distinct button from the left-click handle drags below,
    // so there's no ambiguity between the two. preventDefault suppresses
    // the browser's native right-click context menu, which has no
    // legitimate use on this canvas anyway (see the canvas-level
    // 'contextmenu' listener, which also always suppresses it - mousedown
    // alone isn't enough since the menu itself opens on mouseup).
    if (evt.button === 2) {
      const startX = timeToX(loopStart, rect.width)
      const endX = timeToX(loopEnd, rect.width)
      if (x >= startX && x <= endX) {
        evt.preventDefault()
        dragging = 'moveRegion'
        moveRegionStartClientX = evt.clientX
        moveRegionStartLoopStart = loopStart
        moveRegionStartLoopEnd = loopEnd
        dragStartViewStart = viewStart
        dragStartViewEnd = viewEnd
        scheduleHoldZoom(evt.clientX)
      }
      return
    }

    const candidates = [
      { type: 'start', dist: Math.abs(x - timeToX(loopStart, rect.width)) },
      { type: 'end', dist: Math.abs(x - timeToX(loopEnd, rect.width)) }
    ]
    if (playhead != null) {
      candidates.push({ type: 'playhead', dist: Math.abs(x - timeToX(playhead, rect.width)) })
    }
    const closest = candidates.reduce((a, b) => (a.dist <= b.dist ? a : b))
    if (closest.dist <= HANDLE_HIT_PX) {
      dragging = closest.type
      if (dragging === 'start' || dragging === 'end') {
        dragStartViewStart = viewStart
        dragStartViewEnd = viewEnd
        scheduleHoldZoom(evt.clientX)
      }
    }
  }

  // Shared by pointerMove (real mouse movement) and tickEdgeScroll (the
  // viewport moving under a stationary cursor) - both need to re-derive the
  // dragged handle/playhead's time from the same on-screen clientX, just
  // against whatever the current viewport mapping happens to be at the
  // moment.
  function updateDragValue(clientX) {
    const rect = canvas.getBoundingClientRect()
    const t = xToTime(clientX - rect.left, rect.width)

    if (dragging === 'start') {
      loopStart = Math.min(snapToPlayhead(t, rect), loopEnd - MIN_LOOP_SECONDS)
      redraw()
      onChange({ loopStart, loopEnd })
    } else if (dragging === 'end') {
      loopEnd = Math.max(snapToPlayhead(t, rect), loopStart + MIN_LOOP_SECONDS)
      redraw()
      onChange({ loopStart, loopEnd })
    } else if (dragging === 'playhead') {
      playhead = t
      redraw()
      onScrub(t)
    } else if (dragging === 'moveRegion') {
      // Pixel-delta based (mirrors 'pan' above), not a difference of two
      // xToTime() calls - the region's own length must stay exactly fixed
      // through the drag, which a time-delta computed against a viewport
      // that might have shifted mid-drag (edge-scroll) could subtly throw
      // off. Clamped as a rigid pair: hitting either bound stops the whole
      // region rather than letting it shrink.
      const span = viewEnd - viewStart
      const deltaTime = ((clientX - moveRegionStartClientX) / rect.width) * span
      const length = moveRegionStartLoopEnd - moveRegionStartLoopStart
      let newStart = moveRegionStartLoopStart + deltaTime
      let newEnd = moveRegionStartLoopEnd + deltaTime
      if (newStart < 0) {
        newStart = 0
        newEnd = length
      }
      if (newEnd > duration) {
        newEnd = duration
        newStart = duration - length
      }
      loopStart = newStart
      loopEnd = newEnd
      redraw()
      onChange({ loopStart, loopEnd })
    }
  }

  function tickEdgeScroll() {
    edgeScrollRafId = null
    if (!dragging || edgeScrollDirection === 0) return

    const span = viewEnd - viewStart
    const delta = edgeScrollDirection * span * EDGE_SCROLL_FRACTION
    const prevStart = viewStart
    const prevEnd = viewEnd
    applyViewport(viewStart + delta, viewEnd + delta)
    // Already at the file's start/end bound - nothing left to scroll toward,
    // stop rather than spin the RAF loop uselessly for the rest of the drag.
    if (viewStart === prevStart && viewEnd === prevEnd) return

    updateDragValue(lastPointerClientX)
    edgeScrollRafId = requestAnimationFrame(tickEdgeScroll)
  }

  function updateEdgeScroll(clientX) {
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    if (x < EDGE_SCROLL_ZONE_PX) edgeScrollDirection = -1
    else if (x > rect.width - EDGE_SCROLL_ZONE_PX) edgeScrollDirection = 1
    else edgeScrollDirection = 0

    if (edgeScrollDirection !== 0 && edgeScrollRafId == null) {
      edgeScrollRafId = requestAnimationFrame(tickEdgeScroll)
    }
  }

  // Cancels any pending "about to start zooming" timer and any actively-
  // running zoom animation - called both on real movement (see pointerMove,
  // which immediately re-arms from the new position) and on drag end, so an
  // animation never keeps running once the gesture it belongs to is over.
  function clearHoldZoom() {
    if (holdZoomTimeoutId != null) {
      clearTimeout(holdZoomTimeoutId)
      holdZoomTimeoutId = null
    }
    if (holdZoomRafId != null) {
      cancelAnimationFrame(holdZoomRafId)
      holdZoomRafId = null
    }
  }

  function scheduleHoldZoom(clientX) {
    clearHoldZoom()
    holdZoomOriginX = clientX
    holdZoomTimeoutId = setTimeout(() => {
      holdZoomTimeoutId = null
      // Focus point is whatever's actually being positioned - the dragged
      // handle's own time for 'start'/'end' (where it coincides with the
      // cursor anyway, since those track 1:1), but specifically loopEnd
      // for 'moveRegion' regardless of where inside the region it was
      // grabbed, per the ask: zoom centers on the right-hand cut line, not
      // the drag point in general.
      if (dragging === 'start') holdZoomFocusTime = loopStart
      else if (dragging === 'end') holdZoomFocusTime = loopEnd
      else if (dragging === 'moveRegion') holdZoomFocusTime = loopEnd
      else return
      holdZoomActive = true
      tickHoldZoom(performance.now(), viewEnd - viewStart)
    }, HOLD_ZOOM_DELAY_MS)
  }

  // Anchors the shrinking viewport on holdZoomFocusTime the same way
  // handleWheel's zoom already anchors on the cursor's time - keeps that
  // exact instant pinned at the same on-screen ratio every frame, which is
  // what keeps the dragged handle (or the region's right edge) from
  // visually jumping around as the coordinate mapping changes underneath
  // it mid-animation. Reaches targetSpan (fromSpan/HOLD_ZOOM_TARGET_FACTOR,
  // floored at HOLD_ZOOM_FLOOR_SECONDS - see above) in ZOOM_ANIMATION_MS via
  // a real-time-based exponential decay of the span (not a fixed per-frame
  // multiplier) - the ratio is recomputed fresh from the *actual* current
  // viewStart every frame rather than carried forward as a stale value,
  // which is what keeps the anchor exact throughout, not just at the end.
  // targetSpan itself is derived once from fromSpan (fixed for the whole
  // animation, not recomputed against the shrinking current span each
  // frame) so the exponential decay has a stable endpoint to converge to.
  function tickHoldZoom(startTime, fromSpan) {
    holdZoomRafId = null
    if (!dragging || holdZoomFocusTime == null) return
    const targetSpan = Math.max(fromSpan / HOLD_ZOOM_TARGET_FACTOR, HOLD_ZOOM_FLOOR_SECONDS)
    const span = viewEnd - viewStart
    if (span <= targetSpan + 0.001) return

    const t = Math.min(1, (performance.now() - startTime) / ZOOM_ANIMATION_MS)
    const newSpan = Math.max(fromSpan * Math.pow(targetSpan / fromSpan, t), targetSpan)
    const ratio = (holdZoomFocusTime - viewStart) / span
    const newStart = holdZoomFocusTime - ratio * newSpan
    applyViewport(newStart, newStart + newSpan)

    if (t < 1) holdZoomRafId = requestAnimationFrame(() => tickHoldZoom(startTime, fromSpan))
  }

  function handleCtrlKeyChange(evt) {
    if (evt.key !== 'Control') return
    ctrlHeld = evt.type === 'keydown'
  }

  function pointerMove(evt) {
    ctrlHeld = evt.ctrlKey
    if (!dragging || !duration) return
    const rect = canvas.getBoundingClientRect()

    if (dragging === 'pan') {
      const span = panStartViewEnd - panStartViewStart
      const deltaTime = ((evt.clientX - panStartX) / rect.width) * span
      applyViewport(panStartViewStart - deltaTime, panStartViewEnd - deltaTime)
      return
    }

    lastPointerClientX = evt.clientX
    updateDragValue(evt.clientX)
    if (dragging === 'start' || dragging === 'end' || dragging === 'playhead' || dragging === 'moveRegion') {
      updateEdgeScroll(evt.clientX)
    }

    // Real movement (beyond a small tolerance for hand tremor) cancels any
    // pending/active hold-zoom and re-arms it from the new position - stops
    // the ramp fighting an intentional drag the instant one resumes, matching
    // "zoom in while held still" rather than "zoom in regardless."
    if (dragging === 'start' || dragging === 'end' || dragging === 'moveRegion') {
      if (Math.abs(evt.clientX - holdZoomOriginX) > HOLD_ZOOM_STILL_TOLERANCE_PX) {
        scheduleHoldZoom(evt.clientX)
      }
    } else {
      clearHoldZoom()
    }
  }

  function pointerUp() {
    const wasZoomable = dragging === 'start' || dragging === 'end' || dragging === 'moveRegion'
    dragging = null
    edgeScrollDirection = 0
    clearHoldZoom()

    // Only animate back if the view actually moved during this drag (hold-
    // zoom engaged, or edge-scroll panned it) - skip the no-op animation on
    // an ordinary short drag that never triggered either.
    if (wasZoomable && holdZoomActive && (viewStart !== dragStartViewStart || viewEnd !== dragStartViewEnd)) {
      animateViewportTo(dragStartViewStart, dragStartViewEnd)
    }
    holdZoomActive = false
  }

  // Wheel zoom, centered on the cursor's time position - only active while
  // hovering the canvas, since the listener is attached to the canvas
  // itself rather than window. A horizontal scroll gesture (shift+wheel on
  // a mouse, or a trackpad's two-finger horizontal swipe, both land in
  // deltaX) pans instead of zooming.
  function handleWheel(evt) {
    if (!duration) return
    evt.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const span = viewEnd - viewStart

    if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY)) {
      const shift = (evt.deltaX / rect.width) * span
      applyViewport(viewStart + shift, viewEnd + shift)
      return
    }

    const x = evt.clientX - rect.left
    const cursorTime = xToTime(x, rect.width)
    const factor = evt.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR
    const newSpan = Math.min(Math.max(span * factor, MIN_VIEW_SECONDS), duration)

    const ratio = (cursorTime - viewStart) / span
    const newStart = cursorTime - ratio * newSpan
    applyViewport(newStart, newStart + newSpan)
  }

  function preventContextMenu(evt) {
    evt.preventDefault()
  }

  // Redraws (which also re-syncs the canvas's bitmap resolution to its
  // current rendered size - see waveform.js's resizeCanvasForDisplay)
  // whenever the panel's own size might have changed, matching the same
  // fix/reasoning on EqEditor.js's own resize handler.
  function handleResize() {
    redraw()
  }

  canvas.addEventListener('mousedown', pointerDown)
  window.addEventListener('mousemove', pointerMove)
  window.addEventListener('mouseup', pointerUp)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  window.addEventListener('keydown', handleCtrlKeyChange)
  window.addEventListener('keyup', handleCtrlKeyChange)
  canvas.addEventListener('contextmenu', preventContextMenu)
  window.addEventListener('resize', handleResize)

  return {
    load(totalDuration, initialLoopStart, initialLoopEnd) {
      duration = totalDuration
      loopStart = initialLoopStart ?? 0
      loopEnd = initialLoopEnd ?? totalDuration
      playhead = null
      peaks = null
      viewStart = 0
      viewEnd = totalDuration
      redraw()
      onViewportChange({ viewStart, viewEnd, duration })
    },
    setPeaks(newPeaks) {
      peaks = newPeaks
      redraw()
    },
    getLoopPoints() {
      return { loopStart, loopEnd }
    },
    setLoopPoints(newStart, newEnd) {
      loopStart = Math.min(Math.max(newStart, 0), duration)
      loopEnd = Math.min(Math.max(newEnd, loopStart + MIN_LOOP_SECONDS), duration)
      redraw()
      onChange({ loopStart, loopEnd })
    },
    setPlayhead(t) {
      playhead = t
      redraw()
    },
    clearPlayhead() {
      playhead = null
      redraw()
    },
    // Lets an external navigator (the scrollbar) drive the viewport
    // directly - goes through the same clamping/redraw/notify path as
    // every internal viewport change.
    setViewport(newStart, newEnd) {
      applyViewport(newStart, newEnd)
    },
    onLoopChange(fn) {
      onChange = fn
    },
    onScrub(fn) {
      onScrub = fn
    },
    onViewportChange(fn) {
      onViewportChange = fn
    },
    destroy() {
      if (edgeScrollRafId != null) cancelAnimationFrame(edgeScrollRafId)
      clearHoldZoom()
      cancelViewportAnim()
      canvas.removeEventListener('mousedown', pointerDown)
      window.removeEventListener('mousemove', pointerMove)
      window.removeEventListener('mouseup', pointerUp)
      canvas.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleCtrlKeyChange)
      window.removeEventListener('keyup', handleCtrlKeyChange)
      canvas.removeEventListener('contextmenu', preventContextMenu)
      window.removeEventListener('resize', handleResize)
    }
  }
}
