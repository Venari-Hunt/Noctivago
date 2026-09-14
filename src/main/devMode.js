import { app } from 'electron'

// Must be the very first local import in main/index.js, before anything that
// might resolve app.getPath('userData') at module-eval time (library.js,
// presets.js via electron-store, electron-log's file transport, ffmpeg clip
// storage) - ES modules evaluate imports in the order they appear, so this
// only works if nothing importable ahead of it has already locked in the
// default userData path.
//
// Without this, a dev-mode session (`npm run dev`) and an installed/packaged
// build shared the exact same userData folder (%APPDATA%\noctivago\) since
// nothing overrode app.name away from package.json's "name" field for dev -
// meaning test data added while developing directly mutated the same
// library/presets/clips an actually-installed copy of the app was using.
// Confirmed the hard way: testing in dev mode while the user was using that
// same dev session as their real, daily-use instance.
if (!app.isPackaged) {
  app.setName('noctivago-dev')
}
