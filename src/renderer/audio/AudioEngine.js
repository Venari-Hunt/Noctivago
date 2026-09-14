import { routeDevAudioOutput } from '../core/devAudioOutput.js'
import { WholeMixChain } from './WholeMixChain.js'
import { SoundGroupChain } from './SoundGroupChain.js'

export class AudioEngine {
  constructor() {
    this.context = new AudioContext()
    this.masterGain = this.context.createGain()
    // Whole-mix processing sits between masterGain (the global volume slider)
    // and the destination - see WholeMixChain. Neutral until a preset with
    // saved whole-mix settings is loaded.
    this.wholeMix = new WholeMixChain(this.context, this.context.destination)
    this.masterGain.connect(this.wholeMix.input)
    routeDevAudioOutput(this.context)

    // Sound Groups (see SoundGroupChain.js) - a named submix bus scoped to
    // whichever preset is currently loaded. groupChains is keyed by group
    // id; membership is tracked separately so destinationForSound/
    // routeSound stay O(1) per sound rather than scanning every group.
    this.groupChains = new Map()
    this._soundGroupMembership = new Map()
  }

  async resume() {
    if (this.context.state === 'suspended') await this.context.resume()
  }

  // Installs the active preset's Sound Groups on the shared engine - called
  // from loadPreset (tabs/mixer/index.js) and whenever a group is created,
  // edited, or deleted while its preset is the one currently loaded. Reuses
  // an existing chain in place (same object, just re-set()) whenever a
  // group's id survives between calls, so a live filter/EQ edit doesn't
  // audibly glitch the chain out from under whatever's already routed to it.
  setSoundGroups(groups) {
    const list = groups ?? []
    const wantedIds = new Set(list.map((g) => g.id))
    for (const [id, chain] of this.groupChains) {
      if (!wantedIds.has(id)) {
        chain.dispose()
        this.groupChains.delete(id)
      }
    }
    this._soundGroupMembership = new Map()
    for (const group of list) {
      let chain = this.groupChains.get(group.id)
      if (!chain) {
        chain = new SoundGroupChain(this.context, this.masterGain)
        this.groupChains.set(group.id, chain)
      }
      chain.set(group.filters ?? null)
      for (const soundId of group.soundIds ?? []) this._soundGroupMembership.set(soundId, group.id)
    }
  }

  // Live-previews a group's filters without waiting for a save (mirrors
  // wholeMix.set() being called directly from its own preview listener) - a
  // no-op if that group isn't currently installed (its preset isn't the one
  // loaded, or it was deleted since).
  previewGroup(groupId, filters) {
    this.groupChains.get(groupId)?.set(filters ?? null)
  }

  destinationForSound(soundId) {
    const groupId = this._soundGroupMembership.get(soundId)
    const chain = groupId ? this.groupChains.get(groupId) : null
    return chain ? chain.input : this.masterGain
  }

  // Rewires a live source's already-created gainNode to whichever
  // destination it currently belongs at (a group's bus, or straight to
  // masterGain). Every Source class connects gainNode to engine.masterGain
  // exactly once at construction (see SoundSource.js/BufferSoundSource.js/
  // ScatterSoundSource.js/ScheduledSoundSource.js), so this is a plain
  // disconnect+reconnect done from outside rather than something each Source
  // class needs to know about itself. Idempotent (skips the reconnect if the
  // destination hasn't actually changed).
  routeSound(soundId, source) {
    const desired = this.destinationForSound(soundId)
    if (source._groupRoute === desired) return
    source.gainNode.disconnect()
    source.gainNode.connect(desired)
    source._groupRoute = desired
  }
}
