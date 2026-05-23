# What's new in v0.2.5

## Fixes
- **No more `vv0.2.4` in Settings.** Update result line was double-prefixing the `v` (GitHub tag stored verbatim with its leading `v`, then the renderer prepended another). Main process now strips the prefix; every display site prepends a single `v` consistently. Affects Settings and the header pill.
- **Settings copy tweak.** "see the notice in the header" → "check out the notice in the header."

---

# Install

- **Windows** — download `MusicSorter-0.2.5-setup.exe` and run the installer. SmartScreen may flag the unsigned binary on first launch — choose *More info* → *Run anyway*.
- **macOS** (Apple Silicon) — download `MusicSorter-0.2.5-arm64.dmg`, mount it, drag `MusicSorter.app` to `/Applications`. First launch: right-click → Open to bypass Gatekeeper.

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.2.4...v0.2.5
