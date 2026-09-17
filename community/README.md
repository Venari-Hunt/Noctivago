# Noctívago community presets server

The server behind the app's **Community** tab. It's a Cloudflare Worker with:

- **D1**, a database that holds the preset list.
- **R2**, file storage that holds each preset's `.ncvpreset` bundle.

Everything fits in Cloudflare's free plan, and R2 charges nothing for downloads.

The app only shows the Community tab when a build knows this server's URL. The URL comes from the `COMMUNITY_API_URL` repo variable (see step 6).

## One-time setup (about 15 minutes)

Run each command from this `community/` folder.

1. **Create a free Cloudflare account** at <https://dash.cloudflare.com/sign-up>.
2. **Log in from this computer.** This opens a browser to approve:
   ```sh
   npm install
   npx wrangler login
   ```
3. **Enable R2** in the Cloudflare dashboard (R2 → Purchase/Enable, free plan; it may ask for a card). Then create the storage bucket:
   ```sh
   npx wrangler r2 bucket create noctivago-community
   ```
4. **Create the database:**
   ```sh
   npx wrangler d1 create noctivago-community
   ```
   The command prints a `database_id`. Paste it into `wrangler.toml` in place of the zeros, then create the tables:
   ```sh
   npm run db:remote
   ```
5. **Set the two secrets and deploy.** Each `secret put` asks for a value: type any long random string. Keep the `ADMIN_TOKEN` value somewhere safe, because you need it to moderate.
   ```sh
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put IP_SALT
   npm run deploy
   ```
   The deploy prints the server's URL, for example `https://noctivago-community.<you>.workers.dev`.
6. **Point release builds at the server.** On GitHub, go to the repo's Settings → Secrets and variables → Actions → **Variables** tab. Add `COMMUNITY_API_URL` with the URL from step 5. The next release will show the Community tab.

## Moderation

Uploads go live right away. When 3 different people report a preset, it's hidden automatically. To review hidden presets, replace `$URL` and `$ADMIN_TOKEN` with your values:

```sh
# List hidden presets with their report reasons
curl -H "Authorization: Bearer $ADMIN_TOKEN" "$URL/v1/admin/presets?hidden=1"

# Put a preset back
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$URL/v1/admin/presets/<id>/unhide"

# Remove a preset for good
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$URL/v1/admin/presets/<id>"
```

## Local development

```sh
printf 'ADMIN_TOKEN=local-admin\nIP_SALT=local-salt\n' > .dev.vars
npm run db:local
npm run dev    # http://127.0.0.1:8787
```

To use the local server from an unpackaged app build, set `NOCTIVAGO_COMMUNITY_URL=http://127.0.0.1:8787` before launching the app.

## Limits

These are set in `src/validate.js`:

| Limit | Value |
|---|---|
| Size of one preset | 50 MB, after the app compresses the audio to Opus |
| Total storage | 8 GB (uploads pause beyond this, so R2 stays in its 10 GB free tier) |
| Uploads per network | 10 per day |
| Reports per network | 30 per day |
| Reports that hide a preset | 3, from different people |
