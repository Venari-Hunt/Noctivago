<!-- Part of Noctívago's docs. See ../CLAUDE.md for the map of what lives where. -->

## Mobile player (plan, 2026-10-17)

Owner request (2026-10-17, high priority): a player-only Noctívago for phones. It imports a preset file and plays it like the PC Mixer. No editing.

### The hard requirement: playing with the screen off

An ambient/sleep app is useless if it stops when the phone locks. That rules out the obvious "reuse the renderer" route:

- **Capacitor / Tauri mobile (the React renderer in a WebView):** reuses `src/renderer/audio/` almost as-is (Web Audio, AudioWorklet, ConvolverNode all exist in Android WebView and iOS WKWebView). But the OS suspends the WebView shortly after the app leaves the foreground, and Web Audio inside it stops. Capacitor's own guidance for background audio is to move playback out of the WebView into a native player ([Capawesome](https://capawesome.io/blog/how-to-play-audio-in-the-background-in-capacitor/), [Capgo](https://capgo.app/blog/how-to-play-audio-in-the-background-in-capacitor/)). A native file player can't run our graph (crossfaded loops, scatter shots, filters, groups).
- **React Native + Expo + [`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api) (Software Mansion):** a native implementation of the Web Audio API. It has the nodes the engine uses (gain, biquad, convolver, wave shaper, AudioWorklet via `react-native-audio-worklets`), a lock-screen / notification control system (0.11), and Expo config for the iOS background audio mode and the Android media-playback foreground service. The graph runs natively, so it keeps playing when the screen is off. **Chosen.**
- **Pre-rendered file** (desktop exports a long mix, phone plays it in any player): robust but not "like the Mixer" (finite, same every night). Kept as the fallback if the spike fails.

### Shape of the solution

1. **Desktop does the heavy lifting.** A new "Export for phone" (a format in the Export plugin; owner, 2026-10-17) writes a normal `.ncvpreset` (format 2 zip) whose `audio/` holds each sound's **baked loop clip** (filters, EQ, echo, reverb, noise reduction, reverse, Doppler already baked by `loopClip.js`) re-encoded to Opus by `community/bundle.js`'s encoder. Freesound sounds are included too (the phone has no Freesound key). The manifest marks the clips as baked, so the phone skips per-sound filters. Loops longer than `MAX_BUFFER_CLIP_SECONDS` (10 min) get cut like the community "Cut to 15 s" path (`cutClip.js`), with a warning.
2. **The phone only does what must be live:** buffer loops (`loop=true`, sample-accurate), volume, per-play pitch/speed of shots, scatter and scheduled shot timing, Fluctuation (incl. pan drift), Sound Group chains and the whole-mix chain minus their reverb, master volume. A sound's own pan and speed/pitch are in its baked clip, as in the Mixer.
3. **Reverb is always baked (owner, 2026-10-17).** Spike 0.0.4 measured ~30% of one core with the screen off, almost all of it the live convolver; SoundAura (`../noctivago-mobile/docs/study-soundaura.md`) plays with near-zero CPU because the phone only mixes. Reverb is linear, so Sound Group and whole-mix reverb are applied per sound at export: loops get the wet signal wrapped circularly (seamless), scatter/scheduled shots get their tail appended. The phone runs no convolver.
4. **Shared rules, one copy (done, phase 2).** The timing and modulation rules live in `src/shared/` as DOM- and Electron-free modules: `modulator.js` (Fluctuation `Modulator`, `SoundFluctuation`, `resolveFluctuationTiming`, `pickBiasedValue`), `shotRules.js` (scatter gap and scheduled clock timing, per-shot pitch/volume/pan/speed picks, fades, shot envelope, config keys), `equalPowerRamp.js`, `groupDrift.js`, `pan.js`. They only import each other (`test/shotRules.test.js` checks), so the mobile app imports them as-is. The export's baked walks (`gainEnvelope.js`, `pitchEnvelope.js`, `panDrift.js`) use the shared timing too. The node-wiring code is rewritten for React Native; the rules are not copied.
5. **New repo** `Venari-Hunt/noctivago-mobile` (like the official plugins). Screens: preset list (import via Android "Open with" / share sheet, or a file picker), player (play/pause, master volume, per-sound volume sliders as the only "edit"), sleep timer. Lock-screen controls via the library's notification system.

### Phases (each ends in something testable)

| # | Phase | Output | Rough size |
|---|-------|--------|-----------|
| 0 | **Spike** (go/no-go) | Expo dev build: 2 looped Opus buffers + a biquad + a convolver, screen locked for 30 min. Measure: keeps playing, battery drain, no glitches | 1 session |
| 1 | Desktop "Export for phone" (**shipped** v0.1.268 + Export 1.1.0) | A "For phone" choice in the Export plugin's format picker (repo `noctivago-export`); the baking runs in core main behind `api.export`, like the other formats. Output: `.ncvpreset` with baked Opus clips; unit tests | 1 session |
| 2 | Shared rules to `src/shared/` (**done** 2026-10-17) | Desktop engine imports them; existing tests green | 1 session |
| 3 | Mobile player MVP (Android) (**part 1 shipped** 2026-10-18, mobile 0.1.0) | Import, preset list, play/pause, volumes, lock-screen controls. Part 1: file-picker import, list, play/pause, volumes, lock-screen and call handling, loops only; measured screen off: 0 missing frames, ~7% of one core. Part 2: "Open with" import, sleep timer | 2-3 sessions |
| 4 | Parity pass (**parts 1-2 shipped** 2026-10-18, mobile 0.3.0 + 0.4.0) | Scatter/scheduled (0.3.0); Fluctuation, groups, whole-mix chain (0.4.0, booked ahead on the audio clock). Gaps: no compressor in the audio library (a soft ceiling stands in for the limiter), echo as fixed repeats (no feedback loops), pan via StereoPanner with the desktop's loudness. A/B vs desktop **done** 2026-10-18 (Beach: loudness, bands, left/right within 1 dB; method in the mobile repo, `docs/ab-test.md`) | 2 sessions |
| 5 | Distribution (**GitHub shipped** 2026-10-18) | Public repo `Venari-Hunt/noctivago-mobile`, APK on its GitHub Releases (0.5.0 preview). Not on itch.io (owner, 2026-10-18). Google Play ($25 once) later; iOS ($99/year) only if wanted | 1 session |

### Phone preset file (the contract the phone app reads)

`api.export.runPhone({ presetId, outputPath })` → `src/main/phone/phoneBundle.js` (ffmpeg) + `phoneBundleCore.js` (rules, tested). The file is a normal format-2 `.ncvpreset`, so it also imports on the desktop and sounds the same. What differs:

- `manifest.phone = { version: 1 }` marks it.
- Every sound has audio (Freesound included): `audio/<name>.opus`, 96 kbps, the clip the Mixer plays (`renderClipToPath`) plus its group and whole-mix reverb.
- Each sound's `settings` = its effective settings (preset override merged; `overrides` is null) with `loopStart: 0`, `loopEnd` = clip length, `crossfadeSeconds: 0`, `speedPitch: null`, `filters: {}`. Loop mode: loop the whole buffer. Scatter/scheduled: play the whole clip per shot (reverb tail included). `scatter`, `schedule`, `fluctuation`, `playMode`, `volume` are live.
- `groups[].filters` and `wholeMix`: occlusion folded into the lowpass, `occlusion`/`reverbMix`/`reverbSizeMs` zeroed. Everything else in them is live.
- Measured on Beach (18 sounds, whole-mix reverb added for the test): 27 s, 7.1 MB, ~244 MB decoded on the phone; loop seams after the reverb wrap stay within the audio's normal step size.

**Builds without Android Studio:** Expo's EAS cloud build produces the APK (and iOS builds) without a local Android SDK or a Mac. The free tier is enough for occasional builds. It needs an Expo account.

### Risks

- **Library maturity:** `react-native-audio-api` is pre-1.0 (0.12). The spike exists to catch a missing node or a background-playback bug before anything else is built.
- **Memory:** every clip is decoded fully into RAM. A 10-minute stereo clip at 48 kHz is ~230 MB as float. Phase 1 caps phone clips (target: sum of decoded clips under ~300 MB) and warns when a preset is too heavy.
- **Battery:** live DSP draws more than a file player. Measured: the live reverb alone cost ~30% of one core with the screen off, so all reverb is baked (point 3 above). Re-measure battery per hour once phase 2 plays a real preset.

### Owner-gated

- Which phone(s) to target first (Android, iPhone, both).
- An Expo account for cloud builds (free sign-up at expo.dev, owner's email).
