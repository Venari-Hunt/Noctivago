// Places pre-rendered tracks on a timeline for one amix, without mixing
// hours of silence. Pure (builds filter-graph text only) so it can be
// unit-tested.
//
// The old shape gave every track its own amix input, `adelay`'d to its
// offset. amix then sums every input across the whole output, so a merge of
// 32 short tracks spread over 50 minutes summed 32 x 50 minutes of mostly
// silence (measured on the owner's Beach-like 9 h Sound Group: 65 s per
// merge chunk, 80 s for the final 14-track combine).
//
// Instead, tracks that don't overlap in time share a "lane": each is padded
// to the start of the next one and the lane is `concat`'d end to end, so a
// lane costs about its own length once. amix then sums only the lanes -
// usually a handful, however many tracks there are. Placement is
// sample-exact (the old adelay rounded to whole milliseconds).
//
// A track without a known `duration` can't be packed (its end is unknown),
// so it gets its own lane, delayed exactly like before.

export const LANE_SAMPLE_RATE = 44100

// tracks: [{ offset, duration? }] (seconds). Returns lanes as arrays of
// indexes into `tracks`, each lane ordered by time.
export function planLanes(tracks, baseOffset = 0, sampleRate = LANE_SAMPLE_RATE) {
  const toSample = (seconds) => Math.max(0, Math.round((seconds - baseOffset) * sampleRate))
  const order = tracks.map((_, i) => i).sort((a, b) => tracks[a].offset - tracks[b].offset)
  const lanes = []
  const laneEnds = []
  for (const i of order) {
    const t = tracks[i]
    if (!(t.duration > 0)) {
      lanes.push([i])
      laneEnds.push(Infinity)
      continue
    }
    const start = toSample(t.offset)
    const end = start + Math.round(t.duration * sampleRate)
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) {
      lane = lanes.length
      lanes.push([])
      laneEnds.push(0)
    }
    lanes[lane].push(i)
    laneEnds[lane] = end
  }
  return lanes
}

// Filter-graph statements placing each track (read from input
// `inputIndexes[i]`) at `offset - baseOffset`. Returns { graph, labels }:
// graph lines to join with ';', one output label per lane for the caller's
// own amix. `prefix` keeps labels unique when a caller builds more graph.
export function buildLaneGraph(tracks, inputIndexes, { baseOffset = 0, prefix = 'ln', sampleRate = LANE_SAMPLE_RATE } = {}) {
  const toSample = (seconds) => Math.max(0, Math.round((seconds - baseOffset) * sampleRate))
  const fmt = `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=stereo`
  const graph = []
  const labels = []
  planLanes(tracks, baseOffset, sampleRate).forEach((lane, l) => {
    const segLabels = []
    lane.forEach((i, k) => {
      const t = tracks[i]
      const start = toSample(t.offset)
      const parts = [fmt]
      if (t.duration > 0) {
        // Pad (or trim) to exactly the slot up to the next track in this
        // lane, so every later track starts on its exact sample.
        const next = lane[k + 1]
        const slot = next === undefined ? Math.round(t.duration * sampleRate) : toSample(tracks[next].offset) - start
        parts.push(`apad=whole_len=${slot}`, `atrim=end_sample=${slot}`)
      }
      if (k === 0 && start > 0) parts.push(`adelay=delays=${start}S:all=1`)
      const label = `[${prefix}${l}_${k}]`
      graph.push(`[${inputIndexes[i]}:a]${parts.join(',')}${label}`)
      segLabels.push(label)
    })
    const laneLabel = `[${prefix}${l}]`
    graph.push(
      segLabels.length === 1
        ? `${segLabels[0]}anull${laneLabel}`
        : `${segLabels.join('')}concat=n=${segLabels.length}:v=0:a=1${laneLabel}`
    )
    labels.push(laneLabel)
  })
  return { graph, labels }
}
