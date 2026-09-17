<!-- Part of Noctívago's docs. See ../CLAUDE.md for the map of what lives where. -->

## Community presets (v0.1.219)

Owner request: users upload presets from the app, and other users browse and import them. The owner made three decisions:
- **Audio:** "mix of both". Freesound sounds are re-downloaded by id, and everything else is uploaded.
- **Moderation:** a report button, with no approval queue.
- **Backend:** left to Claude.

**Backend: Cloudflare Worker + D1 + R2**, in `community/`. This is its own npm package with its own `wrangler`. Nothing in it is packaged into the app, because electron-builder only ships `out/**`.
- **Why Cloudflare:** R2 has 10 GB free and charges no egress. Supabase's free tier has 1 GB of storage and 5 GB of egress, and it pauses a project after a week of inactivity. Uploading audio made egress cost the deciding factor.
- **Identity:** no accounts. Each install generates a random 32-byte author key (`src/main/community/client.js`, stored in its own `community` electron-store) and sends it as `X-Author-Key`. The server stores only its SHA-256, and only that key can update or delete its own uploads.
- **Abuse limits:** 10 uploads and 30 reports per day, counted per salted IP hash. After 3 distinct reporters, a preset is hidden automatically. `/v1/admin/*` routes (Bearer `ADMIN_TOKEN`) list, hide, unhide, or delete presets.
- **Upload caps:** 50 MB per preset (a free-plan Worker can't receive a body over 100 MB anyway). Uploads are refused once stored bundles total 8 GB (`maxTotalBytes`, checked before any R2 write). R2 is the only part that can bill and has no spending cap; the owner explicitly worried about surprise charges, so this keeps it inside the 10 GB free tier. Workers and D1 are on the free plan, which just stops at its limits.
- **Deploy:** the owner does it once; steps are in `community/README.md`. Until then, `COMMUNITY_API_URL` (a repo *variable*, read at build time into `__COMMUNITY_API_URL__`) is empty, and the Community plugin doesn't register its tab.
- **Local server for unpackaged builds:** set `NOCTIVAGO_COMMUNITY_URL`.

**The transfer format is the existing `.ncvpreset`, with additive fields.** Old app versions ignore the new fields, and old files still import.
- **What was missing before:** `presetPortable.js` never exported Sound Groups or per-preset overrides, so any exported preset lost them. This was a pre-existing gap and is fixed for local exports too.
- **New fields:** `sounds[].overrides`, `sounds[].source` (the Freesound attribution), and `groups[]` with members stored as indexes into `sounds[]`. `presetPortableCore.js` (Electron-free, unit-tested) has `remapGroups`, which assigns fresh group ids and enforces one group per sound. `finalizeImport` is now async; it saves overrides and groups and returns `failedCount`.
- **Freesound sounds:** `buildPortableBundle(id, { skipFreesoundAudio })` omits their audio. On import, such a sound resolves in one of two ways:
  - It matches a library entry with the same `source.freesoundId`. The sender's overridable settings then become that preset's overrides, so the recipient's baseline is untouched.
  - Otherwise it's `fromFreesound`: the import downloads it with `freesound/client.js`'s new `getPreviewUrl(id)` plus the existing `addSoundFromFreesound`.
- **Size:** `community/bundle.js` re-encodes every uploaded sound to Opus 96k. Loop points, envelopes and schedules are in seconds, so they stay valid. A 6-second WAV went from 1.0 MB to about 80 KB.
- **Shared import path:** `prepareImport(buffer)` does read → analyze → stash for both a local pick and a community download.

**App side.**
- The main process handles every server call (`src/main/community/client.js`, IPC `community:*`, preload `window.noctivago.community`). The renderer never talks to the server directly.
- The `plugins/community/` tab has three views: Browse (search, sort by newest or most downloaded, infinite scroll, Import, Report), My uploads (Update… re-publishes from any local preset, Delete), and Share (pick a preset, name, author, description, tags, and a required rights checkbox).
- Import reuses the Mixer's own dialog. The plugin dispatches a synchronous `noctivago:open-preset-import` event with the analysis. The Mixer sets `detail.handled` and later dispatches `noctivago:preset-import-finished`.
- The dialog shows a "Downloads from Freesound" status for those sounds.
- All server-provided text is rendered with `textContent`.

**Verified.**
- 134-test suite (new `test/presetPortableCore.test.js` and `community/test/validate.test.js`) and a clean build.
- A scripted API walkthrough against local `wrangler dev`:
  - Rejections: no author key, no rights confirmation, a non-zip file, and another author's update or delete.
  - Search and bundle: literal `%` search, tag search, no secret columns in responses, and a byte-exact bundle round-trip.
  - Counters and moderation: download counting, 3 distinct reporters hide a preset (a repeat reporter isn't double-counted), wrong admin token rejected, unhide, delete.
- The real built app in a throwaway `--user-data-dir` profile, driven via CDP (no playback). The Share UI refused to publish without the rights box, then showed each progress step and "1 sound uploaded, 1 linked from Freesound". The card rendered `<b>` in a tag as text. Import through the card opened the Mixer dialog ("Included in this file" / "In your library") and created a preset with its group, gain, volumes, overrides, and a `.opus` library file. Report, My uploads, Update (renamed on the server) and Delete all worked.

**Server went live (v0.1.220).** The owner deployed on 2026-09-17 with Claude driving wrangler: D1 `noctivago-community` (its id is in `wrangler.toml`), R2 bucket `noctivago-community`, and Worker URL `https://noctivago-community.noctivago-community.workers.dev`. `ADMIN_TOKEN` and `IP_SALT` are set as Worker secrets; the owner keeps the admin token. The `COMMUNITY_API_URL` repo variable is set, so v0.1.220 is the first build that shows the Community tab.

Deploying `community/` changes: run `npx wrangler deploy` from `community/` (already logged in on the owner's machine). Schema changes go through `npm run db:remote`.

Testing gotcha: Cloudflare rejects any request that sets `CF-Connecting-IP` itself (403). A multi-reporter hide can only be tested against local `wrangler dev`, not production.

The production API walkthrough passed (a single reporter is counted once and doesn't hide), and test data was cleaned up afterwards.

