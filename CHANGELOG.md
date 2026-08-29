# Changelog

User-facing notes, newest first. Shown in-app on the "What's new" screen
after an update installs, and used for GitHub release notes. One entry per
released version; keep it short and about what changed for the person using
the app, not implementation detail (that lives in `CLAUDE.md`). Write each
bullet on a single line — the in-app screen wraps them itself.

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
