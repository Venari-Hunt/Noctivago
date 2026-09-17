# Changelog

User-facing notes, newest first. Shown in-app on the "What's new" screen
after an update installs, and used for GitHub release notes. One entry per
released version; keep it short and about what changed for the person using
the app, not implementation detail (that lives in `CLAUDE.md`). Write each
bullet on a single line — the in-app screen wraps them itself.

## v0.1.228 — Joining a Sound Group now joins the mix

- **Fixed: a sound added to a Sound Group wasn't automatically added to the mix.** Group membership and mix membership looked linked but weren't, so a group could sit there fully configured with none of its sounds actually playing. Adding a sound to a group (from the Mixer's right-click menu, its "New group…" dialog, or Remix's Group mode member list) now adds it to the mix too. Removing a sound from the mix afterwards still leaves its group membership alone.

## v0.1.227 — Stronger panning, Speed bar, and Remix setting fixes

- **Panning is more noticeable.** Wide stereo recordings (field recordings of frogs, rain, crowds) barely moved before: a 25% pan made one side only 0.7 dB louder. They now move like they would in a mixing app (about 2 dB at 25%, 5 dB at 50%, 11 dB at 75%). Hard left and right are unchanged. Sounds you have already panned will sound a bit wider, and their saved audio re-renders once.
- **Speed for Random Interval and Scheduled sounds now uses the same three-circle bar** as Pitch, Volume and Pan, with Fully random and Bias options.
- **Fixed: Remix could overwrite a sound's settings for the loaded preset.** After visiting Group or Preset mode, opening a sound in Sound mode showed its shared default settings, and saving replaced the preset's own settings with them.
- **Fixed: just opening some Random Interval or Scheduled sounds in Remix counted as an edit** and auto-saved.

## v0.1.226 — No more example tabs

- The **Hello** tab is gone. It was a developer example that was never meant to ship, and a second deliberately broken example plugin was removed from the installer along with it.

## v0.1.225 — Pitch drift works on long sounds

- **Fixed: pitch drift did nothing audible on loops longer than 10 minutes.** Those sounds play straight from the file, and the drift only made them very slightly faster and slower. The pitch now really drifts, together with the tempo, the same way it already did for shorter sounds.
- On those long sounds, Speed still changes only the tempo, not the pitch, even while pitch drift is on.

## v0.1.224 — Credits and scene details in the export info file

- The info file an export writes now has a **Credits** section: every Freesound sound with its author, license and link, plus sounds added from a link. Creative Commons Attribution sounds are flagged as needing credit, and sounds with an unknown license are listed so you can check them.
- **Files you downloaded from freesound.org yourself are recognized** from Freesound's own file names (`12345__author__sound-name.wav`), both for new imports and for sounds already in your library. The app looks up their license when you export, and new imports get the sound's real name instead of the file name.
- The info file also describes **how the scene is set up**: each sound's volume, whether it loops, plays at random intervals or on a clock, its pan, pitch, speed, drift and per-play randomization, notable effects, Sound Groups, and whole-mix processing.
- The ready-to-paste AI prompt now asks for a description that keeps the credits exactly as written.
- Sounds imported from Freesound in the app also keep the author's description and tags.

## v0.1.223 — Remix changes reliably reach the Mixer

- **Fixed: the Mixer could erase a sound's Remix settings for the loaded preset.** If the sound had been added to the mix during the session, changing any volume in the Mixer wiped the pan (or any other Remix edit) you had just saved for that preset. Settings you already lost this way need to be set again once.
- **Fixed: Remix edits to a sound added during the session didn't reach the Mixer** until you reloaded the preset.
- **Fixed: quick back-to-back edits could leave the Mixer playing an older version** of the sound (for example the previous pan).
- The Mixer now re-renders a sound on its own whenever its saved audio no longer matches its settings, so pitch, reverse, Doppler and noise reduction keep applying and the loop stays seamless.
- "Save as new preset" in the Mixer now copies each sound's Remix settings from the loaded preset.

## v0.1.222 — Click-free Saved audio, and the crossfade moves to the middle

- **Fixed: a click every time Saved audio restarted in Remix.** The preview player inserted a short silence (about 8 ms) at each restart, whatever the loop sounded like. It now loops without a gap, the same way the Mixer plays.
- **Saved loops now follow the classic seamless-loop layout:** the second half of your trim plays first, then the first half, with the end of the trim crossfading into its start in the middle. The loop's own restart lands on one continuous piece of the recording.
- **Fixed: sounds with EQ or filters could click at the loop's joins.** Each piece is now filtered with the audio just before it, so they join cleanly.
- **New "Loop seam" view in Remix**, replacing the orange zones on the waveform: the loop drawn the way it plays, with the crossfade in the middle. Drag an edge of the crossfade to resize it, double-click an edge to reset it, or click anywhere to jump there.
- **Listen to the seam** now plays through that middle crossfade when you're on Saved audio.
- Your existing sounds re-render on their own the next time they play.

## v0.1.221 — Smoother loop seams, and a visual crossfade editor

- **Fixed: saved loops had an audible skip at the seam.** Every saved loop jumped back a fraction of a second in the middle of the clip, by exactly the crossfade length. Loops now join cleanly. Your existing sounds re-render on their own the next time they play.
- The seam blend now keeps a steady level through the crossfade instead of dipping slightly, which was noticeable on noisy sounds like rain or fire. Live playback and saved audio now blend the same way.
- **Crossfade on the waveform (Remix):** orange zones at both ends of the trim show the crossfade. Drag their dots to change its length, or double-click a dot to reset it.
- **Listen to the seam (Remix):** plays the few seconds around the loop point, through the blend, then stops. Works with both Live edit and Saved audio.
- A loop now plays as long as its trim minus the crossfade, the same in Live edit, Saved audio and the Mixer.

## v0.1.220 — Community tab is live

- New **Community** tab: browse and search ambience presets shared by other Noctívago users, and import one with a click. Sounds from Freesound are downloaded from Freesound; the rest come with the preset.
- **Share a preset** from the same tab. Your sounds are compressed before uploading, and you can update or delete what you shared under **My uploads**.
- See something that shouldn't be there? Use **Report** on its card.
- A shared preset can be up to 50 MB after compression.

## v0.1.219 — Community presets (groundwork) and fuller preset files

- **Exported preset files now keep Sound Groups and per-preset sound settings.** Before, a preset file dropped its groups and any sound tweaks saved only in that preset, so an imported mix could sound different from the original. Older preset files still import as before.
- A preset file can now list a Freesound sound instead of carrying its audio. On import it's downloaded from Freesound, or matched to the same Freesound sound already in your library.
- The import summary now tells you if any sounds couldn't be added.
- Groundwork for a new **Community** tab to browse, import and share ambience presets made by other users. It stays hidden until the community server is online.

## v0.1.218 — Groups can drift each sound on its own; per-play pan; Bias toggles

- Every Sound Group drift bar (Remix, Group mode) has a new **Each sound on its own** toggle. With it on, every sound in the group drifts separately using the group's settings, instead of the whole group moving together, so they don't all swell or wander at the same moment.
- Groups now have **Pitch drift** too. A group can only shift pitch sound by sound, so that bar is always "each sound on its own".
- Random Interval and Scheduled sounds get a **Pan** range (a random left/right position every play), and **Volume** now has "Fully random" and "Bias" like Pitch does. Pitch, Volume and Pan all use the same three-circle bar as the drift controls. Existing pitch/volume settings carry over as they were.
- When a group's drift bar is set to each sound on its own, its Random Interval and Scheduled sounds use that bar's range (and bias) for their per-play pitch, volume or pan. Remix shows a note on a sound when its group is doing this.
- **Bias** is now an on/off toggle on every drift bar and every per-play bar. With it off, the middle circle disappears and values are picked evenly between the outer circles. Existing drift keeps bias on.
- On any of these bars, when the outer circles sit together (the "no variation" default), dragging now pulls them apart in the direction you drag.
- Everything here is heard live in the Mixer and baked into exports.

## v0.1.217 — Pan drift (Fluctuation for left/right)

- Fluctuation has a new **Pan drift** bar next to Volume and Pitch drift (Remix, Sound mode): the sound slowly wanders left and right on its own. It works like the other two: drag the outer circles for how far it goes each way, the middle one for where it sits most of the time, and use "Change every", "Transition" and "Fully random" the same way. It starts from wherever the Pan slider puts the sound.
- Sound Groups get Pan drift too (Remix, Group mode): the whole group wanders together. While a group's Pan drift is on, it replaces its sounds' own pan drift; their Pan slider positions still apply. Remix shows a note on a sound when its group is doing this.
- Heard live in the Remix preview and the Mixer, and baked into exports. Export time only goes up for sounds or groups that actually use pan drift (about 1–2 seconds per 10 minutes of audio).
- Fixed the Fluctuation help text, which still said drift isn't baked into exports; it has been since v0.1.171.

## v0.1.216 — Stereo pan per sound

- New **Pan** slider in Remix (Sound mode, Filters section, under Gain): move a sound anywhere between the left and right speaker. Double-click it to center.
- You hear it live while editing and in the Mixer, and it's saved into exports exactly the same way.
- Loudness stays steady while you pan. A mono sound gets at most 3 dB louder in one speaker when panned all the way, instead of jumping.
- Effect presets (Muffled, Phone…) leave your pan alone; Reset filters re-centers it.
- Sounds left at center are untouched, and exports don't get any slower.

## v0.1.215 — Sound Group reverb sliders work again under Occlusion

- BUG FIX: on a Sound Group with Occlusion turned up, the Reverb Mix and Size sliders could do nothing at all. Occlusion set a minimum reverb (at 100%: 40% Mix, 900 ms Size), and any manual setting below that was ignored in both the Mixer and exports. Occlusion now adds its reverb on top of your own setting, so every slider move is audible at any Occlusion level.
- Heads-up: groups that combine Occlusion with a manual reverb setting will sound a little wetter than before (e.g. Occlusion 100% + Mix 25% now plays at 55% instead of 40%). Pull Mix down if it's too much.

## v0.1.214 — "Saved audio" toggle no longer greys out after saving

- BUG FIX: saving while on "Saved audio" in Remix greyed out the Live edit / Saved audio toggle and dropped you back to Live edit. Saving now keeps you on Saved audio, keeps playing from the same spot, and you hear the new version.
- The toggle is never greyed out anymore. On a sound that hasn't been saved yet, clicking it saves and renders the sound first, then switches to Saved audio.

## v0.1.213 — Pitch drift exports ~20x faster and matches the Mixer; Sound Group timing fix

- BUG FIX: in exports made with v0.1.210–v0.1.212, a Sound Group made only of Random Interval / Scheduled sounds played early — everything in it was shifted by however late the group's first sound was (e.g. thunder meant for 0:30 and 1:00 played at 0:00 and 0:30). Fixed; sounds land exactly when they should again.
- Pitch Fluctuation (slow pitch drift on a looping sound) now exports the same way the Mixer plays it: tape-style, where a higher pitch also plays a touch faster. Exports used to use a heavier method that kept speed fixed, so they didn't quite match what you heard — and it was by far the slowest part of the export. Measured on a one-hour bake: 3 minutes → 8 seconds per drifting sound. On sounds like rain the speed change isn't audible.
- This also covers drifting sounds inside a Sound Group, which was most of the time the "Applying Sound Group processing" step used to take.
- Loop sounds longer than 10 minutes keep the old method (too long to process this way in memory).

## v0.1.212 — Fluctuation baking is much faster, and export logs name their version

- Baking Fluctuation (slow volume/pitch drift) into an export was doing three full-length passes per sound — building the looped track, then re-reading it for the pitch drift, then re-reading that for the volume drift. It's now one pass. It also used to bake one sound at a time even though each is completely independent; several now bake at once. On a real export where this was 57% of the total time (two sounds, 8 minutes between them), this should be the single biggest remaining saving.
- Sound Group processing got the same treatment — a group's member sounds are no longer prepared strictly one after another.
- `export-log.txt` now starts with the app version and date it was made with, so two logs can actually be compared.

## v0.1.211 — Exports are faster again, and pitch-shifted sounds sound better

- "Faster export" now actually uses your whole machine. It was capped at 4 things at once no matter how many cores you have — that limit was set years ago against a much heavier version of the pipeline and never revisited. It now scales to your CPU and RAM (11 at once on this machine instead of 4), measured just under 2x faster on the phase that places Random Interval / Scheduled sounds.
- BUG FIX: "Faster export" was asking for a lower-quality pitch-shifting mode that turned out to be about 38% *slower* than the normal one — so the speed toggle was costing both time and quality. Removed; exports are now faster and higher quality at the same time.
- Pitch-shifted stereo sounds no longer get their stereo image smeared. The two channels were being shifted independently, which blurs the stereo picture and can hollow out the sound when heard in mono — the same problem that was fixed for live playback a while back, now fixed for exports and baked clips too. Also happens to be a bit faster.
- Mono sound files are no longer secretly converted to stereo before the heavy pitch/speed work, which was doing double the processing for nothing — roughly 1.5x faster for those.

## v0.1.210 — Big exports are much faster

- BUG FIX: a real export's "Merging N track groups…" step (the pass that combines all the short pieces of a Random Interval or Scheduled sound before the final mix) could take far longer than everything else in the export combined — one real export spent 33 of its ~49 minutes on this single step. It was accidentally paying the cost of rendering nearly the whole export's length on every merge, over and over, instead of just the small windows of time that actually had audio in them. Fixed at the root — measured roughly 4x less work overall on a synthetic worst case, and much more than that once "Faster export"'s own parallelism is counted in.

## v0.1.209 — Self-review: fixed a toggle-off race in Browse Sounds

- BUG FIX: turning off Freesound or YouTube in Browse Sounds while it was still mid-search could let its results quietly reappear a moment later, un-hiding the "load more" trigger too — most likely with YouTube, whose search takes longer. Not reported — caught by a self-review pass over v0.1.204-208.

## v0.1.208 — Browse Sounds: Freesound links, a seekable preview bar

- A Freesound card's name is now a real link to that sound's page on freesound.org, with a small link icon.
- Previewing a Freesound result now shows a playback bar under the tab bar with a draggable progress bar/time readout and a volume slider, so you can jump around a preview instead of only playing it start-to-end.

## v0.1.207 — Freesound/YouTube are now toggleable in Browse Sounds

- Two checkboxes next to the search bar let you turn Freesound and/or YouTube off — both on by default. Results from both still combine into one grid when both are on; a toggle just controls whether a source is searched at all.

## v0.1.206 — YouTube search added to Browse Sounds

- The Browse Sounds tab now searches YouTube alongside Freesound, combined into one grid and tagged by source — no separate toggle, matching how you asked for it to work.
- YouTube results show a thumbnail, channel, and duration, with a "Watch ↗" link to check a sound before importing (no in-app preview player for these, unlike Freesound's instant preview). Import reuses the same download tool "Add from link" already uses, capped at 10 minutes.
- The two sources are fully independent — if one fails or isn't available, the other keeps working on its own.

## v0.1.205 — Self-review: fixed a duplicate-import bug in "Add folder as tag/preset"

- BUG FIX: re-running "Add folder as tag" or "Add folder as preset" on a folder you'd already imported created duplicate copies of every sound in it, instead of skipping ones already in your library — the recursive scan added in v0.1.203 had lost the existing duplicate check along the way.
- BUG FIX: a single unreadable or locked file anywhere in a large nested folder could silently stop the rest of that folder (or a watched folder's background scan) from being imported at all.
- Minor: the "no audio files found" message in those two dialogs no longer says "directly inside" now that the scan checks subfolders too, and the dialogs no longer get stuck on "Adding sounds…" forever if something unexpected goes wrong.
- Also fixed two smaller issues in the new Browse Sounds tab: a failed search used to clear out whatever results were already on screen instead of leaving them there, and searching again while more results were still loading in the background could occasionally mix results from two different searches together.
- Not reported — caught by a self-review pass over v0.1.201-204.

## v0.1.204 — New "Browse Sounds" tab for internet-sourced import

- Freesound search moved out of the add-sound "+" menu's cramped dialog into its own dedicated "Browse Sounds" tab, with a lot more room to browse: a card grid instead of a narrow list, infinite scroll instead of a "Load more" button, and every result now shows its tags, description, and rating — not just a name and duration.
- New sort options (best match, highest rated, most downloaded, longest, shortest, newest) that the search always supported but the old dialog never exposed.
- Local file/folder/watch-folder/record imports are unchanged — only internet-sourced search moved. More sources (YouTube search) are planned for this tab later.

## v0.1.203 — Manual "Add folder as tag/preset" import now recurses and auto-tags too

- The "Add folder as tag" and "Add folder as preset" import dialogs now look inside subfolders too, not just files dropped directly into the picked folder — matching how watch folders already work. Each subfolder's name is automatically added as a tag, on top of whatever tag you type in the dialog itself, not instead of it: a folder named "Rain" containing a "Heavy" subfolder ends up tagged both "Rain" (what you typed) and "Heavy" (auto-derived), never one or the other.

## v0.1.202 — Fixed Live edit/Saved audio playing different loop regions in Remix

- BUG FIX: reported directly, a repeat of an earlier fix — the Live edit / Saved audio toggle "isn't working properly." Root cause this time: typing an exact Start/End value, using the Length field, or clicking "Suggest a loop point" all correctly updated the trim boxes and waveform, but never told the actual live preview engine about the new region — so Live edit kept looping whatever region it was last told about (from when the sound was loaded, or the last time you dragged a waveform handle), while Saved audio (which always plays the freshly baked file) correctly reflected your new trim. The two could sound completely different any time a trim was set by typing or Suggest rather than dragging. Also fixed: the sticky time readout next to Play/Pause could show a stale, wrong duration after any of these edits until you pressed Play, and undoing/redoing a trim change didn't update the Start/End boxes at all.

## v0.1.201 — Hardened the watch-folder subfolder scan

- Watched folders no longer risk freezing the app on a very large or deeply nested folder — the subfolder scan (added in v0.1.198) now scans in smaller chunks instead of one long blocking pass.
- It's also now safe against a folder that loops back on itself (a Windows directory junction, or certain OneDrive placeholder setups) — that used to be able to scan forever; it's now detected and skipped.
- Not a reported bug — a self-review flag the owner asked to be hardened preemptively.

## v0.1.200 — Self-review: fixed a real edge case in v0.1.199's own fix

- BUG FIX: caught in a self-review of v0.1.199 before anyone hit it — clearing the Fluctuation "Transition" field entirely (instead of typing a new number) could silently save it as instant (0) rather than falling back to the default, because an empty field and a typed 0 were read as the same thing. Now only an actual typed 0 means instant; an empty field falls back correctly.

## v0.1.199 — Fluctuation's "Transition" can now be set to 0 for an instant change

- BUG FIX: Fluctuation's "Transition" field (how long volume/pitch takes to glide to a new random value) couldn't actually be set to 0 — the field silently floored it to a small-but-not-zero glide, so "instant" was never really instant. 0 now means exactly that: the value jumps straight to the new target with no glide at all. Applies to live Mixer playback and to exports.

## v0.1.198 — Watch folders now watch subfolders too, as tags

- A watched folder now looks inside its subfolders too, not just files dropped directly into it — and each subfolder's name is automatically added as a tag to whatever's inside it. A file in `Rain/Heavy/thunder.wav` gets tagged both "Rain" and "Heavy"; a file dropped straight into the watched folder itself still gets no tag, same as before. Works both for files already there when you add the folder and for anything dropped in later while the app is running.

## v0.1.197 — Fixed the "Saved audio" preview in Remix

- BUG FIX: the Live edit / Saved audio toggle in Remix looked available but the Saved audio side often failed to actually play — reported directly as "never works as it should," happening on almost every sound, with the only workaround being a small edit and re-save. Root cause: Saved audio's file request used the same strict check the app uses to decide whether the Mixer can trust a cached clip, so it silently refused to serve the file the moment anything (even an unrelated field) no longer matched exactly what was last baked — which is nearly always true while you're actively editing. Saved audio is supposed to keep working through that (it's meant to show you the last real save, marked as a bit behind if it is) — now it does.

## v0.1.196 — Self-review: two data-integrity bugs in the last two releases

- BUG FIX: switching to a different sound in Remix right after saving/autosaving one could, in rare timing, corrupt the newly-opened sound's in-memory state with the previous sound's save results. Fixed so a save always finishes correctly for the sound it actually started on, no matter what you switch to while it's in flight.
- BUG FIX: editing a sound's settings under a preset that isn't the one currently loaded in the Mixer could leave a stale bookkeeping record behind, which in rare cases could make the Mixer play back the wrong preset's baked audio for that sound. Fixed so this always stays in sync regardless of which preset is loaded.
- Neither was reported — both were caught in a self-review of the last two releases before anyone hit them.

## v0.1.195 — Random Interval/Scheduled: bias a random pick toward a value

- Random Interval sounds' gap and pitch ranges, and Scheduled sounds' pitch range, now have an optional "Bias toward a value" checkbox — when on, one value inside your min/max range wins noticeably more often than a plain random pick, instead of every value in the range being equally likely. Off by default, so nothing changes unless you turn it on.

## v0.1.194 — Fixed pitch/loop-quality edits getting silently dropped after Save

- BUG FIX: v0.1.193's fix for "an edit doesn't reach a sound already playing" had a timing gap of its own — it told the Mixer about a Remix Save *before* the actual re-render finished, so the Mixer correctly noticed its cached copy of the sound no longer matched the freshly re-baked clip and fell back to a lower-quality streaming fallback that has no way to apply Pitch at all. Once that happened it never recovered on its own — Pitch (and anything else that only ever takes effect through the baked clip, like Doppler, Reverse, and Noise reduction) stayed silently ignored in the Mixer until something unrelated forced a refresh, even though the freshly-baked file on disk was already correct (which is also why an export of the same sound could sound noticeably different from the Mixer). Reported directly: "I change audio settings like pitch and speed and it has no results on live playback on mixer tab," alongside noise reduction/EQ seemingly not working and exports sounding different from live playback. Fixed by waiting for the real re-render to finish before telling the Mixer, so it always hears the correct, up-to-date result.

## v0.1.193 — Fixed a Remix edit not reaching a sound already playing

- BUG FIX: saving a change in Remix (Sound mode) for a sound that isn't part of the currently loaded preset's mix wrote the change to disk correctly, but a copy of that sound already playing in the Mixer never found out — it kept its old trim/filters/crossfade/Speed-Pitch/play mode/scatter/schedule until something else happened to refresh it (like switching away from Remix and back). Reported directly: disabling a Random Interval sound's pitch and speed variation "still kept pitch randomized and also speed" even after saving. Now the change reaches an already-playing sound immediately.

## v0.1.192 — Fixed missing Echo/Reverb/EQ on some Random Interval/Scheduled sounds, and richer export filenames

- BUG FIX: a Random Interval or Scheduled sound's Echo, Reverb, and parametric EQ could go silent in the Mixer (highpass/lowpass/gain still worked) whenever that sound fell back to streaming instead of playing from its baked clip — most often right after an edit, before the next play re-baked it. An exported file always had the full effect baked in regardless, so the two could sound noticeably different for the same sound (reported: a thunderclap's export had "a really strong reverb that isn't audible on the mixer tab").
- Exporting a preset to audio now names the file with a bit more than just the preset's name — the video kind (if you're also exporting video) and the export length, e.g. "Rainy Night - Black screen - 9h.wav". The destination folder still uses just the preset's own name, so re-exporting the same preset lands in the same place.

## v0.1.191 — Two bug fixes: Freesound error messages, and a stalled-looking export

- BUG FIX: a Freesound search that failed with a server error (502/503/etc.) used to dump the raw HTML error page into the dialog's status line. It now shows a plain, readable message instead.
- BUG FIX: exporting a preset with a Sound Group (or any export dense enough to need combining many pre-rendered tracks together) could sit on "Merging N track groups…" for a long time with the progress bar completely frozen, looking like the export had failed or hung. That step now reports live progress like every other phase of the export.

## v0.1.190 — Search and import sounds from Freesound.org

- New "Search Freesound…" option in the add-sound menu — search Freesound.org's library, preview results before deciding, and import one straight into your library with one click.
- Imported sounds keep their Freesound attribution (author, license, source page) and show a small "Freesound" badge in the Mixer — hover it to see the details.
- Imports the compressed preview audio, not the original file — plenty for a looping ambient sound.

## v0.1.189 — Volume envelope: shape a sound's volume over time

- Remix's Sound mode (Loop mode only) now has a Volume envelope — drag control points directly on the waveform to shape a sound's volume over time instead of one flat level, the same way Audacity's classic envelope tool works.
- Double-click empty space on the waveform to add a point, double-click a point to reset it to full volume, right-click a point to remove it, and drag any point to change how loud that moment is. The two ends of the loop are always there and can't be removed.
- Works live while previewing in Remix, and bakes into the sound so it plays correctly everywhere, including exports.

## v0.1.188 — Copy a Sound Group into another preset

- In Remix's Group mode, a group you have selected now has a "Copy to preset…" picker — pick another preset and that group's name, filters/EQ, and members are copied into it as a brand-new group there, ready to tweak independently (e.g. reusing a "crowd speaking" ambience group across a shopping-center preset and a town-square preset).

## v0.1.187 — Export tab: elapsed time/ETA, a copy-log button, and a collapsible log

- The Export tab now shows a live "elapsed / ~time left" readout next to the Export button while an export is running, instead of that only being visible after the fact.
- The log box has a "Copy log" button, so you don't have to select the whole thing by hand.
- The log can be collapsed to a single header line if you don't want it taking up space, without losing anything already logged.

## v0.1.186 — Fixed a real export crash on very long exports with pitch drift

- BUG FIX: exporting a long mix (multiple hours) with a looping sound's pitch Fluctuation turned on could fail partway through with an ffmpeg error. Root cause: a real bug in the bundled ffmpeg's own handling of very large timing-command files, which pitch-drift baking could produce on a long export. Fixed by keeping that file well under the size where it misbehaves, regardless of export length — a 9+ hour export with pitch drift on now completes reliably.

## v0.1.185 — Presets as primary context: per-preset sound overrides

- A sound's trim, filters/EQ, Speed/Pitch/Doppler/Reverse, Play mode, Scatter/Schedule config, and Loop crossfade can now be different per preset. Edit a shared sound while one preset is loaded, and only that preset's own copy changes — switch to a different preset that also has the sound, and it still sounds like whatever that preset last saved (or its plain default, if that preset never touched it).
- The app now always has a preset loaded. If you ever end up with none (a fresh install, or deleting every preset you have), a "Default" preset is created automatically — carrying forward whatever the deleted preset's own per-sound settings were, so deleting a preset never suddenly changes how your sounds are set up.
- If you edit a sound in Remix that isn't part of the currently loaded preset's mix, it changes that sound's shared defaults instead (same as before this feature existed) — a status line says so when it happens.
- Exporting a preset now correctly bakes in that preset's own per-sound overrides.

## v0.1.184 — Bulk-apply an effect preset to several sounds at once

- The Mixer's sound list has a new "Select…" button — turns on a checkbox next to each sound so you can select several at once.
- With sounds selected, a small bar shows the same effect presets Remix has (Muffled, Over the Phone, On the Radio, Distant, Echo, Reverb, Underwater) plus "Reset filters" — click one to apply it to every selected sound in one go, instead of opening each one in Remix individually.
- Only highpass/lowpass/gain/echo/reverb change (matching what a preset changes on a single sound in Remix); each sound's own EQ is left untouched.

## v0.1.183 — New-preset options, an Autosave toggle, and a "Save as new preset" bug fixed

- Creating a new preset from the Presets window now offers two clear options: "New blank preset" (starts empty, for building up from scratch) and "Save current mix as new preset" (a renamed, clearer "Save as new preset" — snapshots everything currently in the mix).
- BUG FIX: "Save as new preset" never carried over the current preset's whole-mix filters/EQ or Sound Groups — only the sound list. Fixed; a new preset saved from the current mix now carries all of it.
- New "Autosave changes to the loaded preset" checkbox in the Presets window — autosave (added in v0.1.178) is on by default, but can now be turned off if you'd rather save by hand with the "Save … now" button.

## v0.1.182 — Sound Group "Occlusion" + a Preset/Group Reverb save bug fixed

- New "Occlusion" slider on a Sound Group's filters (Remix — Group mode): one knob for "this group sounds like it's behind a wall or door" — pulls the lowpass down and pushes reverb up together, instead of balancing two sliders by ear. Combines with whatever Lowpass/Reverb you've already set, only ever adding muffling on top.
- BUG FIX: changing only the Reverb size/mix sliders in Preset mode or Group mode never lit the Save button, so a reverb-only edit could be silently lost if you navigated away without touching anything else first. Fixed — reverb changes now count as unsaved changes like every other filter.

## v0.1.181 — Sound Groups: group-by option, and a color per group

- The Mixer's "Group by" dropdown has a new option, "Group: Sound Group" — bucket your sound list by which Sound Group each sound belongs to, with an "Ungrouped" section at the end.
- Each Sound Group's badge on a sound row now gets its own distinct, consistent color, instead of every group looking the same purple — makes it easier to tell groups apart at a glance in a longer list.
- Fixed the group badge sitting far off to the right of a short sound name instead of right next to it — it was a real layout bug, not intentional spacing.

## v0.1.180 — Sleep timer can turn off the displays and keep playing

- New sleep-timer action: "Turn off the displays, keep the sound playing". Set a timer (or a time of day) and when it's up, your monitors switch off while the mix keeps going — for falling asleep to a mix without a lit screen in the room.
- It's not sleep or shutdown — only the displays turn off, and any mouse move or key press wakes them straight back up. The sound is never touched.
- Sits alongside the existing "Stop all sounds", "Put the computer to sleep", and "Shut down" actions in the sleep-timer window. There's no 30-second warning for this one since nothing destructive happens.

## v0.1.179 — Pitch drift now bakes into exports

- If a looping sound has a Fluctuation pitch drift (Remix — Sound mode), an exported file now bakes that slow pitch wander in, the same way volume drift already did. Before, exports played it at a steady pitch.
- One take of the drift is rendered in (it's random, so each export's is slightly different) — same as how a Random Interval sound's timing is baked.
- Volume + pitch drift together both bake now. A sound with no drift, or drift set to pitch-off, exports exactly as before.
- Pitch drift is a per-sound thing, so this doesn't apply to a whole preset's or a Sound Group's drift (those are volume-only, as before).

## v0.1.178 — Presets autosave the mix

- Load a preset, then add or remove a sound or drag a volume, and the change now saves back into that preset automatically — no need to hit a Save button. This matches how the Remix tab already autosaves.
- Only the preset's sound list and per-sound volumes autosave. The master volume is not part of a preset (it's remembered separately). Whole-mix and Sound Group filters still have their own Save in the Remix tab's Preset/Group modes.
- The Presets window's button is now labelled "Save … now" for when you want to save immediately, with a note that changes save on their own.
- Removing the last sound from a loaded preset does not empty the preset — it keeps its last non-empty state, same as before.

## v0.1.177 — Noise reduction in Remix (Sound mode)

- New per-sound "Noise reduction" in the Remix tab's Filters section — reduces steady background noise (tape hiss, mains hum, an air conditioner) on a noisy clip, on top of what the Noise gate already does for the silent gaps.
- Two-step, like Audacity's: turn it on, then set "Noise from" / "Noise to" (in seconds) to a stretch of the trimmed loop region that is background noise only — no events. "Noise sample from loop start" fills in the first ~1.5 seconds for you. On Save, it measures that stretch and subtracts its noise fingerprint from the whole clip. "NR strength" controls how aggressively (higher removes more but can start to sound watery).
- Bake-only — there is no live preview for it (there's no real-time way to do this kind of processing). Save, then flip the preview toggle to "Saved audio" to hear the result. It bakes into an exported file like every other filter.
- Follow-ups noted for later: a frequency crossover (denoise only the hiss, leave the bass), and picking the noise region on the waveform instead of typing seconds.

## v0.1.176 — Fluctuation: real seconds instead of percentages, plus a "Fully random" option

- The Fluctuation controls (Remix — Sound, Preset and Group mode) no longer use vague 0–100% sliders for their timing. "Change every" is now two number boxes in seconds — the shortest and longest gap before the drift picks a new target — and "Transition" is a number box in seconds for roughly how long each glide takes. You can read and set the timing directly instead of guessing what a percentage meant.
- New "Fully random" checkbox on each drift axis (volume, and pitch in Sound mode). Tick it and the drift ignores the three circles entirely and roams the whole range — genuinely random volume, or genuinely random pitch — the same idea as the "Fully random pitch/gap" options on Random Interval sounds.
- Your existing drift settings carry over automatically — the old percentage values are converted to the equivalent seconds, so anything you'd already set keeps behaving the same.
- Exports that bake in volume drift use the same new settings.

- v0.1.172's fix wasn't enough — you reported the loud, sustained synth-like noise still comes back with per-shot random Speed on a thunderclap. The narrower guard it added still let the buzzy time-stretch run in a range where it can artifact.
- Per-shot Speed on a Random Interval / Scheduled sound is now always a plain tape-style speed-up in the live Mixer: it changes the shot's tempo and length and shifts its pitch along with it (a fast thunderclap sounds a little higher, like a record sped up). It is no longer routed through the pitch-preserving time-stretch at all, so it can't buzz. Per-shot Pitch still keeps the shot's length exactly as before.
- Exports are unaffected — they already keep Speed and Pitch independent with a higher-quality offline process that doesn't have this problem.
- If you want per-shot Speed to keep pitch fixed in the live mix too (the way it briefly did), tell me — that needs a different approach and I'll plan it separately.

## v0.1.174 — Noise gate in Remix (Sound mode)

- New per-sound "Gate" controls in the Remix tab's Filters section: Threshold, Reduction, Attack, and Release. The gate quiets a sound whenever it drops below the threshold — useful for cutting a hissy or rumbly noise floor in the gaps between events on a self-recorded or noisy clip.
- Threshold at the far left, or Reduction at 0, means off (the default). It applies live in the preview and the Mixer, and bakes into an exported file, like every other filter.
- A longer Release keeps a fading tail from chattering. A frequency-selective mode (gate only the hiss, always let the bass through) is a possible follow-up.

## v0.1.173 — Fix: your mix was empty after a restart until you re-added sounds

- If you closed the app while the mix was paused (not playing), the next launch opened with every sound showing "Add" instead of "In Mix", the Current Mix section empty, and the "Play all" button doing nothing when clicked — you had to click each sound back into the mix by hand. Your mix is now restored on launch: the sounds you had in it show as "In Mix" again and "Play all" starts them.
- Auto-resume (the mix starting on its own if it was playing when you closed the app) is unchanged — this only fixes the case where it was paused.

## v0.1.172 — Likely fix for the "weird synth-like sound" during a mix

- A Random Interval / Scheduled sound with a wide per-shot Speed range (roughly 170%+, or a bit less when combined with a downward pitch roll) could produce a loud, sustained, metallic/synth-like sound on a broadband hit like a thunderclap — the time-stretch used for that couldn't compress that aggressively without buzzing. Those shots now fall back to a plain speed-up (which also shifts pitch, like an old tape machine) instead — clean, no buzz.
- This matches what you found: disabling per-shot random speed made the sound go away. Please re-enable it and let me know if the noise is truly gone or still happens.

## v0.1.171 — Fluctuation now bakes into exports

- Volume Fluctuation (the slow, random volume drift you can set on a looping sound, a whole preset's mix, or a Sound Group) is now baked into an exported file — before, exports ignored it entirely and played a steady level. One fixed take of the drift is rendered into the file, the same way a Random Interval sound's timing is baked as one realization.
- Also fixed a related gap: a preset's whole-mix Echo and Reverb (set on the Remix tab's Preset mode) were silently left out of exports too — they now bake in, applied last over the whole mix, matching how they sound live.
- Pitch Fluctuation still isn't baked into exports (only volume) — that's a harder problem and stays a follow-up.

## v0.1.170 — Sleep timer survives a restart, and can end at a set time

- A running sleep timer is no longer lost when the app closes and reopens (including an auto-update restart) — it comes back with the time still remaining. If it already ran out while the app was closed, it only still acts if that was in the last few minutes; a timer whose moment passed long ago is quietly dropped.
- The sleep-timer dialog now has an "At a set time" mode alongside "In a number of minutes" — pick a time of day and it counts down to the next time the clock hits it (today, or tomorrow if it's already passed). Your last-used mode and time are remembered.

## v0.1.169 — Add from link: length cap + real progress

- "Add from link" now has a "Max length to download" field, defaulting to 10 minutes — a link to a multi-hour stream no longer downloads in full (you can loop and crossfade a short clip in the app anyway). Set it to 0 to grab the whole thing.
- The dialog now shows a real progress bar and a running log of what's happening (extracting the page, picking a format, downloading, converting) instead of a bare "Downloading…".
- A failed link now leads with a short reason, with the full technical detail in the log below it.

## v0.1.168 — Fluctuation now tells you it saved

- Changing a sound's Fluctuation (volume/pitch drift) in the Remix tab's Sound mode now lights up the Save button and, a moment later, confirms "saved automatically" under it — before, it saved silently with no sign anything happened, which looked like it wasn't saving or working at all.
- Hitting Save after only changing Fluctuation no longer re-renders the loop clip (nothing about the baked audio changed) — it just saves the setting.
- Added a note in the Fluctuation section when you're auditioning the "Saved audio" preview: drift only plays in the "Live edit" preview and in the Mixer, never in the baked clip.

## v0.1.167 — Fluctuation for Preset and Group modes

- The Remix tab's Preset and Group modes now have their own Fluctuation control (alongside the filters and EQ) — slow, random volume drift on the whole mix, or on just one group's sounds. Weather rolling through: the ambience swelling and fading on its own.
- Volume only here (no pitch): a whole mix or a group is several sounds at once, so there's nothing single to pitch-shift — pitch drift stays a per-sound thing in Sound mode.
- Same three-circle bar as Sound mode (quietest / loudest / where it sits most), plus Change rate and Transition. Applies live in the Mixer and is saved on the preset; not baked into an export yet.

## v0.1.166 — The top-bar preset name opens Presets

- Clicking the active-preset pill in the top bar now opens the Presets window, so it's a one-tap way to load a different preset (or pick one when none is loaded), not just a label.

## v0.1.165 — Top bar: which preset is loaded

- The toolbar now always shows which preset the mix is built from, just left of the Play-all button — an accent-outlined pill with the preset's name, or a dim "No preset" when you haven't loaded one.
- Updates as you load, save, rename, or delete presets, and shows the right one again on the next launch (the app already reloads your last-active preset on startup).

## v0.1.164 — Remix: Fluctuation — slow volume and pitch drift on a looping sound

- New "Fluctuation" section in the Remix tab (Sound mode): make a looping sound's volume and/or pitch drift slowly and randomly over time — wind gusting stronger and weaker, rain swelling and fading, something drifting closer and further.
- Each one is a bar with three circles: the outer two set the lowest and highest it drifts to, the middle one sets where it sits most of the time. Two sliders control how often it picks a new target (Change rate) and how fast it glides there (Transition).
- Volume drift rides below the sound's set level (it dips and returns, never boosts into distortion). Pitch drift is a small semitone wobble.
- Applies live in the Mixer and in the Remix preview, and is remembered across restarts. Not baked into an export yet, and not available for Random Interval / Scheduled sounds (which have their own per-shot randomization). Preset and Group modes are a planned follow-up.

## v0.1.163 — Remix EQ graph: zoom in/out and an Invert button

- The Parametric EQ graph (Sound, Preset, and Group mode alike) can now be zoomed in and out on the frequency axis — two new buttons next to Reset EQ, or scroll the mouse wheel over any empty part of the graph (away from a node) to zoom centered on the cursor. Useful for placing a band precisely in a crowded frequency range.
- A new Invert button flips every band's gain at once (boosts become cuts and vice versa) — handy for turning a curve that boosts a problem range into one that cuts it, without re-dragging every node by hand.

## v0.1.162 — Two bug fixes: leftover export temp files, and hidden Sound Group members

- If an export (or Composite bake) ever got interrupted by a crash, a force-quit, or the app closing mid-render, its temporary working files could be left behind in a hidden folder with nothing to ever clean them up — reported directly ("temporary export files are taking up some space on my machine"). The app now clears that folder automatically every time it starts, since anything still there at that point is always safe to remove.
- Reported directly: adding a sound to a Sound Group via the Mixer's right-click menu could leave it invisible in the Remix tab's Group mode member list, even though the group's own EQ was already correctly applied to it. The member checklist now always shows every sound actually in the group, not just the ones already saved into the preset's own sound list.

## v0.1.161 — Remix: Preset and Group modes now match Sound mode's full EQ/filter toolkit

- Preset mode and Group mode's Parametric EQ is now the exact same full-featured module Sound mode has: A/B compare, per-band Mute/Solo, the Steep/Gentle slope control, and the same ±24dB range — not the older, scoped-down version.
- Both modes also gained Reverb (alongside the existing High-pass/Low-pass/Gain/Echo), the one-click effect Presets (Muffled/Phone/Radio/Distant/Echo/Reverb/Underwater), and a "Reset filters" button — the same tools Sound mode already had.
- Everything applies live and bakes into exports, matching what you hear in the Mixer.

## v0.1.160 — Preset/Group filters can now include Echo too

- The Remix tab's Preset mode and Group mode (whole-mix and Sound Group filters) now have Echo delay/decay sliders, alongside the existing High-pass/Low-pass/Gain and EQ — the same Echo effect single sounds already had. Applies live and in exports.
- Part of the owner's own direction that Echo isn't single-sound-specific; Reverb is a planned follow-up, not included yet (it needs a different export pipeline change).

## v0.1.159 — Two safety/correctness bug fixes: Sound Group EQ in exports, and volume/preset reset on restart

- Fixed: a Sound Group's own EQ/filters (highpass/lowpass/gain/parametric EQ) sounded right live but had no effect at all on an exported file — the group's member sounds exported as if they were never grouped. They're now routed through the group's own processing during export too, exactly like they are live.
- Fixed (reported as actively harmful — "if the app autoupdates while i'm sleeping... it goes REALLY LOUD AND SHARP"): the master volume slider, which preset was loaded, and any Sound Group EQ shaping the mix all silently reset every time the app restarted or updated. All three are now remembered and restored automatically on the next launch, before anything resumes playing.

## v0.1.158 — Export: info.txt's AI prompt asks for hashtags in one place only

- Removed the duplicate "3-5 hashtags" request from the AI prompt — it's now only asked for once, as part of the description.

## v0.1.157 — Export: info.txt's AI prompt now asks for hashtags in the description too

- The ready-to-paste AI prompt in info.txt now asks for the description to already end with its own 3-5 hashtags, not just as a separate closing item.

## v0.1.156 — Export: clearer message when the disk runs out of space

- A failed export now leads with a plain-language reason when it's a known, common cause (currently: running out of disk space) instead of just a raw ffmpeg error code and technical dump — the full detail is still there below it.
- Fixed: a failed export could leave a large, corrupted, partially-written file sitting at the destination you picked. It's now cleaned up automatically.

## v0.1.155 — BUG FIX: exporting with a video/image background but no file chosen

- Fixed: picking "Loop a video file" or "Loop an image" as the export's video background without actually choosing a file ran anyway and silently produced a plain black-screen video with no warning. Export now tells you to choose a file first (or switch the background) instead.
- Fixed a related progress-bar inaccuracy in that same silent-fallback case.

## v0.1.154 — Export: the on-screen log now saves to a file too

- Every export now writes its full log (with real timestamps and per-step timing) as `export-log.txt` next to the exported audio/video, so an overnight or unattended export's log survives even if you weren't there to see it.

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
