export default class BrokenPluginExample {
  async onload() {
    throw new Error('This plugin is deliberately broken to test fail-soft plugin loading.')
  }
}
