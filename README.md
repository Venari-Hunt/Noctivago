# Noctívago

A desktop ambient sound mixer for Windows — loop, layer, and shape any
sound for sleep, focus, or building a soundscape for a game, stream, or
writing session. Inspired by [Blanket](https://github.com/rafaelmardojai/blanket)
(Linux-only, which is why this exists), but grown well past a simple mixer.

**[Download on itch.io](https://venar1.itch.io/noctivago)** · **[Full documentation](https://venari-hunt.github.io/noctivago-docs/)**

## What it does

- **Per-sound editing** (the Remix tab): trim, highpass/lowpass/gain, a
  7-band parametric EQ, echo, real convolution reverb, noise gate, noise
  reduction, a Doppler pass-by effect, speed/pitch/reverse, a volume
  envelope, and slow random volume/pitch "Fluctuation" drift — all with
  live preview before you save anything.
- **Three ways a sound can play**: loop, Random Interval ("scatter" —
  replays at randomized gaps with randomized pitch), or Scheduled
  (wall-clock times, like an hourly chime).
- **Sound Groups** — route a subset of a preset's sounds through their
  own shared EQ/reverb bus (e.g. "outside" sounds vs. "inside" sounds),
  including an "Occlusion" control for a muffled-behind-a-wall feel.
- **Export** a whole mix to a single audio file, or a video (waveform/
  spectrum visualization, a looped image, or your own background video).
- **Sleep timer** — stop, turn off displays (keep playing), sleep, or
  shut down.
- **A small plugin architecture** — the Remix tab is itself a plugin;
  see `CLAUDE.md` for how to build your own.
- Watch-folder auto-import, drag-in folders as presets/tags, portable
  preset sharing, in-app auto-update.

No bundled sounds, no AI in the app — Noctívago is a tool. It ships with
zero audio of its own; you bring whatever recordings you want, and the
app is what lets you shape, loop, and mix them. Fully local: no cloud
processing, no account, nothing leaves your machine unless you choose to
export and share it.

## Getting it

The easiest way to get a ready-to-run build is
**[itch.io](https://venar1.itch.io/noctivago)**. The source here is fully
open (see below) if you'd rather build it yourself.

## Building from source

```
npm install
npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for platform-specific setup notes
and code conventions, and [CLAUDE.md](CLAUDE.md) for the full
architecture writeup (playback engine, the plugin system, why ffmpeg is
used the way it is).

## License

Apache License 2.0 — see [LICENSE](LICENSE). Third-party components
bundled in distributed builds (notably ffmpeg, GPLv3) are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). A
signed CLA ([CLA.md](CLA.md)) is required before a pull request can be
merged; a bot will walk you through it on your first PR.
