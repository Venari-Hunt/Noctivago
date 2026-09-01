import { routeDevAudioOutput } from '../core/devAudioOutput.js'
import { WholeMixChain } from './WholeMixChain.js'

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
  }

  async resume() {
    if (this.context.state === 'suspended') await this.context.resume()
  }
}
