# Security Policy

## Reporting a Vulnerability

If you find a security vulnerability in Noctívago, please **do not** open
a public GitHub issue for it.

Instead, use GitHub's private vulnerability reporting: go to the
**Security** tab of this repository and click **Report a vulnerability**.
This opens a private draft advisory visible only to you and the
maintainers.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce it (a minimal example, if possible).
- The version of Noctívago affected (or the commit hash, if building from
  source).

We'll acknowledge reports as promptly as we can and keep you updated as
the issue is investigated and fixed.

## Scope

Noctívago is a desktop application; most of its attack surface is local
(loading audio files, plugins, presets). Reports involving the plugin
system's trust boundaries (see `CLAUDE.md`'s "Plugins" section for the
intended security model), the `sound://`/`plugin://` custom protocols, or
the auto-update mechanism are especially useful.
