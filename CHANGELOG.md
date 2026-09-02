# Changelog

User-facing notes, newest first. Shown in-app on the "What's new" screen
after an update installs, and used for GitHub release notes. One entry per
released version; keep it short and about what changed for the person using
the app, not implementation detail (that lives in `CLAUDE.md`). Write each
bullet on a single line — the in-app screen wraps them itself.

## v0.1.121 — Add a sound from a direct audio link

- The "+" add-sound menu has a new "Add from link…" option — paste a direct http(s) audio URL and it downloads and imports it, just like adding a local file.
- Not for YouTube or other video sites — only plain audio links.

## v0.1.120 — Shared presets now carry their Preset Remix mix settings too

- Exporting a preset to share (.ncvpreset) now includes its Preset Remix whole-mix settings (highpass/lowpass/gain/fade/EQ), if it has any — importing it on another machine restores them, not just the sounds.
- Older shared preset files without this still import fine.

## v0.1.119 — A chime when an export finishes

- The Export tab now plays a short chime when a preset finishes exporting to audio — a rising tone on success, a falling tone if it failed — so you don't have to keep checking a long export's progress.

## v0.1.118 — Drag to set fade in/out on Random Interval / Scheduled sounds

- Remix's waveform now has draggable fade handles for the two Fade in/out (ms) fields on Random Interval and Scheduled sounds — small triangle grips in the top corners of the trimmed region, same idea as a DAW clip's fade handles.
- Drag them like you'd drag the trim handles; the ms fields still work too and stay in sync either way.

## v0.1.117 — Exporting now blocks an update from installing until it's done

- An update that finished downloading while you were exporting a preset could restart the app and interrupt the export. Now the app waits until your export is completely finished before it installs and restarts.
- Automatic background update checks (and, for anyone with "install updates automatically" turned on, the auto-download) also pause while an export is running.

## v0.1.116 — Fix: big exports failing with "spawn ENAMETOOLONG"

- A long export, or one with a Random Interval / Scheduled sound that fires very often, could fail right at the end with "Export failed: spawn ENAMETOOLONG" — the command handed to the audio engine had grown past the operating system's length limit.
- The export now merges its pieces together in rounds so that limit is never reached, no matter how long the export or how many times a sound plays.

## v0.1.115 — Bigger, centre-neutral volume sliders

- The volume sliders (the global one and every per-sound one) are wider now, so you have more drag room and finer control.
- They're also bipolar: the centre is the sound's own level, drag left to make it quieter (down to silent), drag right to make it louder (up to double). A faint tick marks the centre.
- A newly added sound sits at the centre — its own recorded level. Sounds you'd already turned down keep exactly the volume they had; they just show left of centre now.

## v0.1.114 — Preset Remix: whole-mix processing

- New "Preset Remix" tab. Pick a preset, then shape the whole mix with a highpass, a lowpass, an overall gain, a fade-in, and a parametric EQ.
- The settings are saved on the preset and heard live on everything playing whenever you load that preset in the Mixer — the live counterpart of the Export tab's whole-mix section.
- If the preset is already the one playing, your edits preview live as you drag. Leaving the tab without saving drops the preview.
- The EQ works like the per-sound one: click the graph to add a band, drag to move it, scroll over it for width, right-click to remove.

## v0.1.113 — Composite bake won't clip

- Baking a Composite now runs a brick-wall limiter on the final mix, so welding several loud, overlapping members together can no longer clip and distort the result. Mixes that weren't near clipping are unaffected.

## v0.1.112 — Small fixes from a self-review pass

- Random Interval / Scheduled sounds with pitch variation: fixed a brief volume jump right before the end of a pitched shot, and stereo clips no longer smear when pitch-shifted.
- Export no longer hangs on a Random Interval sound whose gap is set to exactly 0 (both bounds) with "Fully random gap" off — the shot is now treated as playing back-to-back.
- The Composite tab no longer re-reads every clip's waveform on every window resize or on unrelated edits made in other tabs.
- A rare file that reports no length no longer gets a bad zero length saved for it.

## v0.1.111 — Pitch shift keeps a sound's length

- A Random Interval or Scheduled sound with pitch variation now keeps the length you trimmed it to — a pitched-up shot no longer plays faster and shorter, a pitched-down one no longer drags out. Pitch moves, timing doesn't.
- This applies both in the Mixer and in exports (exports already kept length; the Mixer now matches).
- The one exception: a Random Interval / Scheduled sound whose trim is long enough that it never gets a baked clip (over ~10 minutes) still couples pitch to speed — an unusual case for an event-style sound.

## v0.1.110 — Fixes: Composite sound picker, scheduled sounds in exports

- Fix: the Composite tab's "Select a sound" dropdowns wouldn't open — clicking one did nothing. They work now.
- Fix: a clock-scheduled sound was often missing entirely from an exported mix. A sound set to an interval (e.g. every hour) now fires on that interval measured from the start of the export — every hour, every 30 minutes, and so on.
- A sound scheduled for specific times of day (e.g. 7:30 AM) is left out of exports, since an export is just a length of time with no clock attached to it.

## v0.1.109 — Composite tab is now a weld workstation

- The Composite tab is rebuilt as a mini timeline. Each sound is a clip you drag left/right to position, with edges you drag to trim, and its own volume on the left — so you can control exactly how the pieces overlap and how loud each one sits.
- Each clip shows its waveform, and a Preview button plays the arrangement so you can judge the timing before baking.
- Filters and EQ still live in the Remix tab — remix a member first, or remix the finished composite afterward.
- Existing composites still open and re-bake in place; per-sound volume in a composite is now honest (no hidden level drop on mono sounds).

## v0.1.108 — Countdown before an automatic update installs

- With "Install updates automatically" turned on, a new update now shows a short in-app countdown before it starts downloading, with a "Not now" button to skip that update until the next launch. Previously it began installing with no warning.
- If automatic updates are off, nothing changes — you still get the "Update available" window and choose when to install.

## v0.1.107 — Fix: shared presets losing their sound settings

- Importing a shared preset (.ncvpreset with the audio bundled in) no longer substitutes your own sounds when a filename happens to match. It now always uses the audio and settings packed in the file — so a preset someone sends you plays with their trim, filters, EQ, play mode, and volume intact, instead of playing everything on loop at full volume.
- The import file picker now also accepts .zip, since chat apps like WhatsApp tend to add that extension when forwarding a preset file.
- Bundled audio inside a preset file now keeps its real filename instead of an internal id.

## v0.1.106 — Remix: full sound names, roomier top bar

- The sound name at the top of the Remix panel now scrolls sideways on hover to reveal the whole thing when it's too long for the window, and shows the full name as a tooltip — matching how the Mixer list already behaves.
- The sound picker shows a picked sound's name from the start (not its cut-off middle) and lists long names on one tidy line each instead of wrapping.
- Tightened the spacing in the Remix top bar so its buttons don't feel so crammed at a narrow window width.

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
