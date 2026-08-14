export class AudioEngine {
  constructor() {
    this.context = new AudioContext()
    this.masterGain = this.context.createGain()
    this.masterGain.connect(this.context.destination)
  }

  async resume() {
    if (this.context.state === 'suspended') await this.context.resume()
  }
}
