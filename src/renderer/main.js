import { createTabHost } from './core/TabHost.js'
import { loadPlugins } from './core/PluginLoader.js'
import { installSliderDoubleClickReset } from './core/sliderReset.js'
import { installNumberBoxStepper } from './core/numberBoxStepper.js'
import { installSettingsMenu } from './core/SettingsMenu.js'
import { installUpdateModal } from './core/UpdateModal.js'
import { installSleepTimer } from './core/SleepTimer.js'
import { installWatchFolderDialog } from './core/WatchFolderDialog.js'
import { installRecordDialog } from './core/RecordDialog.js'
import { installAddLinkDialog } from './core/AddLinkDialog.js'
import { installFreesoundDialog } from './core/FreesoundDialog.js'
import { mount as mountMixerTab, onShow as onShowMixerTab } from './tabs/mixer/index.js'

installSliderDoubleClickReset()
installNumberBoxStepper()
installWatchFolderDialog()
installRecordDialog()
installAddLinkDialog()
installFreesoundDialog()
installUpdateModal()
installSleepTimer()
installSettingsMenu()

// The BrowserWindow's initial title option gets overwritten by the loaded
// page's own <title> tag once the page finishes loading (standard Electron/
// Chromium behavior) - so the dev-vs-installed distinction has to be set
// here too, not just in src/main/index.js's createWindow(), or it would
// flip back to the plain title moments after launch.
window.noctivago.isPackaged().then((isPackaged) => {
  document.title = isPackaged ? 'Noctívago' : 'Noctívago (Dev)'
  if (!isPackaged) document.getElementById('dev-badge').classList.remove('hidden')
})

const tabHost = createTabHost(
  document.getElementById('tab-bar'),
  document.getElementById('tab-content'),
  document.getElementById('tab-sticky-bar')
)

// Registered synchronously, before any plugin loads, so the Mixer tab is
// always present regardless of plugin state and always becomes tab 0.
tabHost.register({ id: 'mixer', title: 'Mixer', mount: mountMixerTab, onShow: onShowMixerTab })

loadPlugins(tabHost)
