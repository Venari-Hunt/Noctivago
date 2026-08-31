# Changelog

User-facing notes, newest first. Shown in-app on the "What's new" screen
after an update installs, and used for GitHub release notes. One entry per
released version; keep it short and about what changed for the person using
the app, not implementation detail (that lives in `CLAUDE.md`). Write each
bullet on a single line — the in-app screen wraps them itself.

## v0.1.105 — Explicit "Fully random" for Random Interval / Scheduled

- Random Interval and Scheduled sounds now have an explicit "Fully random pitch" checkbox in Remix. Before, leaving both pitch bounds at 0 secretly meant "random across the whole ±12 semitone range" — now 0 to 0 means literally no pitch change, and the checkbox is how you ask for the fully-random behavior.
- New "Fully random gap" checkbox for Random Interval too — a fresh random wait (0–2 min) before every replay, ignoring the min/max.
- When a "Fully random" box is checked, its min/max fields grey out so it's clear they're not doing anything.
- Heads-up: any existing Random Interval sound you'd left at pitch 0/0 expecting random pitch will now play at a fixed pitch until you tick the new box. Open it in Remix and check "Fully random pitch" to restore the old behavior.

- Every pop-up window (Presets, Settings, Import, and the rest) is a bit wider now and grows with the app window instead of staying a fixed narrow size, and tall ones scroll internally instead of running off the screen.
- The "Faster export" option moved out of Settings and onto the Export tab, right where you set up an export — so you can decide per export whether it should use more of the computer or stay out of your way. Your last choice is still remembered.

## v0.1.103 — Presets list reads better

- The Presets window is wider now and grows with the app window, and each preset's name sits on its own line above its Load / Export / Delete buttons — so long preset names are fully readable instead of being cut off after a few letters.
- Hovering a preset name shows the full name as a tooltip, and a long list of presets scrolls inside the window instead of pushing it off-screen.

## v0.1.102 — Small fixes

- Fixed a sound quietly dropping back to normal Speed after it recovered from a playback stall.
- Long looping sounds now keep the crossfade seam centred correctly when played at a non-default Speed.
- Export with "Faster export" on: a failed export no longer keeps rendering in the background or leaves temp files behind — it now stops cleanly and cleans up.

## v0.1.101 — Seamless looping for long sounds

- Sounds whose loop region is too long to pre-process (anything over ~10 minutes) now loop with a smooth crossfade at the seam instead of a hard jump back to the start — the same seamless feel shorter sounds already had.
- The "Loop crossfade" slider in Remix now affects these long sounds too; set it to 0 to go back to the plain instant jump.

## v0.1.100 — What's new, on demand + an even-faster export mode

- The "What's new" screen (the changelog for the current version) can now be opened any time from Settings, not only the first launch after an update.
- New Settings option: "Faster export — uses more CPU and memory." Off by default. When on, a long export renders several parts at once instead of one after another — noticeably quicker on big presets with lots of Random Interval or Scheduled sounds — at the cost of using more of your computer while it runs.

## v0.1.99 — Much faster exports

- Exporting a preset — especially a long one with Random Interval or Scheduled sounds — is now several times faster, and its memory use stays low no matter how long the export is.
- Random Interval and Scheduled sounds are now clearly audible in the exported file. They were being turned down too far before, to the point of nearly vanishing in a long mix; the export now sums everything at its real level, the same way the Mixer does when you listen live.
- Because of that, exported files are louder overall than before. If a mix comes out hot, turn the whole-mix Gain down on the Export tab.

## v0.1.98 — Export progress

- The Export tab now shows a real progress bar and a running log of what it's doing — which sound is rendering, how many plays it's placing, the final mixdown — instead of just a spinner.

## v0.1.97 — Preset sharing now includes the audio

- Exporting a preset now packs the audio files in too, so the person you send it to gets everything in one `.ncvpreset` file — no more hunting for the source sounds.
- On import, sounds that came in the file are added automatically; ones you already have are reused, and anything still missing can be located by hand as before.
- Older config-only preset files still import fine.

## v0.1.96 — Sleep timer

- New moon button in the toolbar opens a sleep timer: pick a duration (or a quick preset) and what happens when it ends — stop all sounds, put the computer to sleep, or shut it down.
- Sleep and shutdown give you a 30-second warning you can cancel. The remaining time shows next to the button while it runs.

## v0.1.95 — What's new after updating

- After an update installs and the app restarts, a "What's new" screen now opens automatically with a rundown of what changed.
- You can still reach the update flow any time from Settings → "Check for updates…".

## v0.1.94 — Suggest a loop point

- New "Suggest a loop point" button in the Remix tab. It analyses the sound and proposes a seamless loop region — you can still adjust Start/End before saving.
- Works on files of any length; a distinct louder or quieter stretch, or a one-off sound like a gust, is kept away from the loop seam.

## v0.1.93 — Share a preset

- Export any preset to a `.ncvpreset` file and import it on another copy of the app (Presets window → Export / Import preset…).
- The file carries every sound's settings — trim, filters, EQ, play mode, everything — but not the audio itself yet. On import, sounds already in your library are matched automatically; the rest show a "Locate…" button so you can point at the audio file.

## v0.1.92 — In-app update screen

- The update process (update found, download progress, release notes) now happens in a proper in-app window instead of plain system dialogs.
- Open it any time from Settings → "Check for updates…".

## v0.1.91 — Doppler pass-by fix

- The Doppler effect now actually sounds like a sound passing by — pitch holds steady approaching, swings quickly as it passes, then holds low as it recedes, instead of just sliding down the whole time.
- New "Sharpness" control: low is a gentle glide, high is a sharp whoosh right at the closest point.

## v0.1.90 — Record with your microphone

- New "Record audio…" option in the "+" menu — record straight from your mic with a live timer and add it to your library.

## v0.1.89 — Doppler: reverse and intensity

- Doppler gained a Reverse mode (a sharp close fly-by instead of a distant approach-and-recede) and an Intensity control for how far the pitch swings.

## v0.1.88 — Doppler: draggable closest point

- Drag the gold marker on the Remix waveform to set where the sound passes closest, and how fast the pitch ramps on each side. Double-click it to re-centre.

## v0.1.87 — Taskbar play/pause

- Hover the app's taskbar icon for a Play/Pause button in the preview thumbnail.

## v0.1.86 — Undo, redo, and cancel in Remix

- Ctrl+Z / Ctrl+Shift+Z to undo and redo edits in the Remix tab.
- A Cancel button reverts everything since you opened the tab, and leaving with unsaved changes now asks first.
