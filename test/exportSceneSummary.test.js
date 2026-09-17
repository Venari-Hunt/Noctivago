import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildSceneSection, buildCreditsSection, describeDrift, describeFilters } from '../plugins/export/sceneSummary.js'

const loop = (over = {}) => ({ id: 'a', name: 'Fire', playMode: 'loop', filters: {}, speedPitch: null, fluctuation: null, ...over })

describe('buildSceneSection', () => {
  test('describes a looping sound with pan, pitch, drift and filters', () => {
    const lines = buildSceneSection({
      sounds: [
        {
          volume: 0.7,
          entry: loop({
            filters: { pan: -0.4, lowpassHz: 2000, reverbMix: 0.3, reverbSizeMs: 1500 },
            speedPitch: { speed: 1, pitchSemitones: -2 },
            fluctuation: { volume: { enabled: true, min: 0.5, max: 1, changeMinSeconds: 6, changeMaxSeconds: 14 } }
          })
        }
      ]
    })
    assert.equal(lines[1], '- Fire: volume 70%, loops continuously')
    assert.equal(
      lines[2],
      '    pitch -2 st; volume drifts 50%-100% (changes every 6-14 s); low-pass 2 kHz; reverb 30% (1.5 s); panned 40% left'
    )
  })

  test('describes random-interval and scheduled sounds by their per-play settings', () => {
    const lines = buildSceneSection({
      sounds: [
        {
          volume: 0.5,
          entry: loop({
            id: 'b',
            name: 'Thunder',
            playMode: 'scatter',
            scatter: { minGapSeconds: 30, maxGapSeconds: 90, minPitchSemitones: -3, maxPitchSemitones: 2, panFullyRandom: true },
            fluctuation: { volume: { enabled: true, min: 0, max: 1 } }
          })
        },
        { volume: 1, entry: loop({ id: 'c', name: 'Bell', playMode: 'scheduled', schedule: { type: 'times', times: ['12:00', '18:00'] } }) }
      ],
      groups: [{ id: 'g', name: 'Outside', soundIds: ['b', 'missing'], filters: { occlusion: 0.6, fluctuation: { pan: { enabled: true, fullyRandom: true, perSound: true } } } }]
    })
    assert.equal(lines[1], '- Thunder: volume 50%, plays now and then, every 30-90 s (random), in group "Outside"')
    assert.equal(lines[2], '    pitch -3 st to +2 st each play; random left/right position each play')
    assert.equal(lines[3], '- Bell: volume 100%, plays on a clock, at 12:00, 18:00')
    assert.equal(
      lines.at(-1),
      '- "Outside" (Thunder): occlusion 60% (sounds like it\'s behind a wall); pan drifts anywhere left to right, each sound on its own'
    )
  })

  test('adds whole-mix processing only when there is some', () => {
    assert.ok(!buildSceneSection({ sounds: [{ volume: 1, entry: loop() }] }).some((l) => l.startsWith('Whole mix')))
    const lines = buildSceneSection({ sounds: [{ volume: 1, entry: loop() }], wholeMix: { highpassHz: 80, lowpassHz: 20000 } })
    assert.equal(lines.at(-1), 'Whole mix: high-pass 80 Hz')
  })
})

describe('building blocks', () => {
  test('neutral settings describe nothing', () => {
    assert.deepEqual(describeFilters({ highpassHz: 0, lowpassHz: 20000, gainDb: 0, pan: 0, eq: [{ type: 'peaking', gainDb: 0 }], gateThresholdDb: -80 }), [])
    assert.deepEqual(describeDrift({ volume: { enabled: false } }), [])
  })
})

describe('buildCreditsSection', () => {
  test('credits Freesound and link sounds and flags attribution and unknown licenses', () => {
    const lines = buildCreditsSection([
      { name: 'Fire', source: { type: 'freesound', freesoundId: 1, username: 'ann', title: 'Campfire', license: 'http://creativecommons.org/licenses/by/4.0/', description: 'Recorded at a lake.' } },
      { name: 'Rain', source: { type: 'freesound', freesoundId: 2, username: 'bo', license: null } },
      { name: 'Mine', source: null }
    ])
    assert.deepEqual(lines, [
      'Credits:',
      '- "Campfire" by ann (Freesound) - CC BY 4.0 - https://freesound.org/people/ann/sounds/1/',
      '- "Rain" by bo (Freesound) - license unknown - https://freesound.org/people/bo/sounds/2/',
      'Freesound sounds under Creative Commons Attribution licenses must be credited as above wherever the audio is published.',
      "License not found for: Rain - check each sound's Freesound page before publishing.",
      '',
      'What the Freesound authors say about their sounds:',
      '- Fire: Recorded at a lake.'
    ])
  })

  test('says so when nothing needs credit', () => {
    assert.equal(buildCreditsSection([{ name: 'Mine', source: null }])[1].startsWith('- No third-party sounds'), true)
  })
})
