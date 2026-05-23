# What's new in v0.2.1

## Fix
- **App launches again.** v0.2.0 crashed at startup with `Cannot find package 'ieee754'`. Root cause: pnpm's symlinked `node_modules` layout left transitive deps (ieee754 is pulled in via music-metadata → file-type → @tokenizer/inflate → token-types) under `.pnpm/` only, and electron-builder didn't follow the symlinks into `app.asar`. Switched to a hoisted (flat) install layout via `app/.npmrc` (`node-linker=hoisted`) so every dep physically lives at `node_modules/<pkg>/` and gets packed correctly. Affects both Windows and macOS builds.

---

# Install

- **Windows** — download `MusicSorter-0.2.1-setup.exe` and run the installer. SmartScreen may flag the unsigned binary on first launch — choose *More info* → *Run anyway*.
- **macOS** (Apple Silicon) — download `MusicSorter-0.2.1-arm64.dmg`, mount it, drag `MusicSorter.app` to `/Applications`. First launch: right-click → Open to bypass Gatekeeper.

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.2.0...v0.2.1
