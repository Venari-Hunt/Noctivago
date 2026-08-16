import Store from 'electron-store'

const store = new Store({
  name: 'settings',
  defaults: { autoUpdateEnabled: true }
})

export function getSettings() {
  return { autoUpdateEnabled: store.get('autoUpdateEnabled') }
}

export function setAutoUpdateEnabled(enabled) {
  store.set('autoUpdateEnabled', Boolean(enabled))
  return getSettings()
}
