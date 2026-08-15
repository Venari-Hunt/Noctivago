import { createTabHost } from './core/TabHost.js'
import { loadPlugins } from './core/PluginLoader.js'
import { mount as mountMixerTab, onShow as onShowMixerTab } from './tabs/mixer/index.js'

const tabHost = createTabHost(document.getElementById('tab-bar'), document.getElementById('tab-content'))

// Registered synchronously, before any plugin loads, so the Mixer tab is
// always present regardless of plugin state and always becomes tab 0.
tabHost.register({ id: 'mixer', title: 'Mixer', mount: mountMixerTab, onShow: onShowMixerTab })

loadPlugins(tabHost)
