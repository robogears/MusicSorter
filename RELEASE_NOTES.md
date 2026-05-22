# What's new in v0.1.2

## Live folder refresh
- Changing the Downloads path (or toggling the subfolder-scan setting) and
  clicking Save now re-scans automatically. No more relaunching for new
  songs to show up.

## Smarter folder suggestions
- When you create a new genre folder via `+ New` (e.g. "Rap"), the suggestion
  immediately propagates to every other unassigned row whose top tag matches.
  Manual selections stay put.

## Clearer playback errors
- If the audio library fails to load, the status bar now shows the actual
  import exception instead of just "unavailable".

## macOS support
- Apple Silicon `.app` bundle now ships alongside the Windows `.exe`.

---

# Recap of earlier 0.1.x changes

- Zero-setup launch: ships with a built-in Last.fm key, auto-creates `config.json`
- Per-user config location (`%APPDATA%\MusicSorter` on Windows,
  `~/Library/Application Support/MusicSorter` on macOS)
- Settings dialog: masked Last.fm key with Edit / Reset, "Reset config" button
  for forgetting saved paths
- ASCII dancing-dude window/app icon
- Reactive waveform: live amplitude ripple around the playhead, click to seek,
  hold-and-drag to scrub
- Volume slider with perceptual (power-3) curve

---

# Install

- **Windows**: download `MusicSorter.exe`, double-click.
- **macOS** (Apple Silicon): download `MusicSorter-macos.zip`, unzip, drag
  `MusicSorter.app` to `/Applications`. On first launch right-click → Open
  to bypass Gatekeeper (the app isn't code-signed).
