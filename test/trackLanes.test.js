import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planLanes, buildLaneGraph } from '../src/main/ffmpeg/trackLanes.js'

test('tracks that do not overlap share one lane, in time order', () => {
  const tracks = [{ offset: 20, duration: 5 }, { offset: 0, duration: 10 }, { offset: 10, duration: 3 }]
  assert.deepEqual(planLanes(tracks), [[1, 2, 0]])
})

test('overlapping tracks go to separate lanes', () => {
  const tracks = [{ offset: 0, duration: 10 }, { offset: 5, duration: 10 }, { offset: 12, duration: 2 }]
  assert.deepEqual(planLanes(tracks), [[0, 2], [1]])
})

test('a track without a duration always gets its own lane', () => {
  const tracks = [{ offset: 0 }, { offset: 100, duration: 1 }]
  assert.deepEqual(planLanes(tracks), [[0], [1]])
})

test('graph places every track on its exact sample, relative to the base offset', () => {
  const tracks = [{ offset: 11, duration: 1 }, { offset: 13.5, duration: 2 }]
  const { graph, labels } = buildLaneGraph(tracks, [4, 5], { baseOffset: 10, prefix: 'x' })
  assert.deepEqual(labels, ['[x0]'])
  // first: padded to the next start (2.5 s = 110250 samples), delayed 1 s
  assert.match(graph[0], /^\[4:a\].*apad=whole_len=110250,atrim=end_sample=110250,adelay=delays=44100S:all=1\[x0_0\]$/)
  // last: its own length (2 s), no delay
  assert.match(graph[1], /^\[5:a\].*apad=whole_len=88200,atrim=end_sample=88200\[x0_1\]$/)
  assert.equal(graph[2], '[x0_0][x0_1]concat=n=2:v=0:a=1[x0]')
})

test('an undated track keeps the plain delay', () => {
  const { graph } = buildLaneGraph([{ offset: 2 }], [0])
  assert.match(graph[0], /^\[0:a\]aformat=[^,]+,adelay=delays=88200S:all=1\[ln0_0\]$/)
  assert.equal(graph[1], '[ln0_0]anull[ln0]')
})
