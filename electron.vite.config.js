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
      __UPDATE_TOKEN__: JSON.stringify(process.env.NOCTIVAGO_UPDATE_TOKEN ?? '')
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
