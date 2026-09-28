// How exportMix.js slices a Random Interval / Scheduled sound's plays into
// batches. Pure (no ffmpeg, no electron) so it can be unit-tested.

// EVENT_BATCH_SIZE branches of rubberband+volume+fade+adelay go into one
// ffmpeg graph per batch. rubberband's cost is proportional to a shot's
// duration and ffmpeg runs a graph's branches on one thread, so this is
// bounded on purpose - a documented "took all my RAM and never finished"
// bug (v0.1.85) came from putting every event's rubberband into a single
// graph. 25 branches were measured safe (~40s/500MB); this keeps a margin.
// Unlike the pre-rewrite version each batch graph is now only `apad`'d to
// its own span, not the whole export length, so peak memory per batch is
// meaningfully lower than even that measurement.
export const EVENT_BATCH_SIZE = 20
// When a sound's shots need NO rubberband at all - no per-shot pitch AND no
// per-shot speed variation (see exportMix's eventsNeedRubberband) - each
// event branch is just volume + fade + adelay, which is cheap enough to pack
// far more of into one graph. A dense Random Interval sound with plain shots
// then produces ~15x fewer batch tracks (measured: a batch of 300 plain
// branches over a 20-min span peaks ~270 MB, one ffmpeg pass ~90s).
export const EVENT_BATCH_SIZE_LIGHT = 300
// A batch's cost is roughly plays x span: every branch's adelay emits
// silence up to its own play, and amix sums every branch over the whole span.
// Capping by play count alone let a sparse sound put all its plays into one
// batch spanning the whole export (owner's 9h Beach export, v0.1.234: 86
// plays, one every 5-8 min, one batch 9h wide; measured on real ffmpeg, 10
// plays over 1h = 5.6s, 19 over 2h = 13.3s). Cutting a batch once it would
// cover more than this keeps every batch short, whatever the play spacing.
// More, shorter batches cost little downstream: the merge step sorts tracks
// by time, so its total work tracks the export length, not the track count.
export const MAX_BATCH_SPAN_SECONDS = 300
// A little slack past the last event's own end so a batch's final shot
// (plus any fade-out tail) isn't clipped by the batch track's own length.
export const BATCH_TAIL_MARGIN_SECONDS = 0.25

function eventEnd(evt, shotDurationSeconds) {
  const shotLen = Number.isFinite(evt.shotDurationSeconds) ? evt.shotDurationSeconds : shotDurationSeconds
  return evt.offsetSeconds + shotLen + (evt.fadeOutMs ?? 0) / 1000
}

// Chronological events -> contiguous batches, each with the real time span it
// occupies (first event's offset .. latest end among its events + a little
// tail slack). A batch closes at batchSize plays, or when the next play would
// stretch it past MAX_BATCH_SPAN_SECONDS. Computed up front from the event
// list alone (no rendering needed) so the progress reporter can be weighted
// before any ffmpeg runs.
export function planBatches(events, shotDurationSeconds, batchSize = EVENT_BATCH_SIZE, maxSpanSeconds = MAX_BATCH_SPAN_SECONDS) {
  const batches = []
  let slice = []
  let start = 0
  let end = 0
  const close = () => {
    if (slice.length === 0) return
    batches.push({ events: slice, start, span: Math.max(0.05, end + BATCH_TAIL_MARGIN_SECONDS - start) })
    slice = []
  }
  for (const evt of events) {
    const evtEnd = eventEnd(evt, shotDurationSeconds)
    if (slice.length > 0 && (slice.length >= batchSize || Math.max(end, evtEnd) - start > maxSpanSeconds)) close()
    if (slice.length === 0) {
      start = evt.offsetSeconds
      end = start
    }
    slice.push(evt)
    end = Math.max(end, evtEnd)
  }
  close()
  return batches
}
