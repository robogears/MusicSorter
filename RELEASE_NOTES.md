# What's new in v0.2.3

## Fix
- **App launches on macOS and Windows again — for real this time.** v0.2.2 fixed the missing `ieee754` but the same electron-builder + pnpm walker bug ate a second transitive dep — `ms` (declared by `debug`, used by `music-metadata`'s logging). Added `ms` as an explicit direct dep so the walker finds it from the top level. Verified by walking every transitive runtime dep declared anywhere in the tree and confirming all of them land in the packed `app.asar` (35 of 36 — the 36th is `undici-types`, a TypeScript-types-only package never required at runtime).

---

# Install

- **Windows** — download `MusicSorter-0.2.3-setup.exe` and run the installer. SmartScreen may flag the unsigned binary on first launch — choose *More info* → *Run anyway*.
- **macOS** (Apple Silicon) — download `MusicSorter-0.2.3-arm64.dmg`, mount it, drag `MusicSorter.app` to `/Applications`. First launch: right-click → Open to bypass Gatekeeper.

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.2.2...v0.2.3
