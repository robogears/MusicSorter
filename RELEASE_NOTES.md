# What's new in v0.1.3

## UI overhaul to match the robogears family
- Title bar now reads `[dude] robogears MusicSorter v0.1.3` with a small ASCII-dude logo and a warm-tinted version stamp.
- Settings dialog rebuilt to match the Downloader: ALL-CAPS section labels, taller rounded entries, outlined Browse buttons, inline `Clear`, indexed-folder count with Refresh, and a single white `Done` button.
- Main window picks up `QUEUE` and `ACTIVITY` section headers; the status line is now a monospaced activity log.
- Settings cog is slimmer and lighter; volume cluster compacted into the title bar.

## Last.fm tag-lookup improvements
- "(feat. X)", "[Remix]", "(Sped Up)" and similar suffixes are stripped from track titles before re-querying Last.fm, so common download-naming quirks no longer kill the genre suggestion.
- When a lookup fails the row now shows the actual reason (e.g. *"Last.fm lookup failed: HTTP 400"*) instead of a vague "no genre" message.
- Playback library import failures surface the real exception in the status bar.

## Smaller stuff
- Last.fm API key is no longer user-editable — the bundled key is always used and `config.json` never carries the key string.
- The old "Reset config" button is gone; each path field has its own `Clear` link instead.

---

# Install

- **Windows**: download `MusicSorter.exe` and double-click. SmartScreen may flag the unsigned binary on first launch — choose *"More info"* → *"Run anyway"*.
- **macOS** (Apple Silicon): download `MusicSorter-macos.zip`, unzip, drag `MusicSorter.app` to `/Applications`. On first launch right-click → Open to bypass Gatekeeper (the app isn't code-signed).

Config lives at `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS).

## Requirements

- Windows 10+ or macOS 12+ (Apple Silicon)
- Internet connection for Last.fm genre lookups. The bundled API key is shared across all users; if you hit the ~5 req/s rate limit, lookups will silently fall back to artist-level tags.

---

**Full Changelog**: https://github.com/robogears/MusicSorter/compare/v0.1.2...v0.1.3
