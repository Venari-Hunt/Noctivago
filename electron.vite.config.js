import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Baked in only during the GitHub Actions release build (see
    // .github/workflows/release.yml), from a narrowly-scoped, read-only PAT
    // - never present for local `npm run dev`/`npm run build:win`. Needed
    // because the repo is private, so electron-updater's runtime update
    // check (src/main/autoUpdate.js) has to authenticate. Empty string
    // locally, which just makes the update check fail harmlessly (still
    // gated behind app.isPackaged, so it never even runs in dev).
    define: {
      __UPDATE_TOKEN__: JSON.stringify(process.env.NOCTIVAGO_UPDATE_TOKEN ?? ''),
      // Freesound import (src/main/freesound/) - a single app-wide API token,
      // requested once by the developer at freesound.org/apiv2/apply, baked
      // in at build time the same way __UPDATE_TOKEN__ is. Freesound's
      // simplest auth shape: fine for search/preview/download (all this
      // feature needs), OAuth2 only being required for upload/rate or for
      // downloading a sound's full original-quality file. Deliberately baked
      // into every build (GitHub release AND the itch.io copy) rather than
      // excluded like __UPDATE_TOKEN__ is from itch - this is a free,
      // re-issuable, read-only key (not a real credential like a GitHub PAT),
      // so the owner accepted the risk of it being extractable from a public
      // binary rather than losing the feature on itch.io.
      __FREESOUND_API_KEY__: JSON.stringify(process.env.FREESOUND_API_KEY ?? '')
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
