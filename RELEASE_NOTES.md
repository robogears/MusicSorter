# What's new in v0.1.4

## Fixes
- **Audio preview works again.** The v0.1.3 builds were missing the `_cffi_backend` C extension that `just_playback` needs, so the preview player, waveform scrubbing, and live amplitude reactivity all failed with *"Playback library not available — ModuleNotFoundError: No module named '_cffi_backend'"*. The workflow now bundles `cffi` (and the underlying C extension) explicitly, so every build has working playback.

---

# Install

- **Windows**: download `MusicSorter.exe` and double-click. SmartScreen may flag the unsigned binary on first launch — choose *"More info"* → *"Run anyway"*.
- **macOS** (Apple Silicon): download `MusicSorter-macos.zip`, unzip, drag `MusicSorter.app` to `/Applications`. On first launch right-click → Open to bypass Gatekeeper (the app isn't code-signed).

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups will silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.1.3...v0.1.4
