import Store from 'electron-store'
import crypto from 'node:crypto'

const store = new Store({
  name: 'presets',
  defaults: { presets: [] }
})

export function listPresets() {
  return store.get('presets')
}

export function savePreset({ name, sounds }) {
  const preset = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    sounds: sounds.map((s) => ({
      soundId: s.soundId,
      type: 'local',
      volume: s.volume,
      effects: []
    }))
  }
  const presets = store.get('presets')
  presets.push(preset)
  store.set('presets', presets)
  return preset
}

export function deletePreset(id) {
  const presets = store.get('presets')
  store.set('presets', presets.filter((p) => p.id !== id))
}
