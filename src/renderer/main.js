import { createTabHost } from './core/TabHost.js'
import { loadPlugins } from './core/PluginLoader.js'
import { installSliderDoubleClickReset } from './core/sliderReset.js'
import { installNumberBoxStepper } from './core/numberBoxStepper.js'
import { createSettingsTab } from './settings/index.jsx'
import { installUpdateModal } from './core/UpdateModal.js'
import { installSleepTimer } from './core/SleepTimer.js'
import { installWatchFolderDialog } from './core/WatchFolderDialog.js'
import { installRecordDialog } from './core/RecordDialog.js'
import { installAddLinkDialog } from './core/AddLinkDialog.js'
import { mountToolbar, updateToolbar, setToolbarHandlers, setSettingsOpen } from './toolbar/index.jsx'
import { mount as mountMixerTab, onShow as onShowMixerTab } from './tabs/mixer/index.js'

mountToolbar(document.getElementById('toolbar'), document.getElementById('nav-end'))
installSliderDoubleClickReset()
installNumberBoxStepper()
installWatchFolderDialog()
installRecordDialog()
installAddLinkDialog()
installUpdateModal()
installSleepTimer()

// The BrowserWindow's initial title option gets overwritten by the loaded
// page's own <title> tag once the page finishes loading (standard Electron/
// Chromium behavior) - so the dev-vs-installed distinction has to be set
// here too, not just in src/main/index.js's createWindow(), or it would
// flip back to the plain title moments after launch.
window.noctivago.isPackaged().then((isPackaged) => {
  document.title = isPackaged ? 'Noctívago' : 'Noctívago (Dev)'
  document.getElementById('title-bar-name').textContent = document.title
  updateToolbar({ isDev: !isPackaged })
})

const tabHost = createTabHost(
  document.getElementById('tab-bar'),
  document.getElementById('tab-content'),
  document.getElementById('tab-sticky-bar')
)

// Registered synchronously, before any plugin loads, so the Mixer tab is
// always present regardless of plugin state and always becomes tab 0.
tabHost.register({ id: 'mixer', title: 'Mixer', mount: mountMixerTab, onShow: onShowMixerTab })

// Settings is a page, not a dialog: a tab with no tab-bar button, opened from
// the nav's Settings button, which toggles back to the tab you came from.
tabHost.register(createSettingsTab())
let lastTab = 'mixer'
setToolbarHandlers({
  onOpenSettings: () => tabHost.activate(tabHost.getActiveId() === 'settings' && tabHost.has(lastTab) ? lastTab : 'settings')
})
tabHost.onActivate((id) => {
  if (id !== 'settings') lastTab = id
  setSettingsOpen(id === 'settings')
})

loadPlugins(tabHost)
