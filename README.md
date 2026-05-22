<p align="center">
  <img src="icon.png" alt="MusicSorter" width="128" />
</p>

<h1 align="center">MusicSorter</h1>

<p align="center">
  A dark-themed desktop app that sorts your music into genre folders using Last.fm tags.
</p>

---

## Features

- Scrollable list of every audio file in your Downloads folder
- Per-row genre suggestion based on Last.fm's top tags for the track
- Override the suggestion via dropdown, or create a new genre folder inline — the suggestion immediately propagates to other matching rows
- Real amplitude waveform — click to seek, hold-and-drag to scrub
- In-app preview player (MP3, FLAC, WAV, OGG, Opus) with master volume
- Live ripple effect: bars near the playhead pulse with the music
- Batch-move all queued tracks at once, or move one at a time
- Skip rows you're not ready to handle yet — with undo
- Live re-scan when you change the Downloads path in Settings (no relaunch)
- Cross-platform: Windows + macOS (Apple Silicon)
- Tiny dancing-ASCII friend on top of the window who chills when the music stops

## Install

Grab the latest binary from the [Releases](https://github.com/robogears/MusicSorter/releases) page:

- **Windows** — download `MusicSorter.exe` and double-click.
- **macOS** (Apple Silicon) — download `MusicSorter-macos.zip`, unzip, drag `MusicSorter.app` to `/Applications`. On first launch right-click the app → Open to bypass Gatekeeper (the app isn't code-signed).

No setup required. The first launch creates a `config.json` pointing at your home Downloads and Music folders. Change paths via the cog icon in the top-right.

## How it works

1. Scans your Downloads folder for audio files
2. Reads each track's artist and title from its tags
3. Asks Last.fm what genres people have tagged it with
4. Suggests the closest match from your existing genre folders
5. You confirm or pick a different one — then Move

## Configuration

`config.json` location:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\MusicSorter\config.json` |
| macOS   | `~/Library/Application Support/MusicSorter/config.json` |

Everything is editable from the Settings dialog (cog icon):

- **Music root folder** — where genre subfolders live; destination of moves
- **Downloads folder** — source folder for the scan
- **Scan subfolders** — recurse into Downloads subfolders
- **Last.fm API key** — masked field with Edit / Reset; leave blank to use the built-in default. Get your own at [last.fm/api](https://www.last.fm/api/account/create) if you hit the shared rate limit.
- **Clear** (next to each path) — forgets that path so you can re-point the app at a fresh folder
