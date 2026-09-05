# Changelog

User-facing notes, newest first. Shown in-app on the "What's new" screen
after an update installs, and used for GitHub release notes. One entry per
released version; keep it short and about what changed for the person using
the app, not implementation detail (that lives in `CLAUDE.md`). Write each
bullet on a single line — the in-app screen wraps them itself.

## v0.1.153 — BUG FIX: "Saved audio" preview could lock itself out mid-playback

- Fixed: saving new changes while Remix's "Saved audio" preview was actively playing could fail the render and silently kick you back to "Live edit" with the toggle greyed out — reproduced directly from the report ("it happens when the saved audio preview is playing"). Root cause: Windows briefly locks the clip file while it's being streamed for playback, and Save was treating that brief, harmless lock as a real render failure. Save now waits it out instead.
- Fixed: the live spectrogram never showed anything while previewing "Saved audio" — it only ever worked in "Live edit" mode. It now works in both.

## v0.1.152 — Export: loop an image as the video background

- New "Loop an image" video background option, alongside the black screen, a looped video file, and the visualization — pick a still image and it loops under the export for the whole video's length.
- Optional motion: None (static), Spin, or DVD bounce (the classic bouncing-logo animation).
- Uses the export's existing Fade in/out seconds to fade the image in and out too.

## v0.1.151 — Export: choose the visualization video's frame rate, better info.txt

- The audio-reactive visualization video now lets you pick 15/30/60 fps instead of always rendering at 15 — higher looks smoother but takes proportionally longer, lower stays the fastest option.
- The optional info.txt now ends with a ready-to-paste prompt for an AI assistant to turn the exported facts into an actual YouTube title, description, tags, and hashtags.

## v0.1.150 — BUG FIX: export progress bar stuck at 100%, video export slow

- Fixed: exporting with "Loop a video file" or "Audio-reactive visualization" as the video background could sit at 100% with no visible progress for a long time — that phase genuinely wasn't finished, but wasn't counted in the progress bar's own math. It now shows real progress through the video render too, and the bar only reaches 100% when everything is actually done.
- The export log now stamps each step with the real clock time it started, not just how long it took once it's over.

## v0.1.149 — Self-review pass: Sound Groups solo fix + cleanup

- Fixed: soloing a Sound Group, then soloing a single sound instead, could leave both active at once with some sounds stuck muted — soloing one now always releases the other.
- Fixed: deleting a Sound Group while it was soloed could leave its sounds muted with no way to un-mute them.
- Fixed: rapidly toggling group membership from the Mixer's own right-click menu could lose one of the changes (the same race already fixed once for the Remix tab's own group editor).
- Fixed: the Remix tab's Preset/Group live-loudness view was quietly redoing real audio-analysis work 60 times a second even when nothing changed — no audible effect, just wasted CPU.

## v0.1.148 — Preset/Group mode: a real Play button and a live loudness view

- Preset and Group mode in the Remix tab now have their own Play/Pause button — no more needing to go load the preset in the Mixer first just to hear what you're editing.
- Group mode also gets a "Solo group" button — mutes every other sound so you hear just that group.
- Both modes now show a live scrolling loudness view (the last ~10 seconds), alongside the frequency spectrogram, so you can see where the mix or group is actually louder.

## v0.1.147 — Remix, Preset Remix, and Sound Groups are now one tab

- The "Preset Remix" tab is gone — Remix now has a Sound / Preset / Group switch at the top, so editing a single sound, a whole preset's mix, or a Sound Group all happen in one place with a consistent look.
- The live spectrum analyzer now works in Preset and Group mode too, not just for a single sound — it shows real activity from whatever's actually playing in the Mixer.
- Preset and Group mode only show filters + EQ (no waveform/trim/randomization controls — those only make sense for one sound at a time).
- Fixed along the way: the Mixer's group badge could go stale after toggling membership; clicking two group-membership checkboxes quickly could lose one of the changes; switching tabs away and back while editing a group could silently kick you out of it.

## v0.1.146 — Mixer: sound group membership is now visible at a glance

- Every sound row in the Mixer now shows a small badge naming its Sound Group, if it's in one — no more right-clicking just to check.
- Click the badge to open the same right-click menu for changing or leaving the group.

## v0.1.145 — Self-review pass: bug fixes

- Fixed: extending a Remix trim past the 10-minute buffer cap and saving could leave the "Saved audio" preview looking fully up to date while actually still playing an old, unrelated clip.
- Fixed: exporting an audio-reactive visualization video with a custom background color could show slight frame-timing judder between the moving waveform/spectrum and its background.
- Fixed: the Export tab's "Clear" button (for a looping video file) left the Output setting showing "Loop a video file" even after it had reverted to the flat black screen.
- Fixed: deleting the preset currently loaded in the Mixer could leave its Sound Groups still routed even though the preset — and its groups — no longer exist.
- Right-clicking a sound to manage Sound Groups is snappier now (it was doing an unnecessary background check on every open).

## v0.1.144 — Export: audio-reactive visualization video

- New "Audio-reactive visualization" option for the Export tab's video background (alongside the flat black screen and looping your own video) — a moving waveform, spectrum, or vectorscope generated from the actual exported audio.
- Pick the style, a color (or a palette for spectrum), a background color, and a size (small/medium/large).
- Stays fast on a plain black background — a custom background color renders noticeably slower, and the tab says so.

## v0.1.143 — Sound Groups: EQ several sounds together, non-destructively

- New "Sound Groups" section on the Preset Remix tab — group some of a preset's sounds into one shared submix and EQ them together (e.g. crickets + toads to sound like they're outside a house), without touching each sound's own filters.
- Right-click any sound in the Mixer to add it to a group or create a new one on the spot — the same groups the Preset Remix tab manages.
- Each group has its own highpass/lowpass/gain and a full parametric EQ, previews live while you drag, and can start from a copy of another group's settings (from any preset).
- Groups only exist on the preset they were created for — a sound belongs to at most one group at a time.

## v0.1.142 — Remix: autosave, and the Saved-audio preview stays picked

- Remix now autosaves a few seconds after you stop editing, so the "Saved audio" preview toggle stays available without you needing to remember to hit Save.
- Switching to "Saved audio" now stays picked even if you keep editing afterward — it no longer silently jumps back to "Live edit" the instant something changes. It shows a dashed outline while what you're hearing is a bit behind your latest edit, until autosave catches up.
- Manual Save still works exactly as before, right next to the new autosave.

## v0.1.141 — Export: loop your own video instead of the black screen

- New "Choose video to loop…" option next to the Output setting (once you pick Video only or Both) — loops a video file of your own under the exported audio instead of the flat black screen.
- If your video is shorter than the export, it repeats from the start; if it's longer, it's trimmed to match. There's no crossfade at the loop point, so a video that already loops cleanly on its own works best.
- Your choice is remembered between exports. Click "Use black screen instead" to go back to the plain version.

## v0.1.140 — Export: optional info file for writing a description

- New Export checkbox: "Also write an info file" — writes a plain-text info.txt next to your export with the preset name, length, format, output type, and every included sound's name and tags.
- Meant as raw material for writing a YouTube/social media description by hand or with an AI's help — off by default.

## v0.1.139 — Export: choose audio-only, video-only, or both

- The Export tab's black-screen-video checkbox is now a 3-way choice: "Audio only" (the old default), "Video only (for YouTube)", or "Both audio and video".
- "Video only" skips writing the separate audio file entirely — your export is just the .mkv, audio already muxed inside, ready to upload straight to YouTube with nothing extra lying around next to it.
- If you had the old checkbox turned on, your first export after updating keeps that behavior (now "Both").

## v0.1.138 — Export now organizes each run into its own folder

- Exporting a preset now asks you to pick a destination folder instead of a filename, and automatically creates a subfolder named after the preset inside it — so the audio file (and the black-screen video, if you turned that on) land together instead of loose files piling up wherever you last saved.
- Exporting the same preset again reuses that same subfolder, so your exports for one preset always stay in one place.

## v0.1.137 — Active tag filter now lights up

- The Mixer's tag filter chip now clearly shows which tag is active — a solid highlighted pill instead of a subtle color tint that was easy to miss.

## v0.1.136 — Faster big exports + black-screen video for YouTube

- Faster exports of long presets with lots of Random Interval / Scheduled sounds: the "Merging track groups" step (the biggest time sink on a big export) now runs several parts at once when "Faster export" or "Parallel mixdown" is on, and a sound with no per-shot pitch or speed variation is packed into far fewer, larger batches — so most big exports skip that merge step entirely now.
- New Export option: "Also save a black-screen video for YouTube" — writes a .mkv next to the audio file (your audio over a flat black 1080p screen) so an ambient mix can be uploaded straight to YouTube. Near-instant, no audio re-encoding.

## v0.1.135 — Speed range for Random Interval / Scheduled sounds

- Random Interval and Scheduled sounds now have a Speed (min/max) range in the Remix tab, alongside the pitch and volume ranges — each replay/trigger picks a random speed within it.
- Speed changes a shot's tempo and length only; its pitch is left alone (a pitched-preserving time-stretch, same as the main Speed control). Both bounds at 100% means no speed variation.
- Applies live in the Mixer and is baked into exports the same way.

## v0.1.134 — Whole-mix processing can't clip anymore

- A preset's Preset Remix whole-mix gain and EQ (which can each add a lot of boost) now run through a brick-wall limiter, so an aggressive preset can't clip or distort the whole mix — live in the Mixer and baked into an export alike. Presets that don't boost anything are unaffected.

## v0.1.133 — BUG FIX: exporting to Opus format always failed

- Every export to Opus format failed outright with a "sample rate not supported" ffmpeg error — the export pipeline was always encoding at 44100Hz, a rate the Opus encoder doesn't accept. Fixed; Opus exports now encode at the correct 48000Hz. Every other format is unaffected.

## v0.1.132 — Add from link now works with YouTube and other video sites

- "Add from link" now handles YouTube (and hundreds of other video/audio sites, via yt-dlp) in addition to plain direct audio URLs — paste any of them and it downloads the audio.
- YouTube currently blocks anonymous downloads. A new Settings option ("YouTube/video downloads — sign in as") lets it read a browser you're already signed into YouTube in, to get past that. Off by default; reads cookies only, never a password.

## v0.1.131 — Presets: save changes without creating a new one

- A "Save changes to..." button now appears in the Presets modal whenever a preset is loaded — it updates that same preset's sound list/volumes in place, no need to type a new name and create a duplicate.
- "Save as new preset" (the old behavior) is still there, unchanged, for when you actually want a copy.

## v0.1.130 — BUG FIX: Export tab missing

- v0.1.129 accidentally broke the Export tab entirely — a stray character in a comment made the whole plugin fail to load silently. Fixed; the Export tab is back.

## v0.1.129 — Export now carries a preset's Preset Remix sound

- An exported file now applies the preset's own Preset Remix whole-mix settings (highpass/lowpass/gain/EQ), the same as what you hear live in the Mixer — applied last, over the whole mixed-down export.
- A preset with no Preset Remix settings saved exports exactly as before (no change).

## v0.1.128 — Export: experimental parallel mixdown + per-step timing

- New "Parallel mixdown (experimental)" checkbox on the Export tab. Renders every Loop-mode sound's own track at once instead of one after another on a long export — try it on a slow export and see if it actually helps; test-scale benchmarking didn't show a clear win, so this is a genuine experiment, not a guaranteed speedup.
- The export log now shows how long each step actually took, so you can see exactly where a slow export's time is going.

## v0.1.127 — Remix: hear the actual saved audio, not just the preview

- New "Live edit" / "Saved audio" toggle next to Play in Remix's sticky bar. The live preview can't be 100% accurate for everything (Doppler and Reverse have no live preview at all, and Pitch is only approximate) — switch to "Saved audio" to hear the real baked file instead, once you've saved.
- Only enabled once a save exists and still matches your current settings — it automatically switches back to "Live edit" the moment you make a new change.

## v0.1.126 — Remix: drag the sticky bar to seek

- The Remix preview's progress bar now has a little draggable circle — click or drag anywhere on it to jump to that point in the trimmed sound, whether it's playing or paused.

## v0.1.125 — Export: simpler tab, clearer finish

- Removed the Export tab's own Highpass/Lowpass/Gain section — whole-mix processing now lives only on the Preset Remix tab. Fade in/out stay on the Export tab.
- The status line now shows how long the export actually took to render, and turns green (or red on failure) so it's obvious at a glance that it's done.
- The progress bar clears when the export finishes instead of sitting frozen at 100%.

## v0.1.124 — Mixer: sound names get their own row

- Each sound's name now sits on its own full-width line at the top of its box, instead of squeezed in next to the buttons — it should stay readable even with a long name.
- If a name is still too long to fit, hovering over it scrolls it sideways to show the whole thing, same as before.

## v0.1.123 — Fix: fade handles moving with the trim handle in Remix

- Dragging a trim (cut) handle on a Random Interval / Scheduled sound's waveform used to also drag the fade-in/out balls along with it. They now stay put in their own position on the waveform while you drag the trim handle, independent of it.

## v0.1.122 — Reverb is now a real reverb

- "Reverb" in Remix used to just be a short delay dressed up to sound roomy — it's now a real convolution reverb (Reverb size + Reverb mix sliders), independent of Echo so you can use either or both together.
- Applies live while you preview, and bakes into the sound the same way every other filter does.

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
