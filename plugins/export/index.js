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

const VIDEO_MODE_LABELS = {
  'audio-only': 'Audio only',
  'video-only': 'Video only (for YouTube) - a .mkv with the audio muxed inside',
  both: 'Audio + video (a standalone audio file and a .mkv, both with the same audio)'
}

// Raw material for a YouTube/social description, not a finished one - plain
// facts about what was exported (inbox: "export an info file... to help
// populate an AI-written YouTube/social description"). Built in the renderer
// (has the preset/library data already in memory) and handed to
// export:writeInfoFile as a plain string, since the renderer has no direct
// fs access - see ipc.js's own comment on that handler.
function buildInfoFileText({ presetName, durationSeconds, format, videoMode, videoBackground, loopVideoName, visualizationSummary, soundInfoList, fadeInSeconds, fadeOutSeconds }) {
  const lines = [presetName, '']
  lines.push(`Length: ${formatDuration(durationSeconds)}`)
  lines.push(`Format: ${String(format).toUpperCase()}`)
  lines.push(`Output: ${VIDEO_MODE_LABELS[videoMode] ?? videoMode}`)
  if (videoMode !== 'audio-only') {
    const videoDesc =
      videoBackground === 'file' && loopVideoName
        ? `looping "${loopVideoName}"`
        : videoBackground === 'visualization'
          ? visualizationSummary
          : 'flat black screen'
    lines.push(`Video: ${videoDesc}`)
  }
  lines.push(`Fade in / out: ${fadeInSeconds}s / ${fadeOutSeconds}s`)
  lines.push('')
  lines.push(`Sounds included (${soundInfoList.length}):`)
  for (const s of soundInfoList) {
    lines.push(`- ${s.name}${s.tags.length ? ` — tags: ${s.tags.join(', ')}` : ''}`)
  }
  return lines.join('\n')
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

        <label>
          <span>Output</span>
          <select id="export-video-mode">
            <option value="audio-only">Audio only</option>
            <option value="video-only">Video only (for YouTube)</option>
            <option value="both">Both audio and video</option>
          </select>
        </label>
        <p class="export-hint">"Video" writes a .mkv next to (or instead of) the audio file — YouTube needs a video track, this adds one without a separate step. Choose what plays below.</p>

        <div id="export-video-background-row" class="export-loop-video-row hidden">
          <label>
            <span>Video</span>
            <select id="export-video-background">
              <option value="black">Flat black screen (fastest, near-instant)</option>
              <option value="file">Loop a video file</option>
              <option value="visualization">Audio-reactive visualization</option>
            </select>
          </label>

          <div id="export-video-file-section" class="export-video-subsection hidden">
            <div class="export-loop-video-buttons">
              <button id="export-choose-video" class="btn" type="button">Choose video to loop…</button>
              <button id="export-clear-video" class="btn" type="button">Clear</button>
            </div>
            <p id="export-video-path" class="export-hint export-video-path"></p>
            <p class="export-hint">If it's shorter than the export it repeats from the start with a hard cut at the seam (no crossfade), so a video that already loops cleanly on its own works best.</p>
          </div>

          <div id="export-viz-section" class="export-video-subsection hidden">
            <label>
              <span>Style</span>
              <select id="export-viz-type">
                <option value="waveform">Waveform</option>
                <option value="spectrum">Spectrum</option>
                <option value="vectorscope">Vectorscope</option>
              </select>
            </label>
            <label id="export-viz-color-row">
              <span>Color</span>
              <input id="export-viz-color" type="color" value="#9ece6a" />
            </label>
            <label id="export-viz-palette-row" class="hidden">
              <span>Palette</span>
              <select id="export-viz-palette">
                <option value="intensity">Intensity</option>
                <option value="rainbow">Rainbow</option>
                <option value="fire">Fire</option>
                <option value="magma">Magma</option>
                <option value="cool">Cool</option>
                <option value="moreland">Moreland</option>
              </select>
            </label>
            <label>
              <span>Background</span>
              <input id="export-viz-bg-color" type="color" value="#000000" />
            </label>
            <label>
              <span>Size</span>
              <select id="export-viz-size">
                <option value="small">Small (854×480)</option>
                <option value="medium">Medium (1280×720)</option>
                <option value="large">Large (1920×1080)</option>
              </select>
            </label>
            <p class="export-hint">Draws a moving waveform/spectrum/vectorscope from the actual exported audio. Stays fastest on a plain black background — a custom background color renders noticeably slower (it has to blend two images per frame instead of one).</p>
          </div>
        </div>

        <label class="export-check">
          <input id="export-info-file" type="checkbox" />
          <span>Also write an info file (preset name, length, format, sounds + tags) next to the export — raw material for writing a YouTube/social description by hand or with an AI's help.</span>
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
      videoMode: container.querySelector('#export-video-mode'),
      videoBackgroundRow: container.querySelector('#export-video-background-row'),
      videoBackground: container.querySelector('#export-video-background'),
      videoFileSection: container.querySelector('#export-video-file-section'),
      chooseVideo: container.querySelector('#export-choose-video'),
      clearVideo: container.querySelector('#export-clear-video'),
      videoPath: container.querySelector('#export-video-path'),
      vizSection: container.querySelector('#export-viz-section'),
      vizType: container.querySelector('#export-viz-type'),
      vizColorRow: container.querySelector('#export-viz-color-row'),
      vizColor: container.querySelector('#export-viz-color'),
      vizPaletteRow: container.querySelector('#export-viz-palette-row'),
      vizPalette: container.querySelector('#export-viz-palette'),
      vizBgColor: container.querySelector('#export-viz-bg-color'),
      vizSize: container.querySelector('#export-viz-size'),
      infoFile: container.querySelector('#export-info-file'),
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
    this.els.videoMode.addEventListener('change', () => {
      this.api.settings.setExportVideoMode(this.els.videoMode.value)
      this.updateVideoBackgroundRowVisibility()
    })
    this.els.infoFile.addEventListener('change', () => {
      this.api.settings.setExportInfoFileEnabled(this.els.infoFile.checked)
    })
    this.els.videoBackground.addEventListener('change', () => {
      this.api.settings.setExportVideoBackground(this.els.videoBackground.value)
      this.updateVideoBackgroundSubsectionVisibility()
    })
    // "Choose video to loop…" opens a native file dialog (main-process only,
    // no direct fs access here); the picked path is persisted immediately by
    // the IPC handler itself (mirrors exportVideoMode's own "settings are the
    // source of truth, not the run payload" shape), so this side only needs
    // to update the display.
    this.els.chooseVideo.addEventListener('click', async () => {
      const filePath = await this.api.export.pickVideoFile()
      if (filePath) this.setLoopVideoPath(filePath)
    })
    this.els.clearVideo.addEventListener('click', async () => {
      await this.api.settings.setExportLoopVideoPath(null)
      this.setLoopVideoPath(null)
    })
    this.els.vizType.addEventListener('change', () => {
      this.api.settings.setExportVisualizationOptions({ type: this.els.vizType.value })
      this.updateVizFieldVisibility()
    })
    this.els.vizColor.addEventListener('input', () => {
      this.api.settings.setExportVisualizationOptions({ color: this.els.vizColor.value })
    })
    this.els.vizPalette.addEventListener('change', () => {
      this.api.settings.setExportVisualizationOptions({ palette: this.els.vizPalette.value })
    })
    this.els.vizBgColor.addEventListener('input', () => {
      this.api.settings.setExportVisualizationOptions({ bgColor: this.els.vizBgColor.value })
    })
    this.els.vizSize.addEventListener('change', () => {
      this.api.settings.setExportVisualizationOptions({ size: this.els.vizSize.value })
    })
    this.api.settings
      .get()
      .then((settings) => {
        this.els.faster.checked = Boolean(settings.fasterExport)
        this.els.parallelMixdown.checked = Boolean(settings.parallelMixdown)
        this.els.videoMode.value = settings.exportVideoMode ?? 'audio-only'
        this.els.infoFile.checked = Boolean(settings.exportInfoFile)
        this.setLoopVideoPath(settings.exportLoopVideoPath ?? null)
        this.els.videoBackground.value = settings.exportVideoBackground ?? 'black'
        this.els.vizType.value = settings.exportVisualizationType ?? 'waveform'
        this.els.vizColor.value = settings.exportVisualizationColor ?? '#9ece6a'
        this.els.vizPalette.value = settings.exportVisualizationPalette ?? 'intensity'
        this.els.vizBgColor.value = settings.exportVisualizationBgColor ?? '#000000'
        this.els.vizSize.value = settings.exportVisualizationSize ?? 'medium'
        this.updateVideoBackgroundRowVisibility()
        this.updateVideoBackgroundSubsectionVisibility()
        this.updateVizFieldVisibility()
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

  // Renderer has no Node `path` module (sandboxed, per this app's plugin
  // security model) - a plain basename split covers both Windows and POSIX
  // separators, which is all this display needs.
  setLoopVideoPath(filePath) {
    this.loopVideoPath = filePath || null
    this.els.videoPath.textContent = filePath
      ? `Looping: ${filePath.split(/[\\/]/).pop()}`
      : 'No video chosen — using the flat black screen.'
    this.els.clearVideo.disabled = !filePath
  }

  // The video-background choice only makes sense once a video track is
  // actually being produced - hidden entirely under 'audio-only' rather than
  // shown disabled, matching this app's other mode-gated-field convention
  // (e.g. Remix's scatter/schedule sections).
  updateVideoBackgroundRowVisibility() {
    this.els.videoBackgroundRow.classList.toggle('hidden', this.els.videoMode.value === 'audio-only')
  }

  // Only one of the two sub-sections (file picker / visualization controls)
  // is relevant at a time, matching which of the three renderVideoOutput
  // branches (exportMix.js) would actually run.
  updateVideoBackgroundSubsectionVisibility() {
    const mode = this.els.videoBackground.value
    this.els.videoFileSection.classList.toggle('hidden', mode !== 'file')
    this.els.vizSection.classList.toggle('hidden', mode !== 'visualization')
  }

  // Spectrum picks its color from a fixed palette (showspectrum's own
  // `color` option is a named scheme, not an arbitrary hex - see
  // visualizationVideo.js), so the raw color picker only applies to
  // Waveform/Vectorscope.
  updateVizFieldVisibility() {
    const isSpectrum = this.els.vizType.value === 'spectrum'
    this.els.vizColorRow.classList.toggle('hidden', isSpectrum)
    this.els.vizPaletteRow.classList.toggle('hidden', !isSpectrum)
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
    // Parallel to `sounds` (same filter, same order) but scoped to just what
    // the optional info.txt describes - kept separate rather than bolted
    // onto the `sounds` payload itself, since that array is forwarded
    // straight to exportMix.js and tags mean nothing to the render pipeline.
    const soundInfoList = []
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
      soundInfoList.push({ name: entry.name, tags: entry.tags ?? [] })
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
    const fadeInSeconds = Number(this.els.fadeIn.value) || 0
    const fadeOutSeconds = Number(this.els.fadeOut.value) || 0

    try {
      const result = await this.api.export.run({
        sounds,
        durationSeconds,
        format,
        wholeMixFilters: this.currentWholeMixFilters(preset),
        fadeInSeconds,
        fadeOutSeconds,
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
        // 'video-only' deletes the standalone audio file once the video
        // exists (see exportMix.js), so outputPath no longer points at
        // anything real in that case - lead with the video instead.
        let msg = result.audioRemoved
          ? `✓ Exported video to ${result.videoPath} — took ${elapsed}`
          : `✓ Exported to ${outputPath} — took ${elapsed}`
        if (result.videoPath && !result.audioRemoved) msg += `\n✓ Video: ${result.videoPath}`
        // A failed video in 'video-only' mode leaves the audio file in place
        // rather than deleting the only output that actually succeeded (see
        // exportMix.js) - the message above already names that audio path,
        // so this just explains why it's there instead of a video.
        else if (result.videoError) msg += `\n✗ Video render failed: ${result.videoError}`
        if (this.els.infoFile.checked) {
          const infoContent = buildInfoFileText({
            presetName: preset.name,
            durationSeconds,
            format,
            videoMode: this.els.videoMode.value,
            videoBackground: this.els.videoBackground.value,
            loopVideoName: this.loopVideoPath ? this.loopVideoPath.split(/[\\/]/).pop() : null,
            visualizationSummary: `${this.els.vizType.value} visualization (${this.els.vizSize.value})`,
            soundInfoList,
            fadeInSeconds,
            fadeOutSeconds
          })
          const infoResult = await this.api.export.writeInfoFile({ outputPath, content: infoContent })
          msg += infoResult.ok ? `\n✓ Info file: ${infoResult.infoPath}` : `\n✗ Info file failed: ${infoResult.error}`
        }
        this.els.status.textContent = msg
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
