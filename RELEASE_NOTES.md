# What's new in v0.2.4

## Test release
- Pure version bump to exercise the in-app updater wired in v0.2.0. If you're on v0.2.3, the header pill should light up with *↑ Update to v0.2.4* shortly after launch; on macOS the pill self-installs the DMG, on Windows it opens this release page. No code changes vs v0.2.3.

---

# Install

- **Windows** — download `MusicSorter-0.2.4-setup.exe` and run the installer. SmartScreen may flag the unsigned binary on first launch — choose *More info* → *Run anyway*.
- **macOS** (Apple Silicon) — download `MusicSorter-0.2.4-arm64.dmg`, mount it, drag `MusicSorter.app` to `/Applications`. First launch: right-click → Open to bypass Gatekeeper.

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.2.3...v0.2.4
