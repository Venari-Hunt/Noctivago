import { simulateEvents } from './simulate.js'
import { routeDevAudioOutput } from './audio/devAudioOutput.js'

// Duplicated from src/renderer/core/ (well, plugins/editor/util/time.js's own
// duplicate of it) - same cross-directory-import reason every other plugin
// duplication in this codebase has.
function parseDuration(text) {
  const parts = text.trim().split(':')
  if (parts.length === 0 || parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return null
  if (nums.length === 1) return nums[0]
  if (nums.length === 2) return nums[0] * 60 + nums[1]
  return nums[0] * 3600 + nums[1] * 60 + nums[2]
}

// Inbox request: "When export finishes it should beep or make a sound or
// something" - an export can run for minutes to hours (see exportMix.js's
// own benchmarks), long enough that the owner isn't necessarily watching the
// tab when it lands. A short two/three-note chime (rising = success, falling
// = failure, so the two are distinguishable without looking) via a throwaway
// AudioContext + a couple of OscillatorNodes - no bundled sound asset needed,
// and this app already builds everything audio-related on Web Audio anyway.
// The context is closed a beat after the last note finishes rather than left
// open indefinitely. routeDevAudioOutput mirrors the same dev-mode
// convenience every other AudioContext in this codebase gets (routes to the
// monitor-out device instead of the PC speakers while developing) - a
// throwaway completion beep is exactly the kind of dev-testing noise that
// convenience exists to avoid.
function playCompletionChime(success) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    routeDevAudioOutput(ctx)
    const now = ctx.currentTime
    const notes = success ? [523.25, 659.25, 783.99] : [392.0, 293.66]
    const noteLength = 0.14
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * noteLength
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + noteLength)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + noteLength + 0.02)
    })
    setTimeout(() => ctx.close().catch(() => {}), (notes.length * noteLength + 0.3) * 1000)
  } catch (err) {
    console.error('Export: completion chime failed', err)
  }
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return '--:--:--'
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor(totalSeconds / 60) % 60
  const h = Math.floor(totalSeconds / 3600)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Bakes a whole preset down to one audio file of a chosen length/format -
// its own tab (not just a Presets-modal button, per the owner's own explicit
// direction: "I think this should be a new plugin as in you go to the tab
// and there's settings on how you want it exported"). Design worked out
// collaboratively with the owner: simulate first (reusing the exact
// randomization/scheduling functions each playMode's real playback source
// already uses, run as a dry loop - see simulate.js), then hand the
// resulting event lists to a main-process ffmpeg pipeline that builds one
// track per included sound and mixes them down.
export default class ExportPlugin {
  constructor(app) {
    this.app = app
    this.api = app.noctivago
    this.presets = []
    this.library = []
    this.els = {}
    this.exporting = false
  }

  async onload() {
    this.unregister = this.app.tabs.register({
      id: 'export',
      title: 'Export',
      mount: (container) => this.mount(container),
      onShow: () => this.refresh()
    })
  }

  async onunload() {
    this.unsubscribeProgress?.()
    this.unregister?.()
  }

  // Stamps how long the just-finished log line's phase actually took, right
  // onto that line - see onExportProgress's own comment for why.
  closeLastLogLineTiming() {
    if (this.lastStepAt == null) return
    const elapsed = formatDuration((Date.now() - this.lastStepAt) / 1000)
    const prevLine = this.els.log?.lastElementChild
    if (prevLine) prevLine.textContent += ` (${elapsed})`
    this.lastStepAt = null
  }

  onExportProgress(payload) {
    if (!this.exporting || !this.els.progressBar) return
    const pct = Math.round((payload.fraction ?? 0) * 100)
    this.els.progressBar.style.width = `${pct}%`
    this.els.progressPct.textContent = `${pct}%`
    if (payload.type === 'step' && payload.label) {
      this.els.status.textContent = payload.label
      // Per-phase wall-clock timing (2026-09-02, Export Part B investigation):
      // synthetic benchmarking of the parallelMixdown toggle showed no real
      // speedup on test content, casting doubt on the earlier circumstantial
      // reasoning that the final mixdown is the actual bottleneck on a real
      // multi-hour export. Rather than guess further, surface how long each
      // phase actually took, right in the log every export already writes -
      // the next real slow export will show definitively where the time
      // goes, instead of relying on speculation.
      this.closeLastLogLineTiming()
      this.lastStepAt = Date.now()
      const line = document.createElement('div')
      line.className = 'export-log-line'
      line.textContent = payload.label
      this.els.log.appendChild(line)
      this.els.log.scrollTop = this.els.log.scrollHeight
    }
  }

  mount(container) {
    container.innerHTML = `
      <div class="export-tab">
        <h2>Export a preset to one audio file</h2>
        <p class="export-hint">Simulates how the preset's sounds would actually play over the chosen length (including Random Interval and Scheduled timing), then bakes the whole thing down to one file.</p>

        <label>
          <span>Preset</span>
          <select id="export-preset"></select>
        </label>
        <label>
          <span>Length</span>
          <input id="export-length" type="text" inputmode="numeric" placeholder="hh:mm:ss" value="1:00:00" />
        </label>
        <label>
          <span>Format</span>
          <select id="export-format">
            <option value="wav">WAV (lossless)</option>
            <option value="mp3">MP3</option>
            <option value="opus">Opus</option>
            <option value="flac">FLAC</option>
            <option value="ogg">Ogg Vorbis</option>
          </select>
        </label>

        <label class="export-check">
          <input id="export-faster" type="checkbox" />
          <span>Faster export — uses more CPU and memory. Renders several parts of the export at once; noticeably quicker on long presets with lots of Random Interval or Scheduled sounds. Leave off if you want to keep working on the PC while it runs.</span>
        </label>

        <label class="export-check">
          <input id="export-parallel-mixdown" type="checkbox" />
          <span>Parallel mixdown (experimental) — uses more CPU, memory, and disk space. Renders every Loop-mode sound's own track at once instead of one after another, on a long export with several of them playing the whole time. Test-scale benchmarks didn't show a clear speedup, so try it on your real slow export and see — the log below now shows how long each step actually took either way. Independent of "Faster export" above — turn on either, both, or neither.</span>
        </label>

        <!-- Highpass/Lowpass/Gain used to live here too ("whole-mix
             processing"), but the owner asked directly for them to be
             removed and for whole-mix processing to live only on the
             Preset Remix tab (v0.1.125): "Get rid of the whole mix
             processing section on the export tab... the whole mix thing
             should be kept on the preset remix tab." That left exports with
             no whole-mix coloring at all even when the exported preset had
             real Preset Remix settings - flagged to the owner as a
             trade-off worth a follow-up call. Answered directly (2026-09-02):
             "Yeah it should [inherit them]. Should be the last thing applied
             tho." So there's still no UI here - currentWholeMixFilters()
             instead reads the selected preset's own saved wholeMix
             (highpass/lowpass/gain/EQ) straight from presets.list() and
             exportMix.js applies it last, over the whole mixed-down export,
             matching WholeMixChain.js's own live node order. -->
        <label>
          <span>Fade in</span>
          <input id="export-fade-in" type="number" min="0" max="60" step="0.5" value="2" />
          <span class="export-value">s</span>
        </label>
        <label>
          <span>Fade out</span>
          <input id="export-fade-out" type="number" min="0" max="60" step="0.5" value="2" />
          <span class="export-value">s</span>
        </label>

        <button id="export-run" class="btn btn-icon-text" type="button">Export</button>
        <p id="export-status" class="export-status"></p>
        <div id="export-progress-wrap" class="export-progress-wrap hidden">
          <div class="export-progress-track"><div id="export-progress-bar" class="export-progress-bar"></div></div>
          <span id="export-progress-pct" class="export-progress-pct">0%</span>
        </div>
        <div id="export-log" class="export-log hidden"></div>
      </div>
    `

    this.els = {
      preset: container.querySelector('#export-preset'),
      length: container.querySelector('#export-length'),
      format: container.querySelector('#export-format'),
      faster: container.querySelector('#export-faster'),
      parallelMixdown: container.querySelector('#export-parallel-mixdown'),
      fadeIn: container.querySelector('#export-fade-in'),
      fadeOut: container.querySelector('#export-fade-out'),
      run: container.querySelector('#export-run'),
      status: container.querySelector('#export-status'),
      progressWrap: container.querySelector('#export-progress-wrap'),
      progressBar: container.querySelector('#export-progress-bar'),
      progressPct: container.querySelector('#export-progress-pct'),
      log: container.querySelector('#export-log')
    }

    this.unsubscribeProgress?.()
    this.unsubscribeProgress = this.api.export.onProgress((payload) => this.onExportProgress(payload))

    this.els.length.addEventListener('blur', () => this.normalizeLengthField())
    this.els.length.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') this.els.length.blur()
    })
    this.els.run.addEventListener('click', () => this.runExport())

    // "Faster export" is a per-machine resource choice made right before an
    // export, so it lives here rather than in the global Settings modal - but
    // it's still persisted (via the same settings store the export:run handler
    // reads) so the last choice sticks between sessions.
    this.els.faster.addEventListener('change', () => {
      this.api.settings.setFasterExportEnabled(this.els.faster.checked)
    })
    this.els.parallelMixdown.addEventListener('change', () => {
      this.api.settings.setParallelMixdownEnabled(this.els.parallelMixdown.checked)
    })
    this.api.settings
      .get()
      .then((settings) => {
        this.els.faster.checked = Boolean(settings.fasterExport)
        this.els.parallelMixdown.checked = Boolean(settings.parallelMixdown)
      })
      .catch((err) => console.error('Export: failed to read settings', err))

    this.refresh().catch((err) => console.error('Export: failed to load presets/library', err))
  }

  normalizeLengthField() {
    const seconds = parseDuration(this.els.length.value)
    if (seconds === null || seconds <= 0) {
      this.els.length.value = '1:00:00'
      return
    }
    this.els.length.value = formatDuration(seconds)
  }

  async refresh() {
    const [presets, library] = await Promise.all([this.api.presets.list(), this.api.library.list()])
    this.presets = presets
    this.library = library
    const previouslySelected = this.els.preset.value
    this.els.preset.innerHTML = presets.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')
    if (presets.some((p) => p.id === previouslySelected)) this.els.preset.value = previouslySelected
  }

  // No Export-tab UI of its own for these (see the mount() comment above) -
  // instead inherits the exported preset's own Preset Remix `wholeMix`
  // (highpass/lowpass/gain/EQ) directly, applied last over the whole export.
  // Direct owner answer (2026-09-02) to the "keep it on Preset Remix" v0.1.125
  // ambiguity: "Yeah it should [inherit them]. Should be the last thing
  // applied tho." `wholeMix` is `null` on a preset with no Preset Remix
  // settings saved, which correctly collapses to the same all-neutral
  // shape this always returned before.
  currentWholeMixFilters(preset) {
    const wholeMix = preset?.wholeMix
    return {
      highpassHz: wholeMix?.highpassHz ?? 0,
      lowpassHz: wholeMix?.lowpassHz ?? 20000,
      gainDb: wholeMix?.gainDb ?? 0,
      eq: wholeMix?.eq ?? []
    }
  }

  async runExport() {
    if (this.exporting) return
    const preset = this.presets.find((p) => p.id === this.els.preset.value)
    if (!preset) {
      this.els.status.textContent = 'Choose a preset first.'
      return
    }
    const durationSeconds = parseDuration(this.els.length.value)
    if (!durationSeconds || durationSeconds <= 0) {
      this.els.status.textContent = 'Enter a valid length (hh:mm:ss).'
      return
    }

    const sounds = []
    for (const presetSound of preset.sounds) {
      const entry = this.library.find((e) => e.id === presetSound.soundId)
      if (!entry || entry.status !== 'ok') continue
      const playMode = entry.playMode ?? 'loop'
      sounds.push({
        soundId: entry.id,
        name: entry.name,
        playMode,
        loopStart: entry.loopStart ?? 0,
        loopEnd: entry.loopEnd ?? entry.durationSeconds ?? 0,
        filters: entry.filters ?? {},
        speedPitch: entry.speedPitch ?? null,
        crossfadeSeconds: entry.crossfadeSeconds ?? null,
        volume: presetSound.volume ?? entry.volume ?? 0.7,
        events: simulateEvents({ entry, durationSeconds })
      })
    }

    if (sounds.length === 0) {
      this.els.status.textContent = 'Nothing to export - this preset has no available sounds.'
      return
    }

    const format = this.els.format.value
    const outputPath = await this.api.export.pickDestination({ defaultName: preset.name, format })
    if (!outputPath) return

    this.exporting = true
    this.els.run.disabled = true
    this.els.status.className = 'export-status'
    this.els.status.textContent = `Exporting "${preset.name}" (${sounds.length} sound${sounds.length === 1 ? '' : 's'}, ${formatDuration(durationSeconds)})…`
    this.els.log.innerHTML = ''
    this.els.log.classList.remove('hidden')
    this.els.progressWrap.classList.remove('hidden')
    this.els.progressBar.style.width = '0%'
    this.els.progressPct.textContent = '0%'
    // How long the render itself actually took, wall-clock - reported
    // directly ("let the user know how much time it took to fully render the
    // exported audio file... make the UI feel more explicit about it having
    // finished exporting"), since a multi-hour export gives no sense of its
    // own pace otherwise.
    const renderStartedAt = Date.now()
    this.lastStepAt = renderStartedAt

    try {
      const result = await this.api.export.run({
        sounds,
        durationSeconds,
        format,
        wholeMixFilters: this.currentWholeMixFilters(preset),
        fadeInSeconds: Number(this.els.fadeIn.value) || 0,
        fadeOutSeconds: Number(this.els.fadeOut.value) || 0,
        outputPath
      })
      this.closeLastLogLineTiming()
      const elapsed = formatDuration((Date.now() - renderStartedAt) / 1000)
      // "Clear the progress bar when it finishes" - a static bar frozen at
      // 100% forever looked ambiguous (still running? actually done?) next to
      // a status line that already says so in words; hiding it here makes
      // "finished" the obvious, unambiguous state rather than something you
      // have to read the fine print to confirm.
      this.els.progressWrap.classList.add('hidden')
      if (result.ok) {
        this.els.status.className = 'export-status export-status-success'
        this.els.status.textContent = `✓ Exported to ${outputPath} — took ${elapsed}`
        playCompletionChime(true)
      } else {
        this.els.status.className = 'export-status export-status-error'
        this.els.status.textContent = `✗ Export failed after ${elapsed}: ${result.error}`
        playCompletionChime(false)
      }
    } catch (err) {
      console.error('Export failed', err)
      this.closeLastLogLineTiming()
      const elapsed = formatDuration((Date.now() - renderStartedAt) / 1000)
      this.els.progressWrap.classList.add('hidden')
      this.els.status.className = 'export-status export-status-error'
      this.els.status.textContent = `✗ Export failed after ${elapsed}: ${err.message}`
      playCompletionChime(false)
    } finally {
      this.exporting = false
      this.els.run.disabled = false
    }
  }
}
