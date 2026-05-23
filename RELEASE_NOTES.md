# What's new in v0.2.0

First release on the new Electron + React + TypeScript stack. The legacy Python build (`sorter.py`) is retired; everything now lives under `app/`. Old Python files are still in git history if you need them.

## Visual + interaction
- Canvas-based waveform on every row. Hovering spotlights the bars near the cursor; press-and-drag scrubs continuously while audio keeps playing — no pause-on-seek.
- Responsive grid: 1 → 7 columns depending on window width. 3 columns fills a standard 16:9 monitor; layout never lets cards squish past readable. Minimum window size enforced.
- "Can't find genre from Last.fm" badge so a row with no results is visually distinct from a still-loading row.
- Card layout pinned so waveforms in the same row line up at the same Y.

## Updater
- On launch (packaged builds) the app silently polls GitHub for a newer release. A pill in the header lights up if one's available.
- **macOS** self-installs the new DMG in place (mount → ditto extract → daemonized bash relauncher waits for parent → moves into `/Applications/` → ad-hoc re-signs → re-opens). Handles App Translocation. Logs land in `~/Library/Logs/MusicSorter/`.
- **Windows** opens the release page in the browser (NSIS is a fixed-install flow).
- Settings has a manual *Check for updates* button hitting the same path.

## Build + packaging
- **Windows**: NSIS installer (`MusicSorter-0.2.0-setup.exe`).
- **macOS**: Apple-Silicon DMG (`MusicSorter-0.2.0-arm64.dmg`) with ad-hoc codesign via `build/after-pack.js` so Gatekeeper accepts the build (no Apple Developer ID required).
- Renderer bundle is ~120 KB lighter than mid-rewrite — wavesurfer.js retired in favor of a hand-rolled canvas.

---

# Install

- **Windows** — download `MusicSorter-0.2.0-setup.exe` and run the installer. SmartScreen may flag the unsigned binary on first launch — choose *More info* → *Run anyway*.
- **macOS** (Apple Silicon) — download `MusicSorter-0.2.0-arm64.dmg`, mount it, drag `MusicSorter.app` to `/Applications`. First launch: right-click → Open to bypass Gatekeeper (the app is ad-hoc signed, not Developer-ID signed). Intel Macs need to build from source.

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.1.4...v0.2.0
