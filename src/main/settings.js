import Store from 'electron-store'

const store = new Store({
  name: 'settings',
  defaults: { autoUpdateEnabled: true, minimizeToTrayEnabled: false }
})

export function getSettings() {
  return {
    autoUpdateEnabled: store.get('autoUpdateEnabled'),
    minimizeToTrayEnabled: store.get('minimizeToTrayEnabled')
  }
}

export function setAutoUpdateEnabled(enabled) {
  store.set('autoUpdateEnabled', Boolean(enabled))
  return getSettings()
}

export function setMinimizeToTrayEnabled(enabled) {
  store.set('minimizeToTrayEnabled', Boolean(enabled))
  return getSettings()
}
