# What's new in v0.2.2

## Fixes
- **App launches on macOS and Windows again.** v0.2.1's `node-linker=hoisted` fix wasn't sufficient — electron-builder's pnpm dependency walker correctly visited `token-types` but skipped `ieee754` from its declared deps (known walker quirk for some transitive trees). Added `ieee754` as an explicit direct dep so it's found from the top-level walk. Verified by inspecting the packed `app.asar` locally before tagging.

## Visual
- **New app icon.** Outlined file-folder with a filled music-note glyph inside — reads as "music sorter" at any size from 16 px through 1024 px; monochrome to match the app's dark theme. Replaces the ASCII dancing-dude. The new generator script lives at `app/build/make_icon.py` if you ever want to tweak the design.

---

# Install

- **Windows** — download `MusicSorter-0.2.2-setup.exe` and run the installer. SmartScreen may flag the unsigned binary on first launch — choose *More info* → *Run anyway*.
- **macOS** (Apple Silicon) — download `MusicSorter-0.2.2-arm64.dmg`, mount it, drag `MusicSorter.app` to `/Applications`. First launch: right-click → Open to bypass Gatekeeper.

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.2.1...v0.2.2
