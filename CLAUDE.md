# MusicSorter — project memory

> Single source of truth for any agent working on this repo.
> Companion docs: [`ship.md`](ship.md) for releases, [`updater.md`](updater.md) for the in-app updater architecture, [`BOT_PROMPT.md`](BOT_PROMPT.md) as a paste-in bootstrap for non-Claude-Code agents.

## What it is

Dark-themed Electron desktop app that sorts music files into genre folders. Reads each track's tags, asks Last.fm for genre tags, suggests a destination folder, lets the user override + click Move. Live reactive waveform with click-to-seek and drag-to-scrub, in-app audio preview, and a tiny dancing ASCII friend whose beat tracks live amplitude.

## Repo layout

```
Z:\MusicSorter\
├── run.bat                     # Root launcher → cd app && pnpm dev
├── icon.png                    # README header image
├── RELEASE_NOTES.md            # Overwritten per release — current notes only
├── README.md                   # User-facing readme
├── CLAUDE.md                   # THIS FILE — project memory
├── ship.md                     # Release process source of truth
├── updater.md                  # In-app updater architecture (not wired yet)
├── BOT_PROMPT.md               # Bootstrap prompt for non-Claude agents
├── .github/workflows/
│   └── release-electron.yml    # Build → matches v0.2.* / v0.[3-9].* / v[1-9].*
└── app/                        # Electron + React + Vite + TS
    ├── src/
    │   ├── main/               # IPC handlers, fs, metadata, lastfm, peaks (ffmpeg), config
    │   ├── preload/            # Typed bridge → window.api
    │   ├── renderer/src/       # React UI (App, Row, Settings, Waveform, Dude, dialogs…)
    │   └── shared/types.ts     # Cross-context interfaces
    ├── electron.vite.config.ts
    ├── electron-builder.yml    # Branded "MusicSorter" (com.robogears.musicsorter)
    ├── package.json            # Version of record lives here
    ├── resources/icon.png      # Window icon (dancing dude)
    └── run.bat                 # `pnpm dev` from inside app/
```

The repo had a parallel Python build through v0.1.4 (`sorter.py` + customtkinter); it was removed when Electron became the only target. Git history still has those files if you ever need to spelunk for prior behavior.

## Hard rules — never violate

These mirror [`ship.md`](ship.md)'s rules but are repeated here so they're visible without opening another file:

1. **Never ship without an explicit user instruction.** Phrases that trigger shipping: *"ship it"*, *"release"*, *"push it"*, *"tag vX.Y.Z"*, *"do a release"*. Code changes outside that flow stop at the edit + smoke-test.
2. **Never force-move a published tag.** Bump to a new version. The narrow exception is unpublished drafts (still in draft state on GitHub) — those may be deleted + retagged.
3. **Never flip `draft: true` to `false`** in [`release-electron.yml`](.github/workflows/release-electron.yml). Every release lands as a draft for the user to review and Publish manually.
4. **Never commit secrets or build artifacts.** Stage files explicitly by name (not `git add -A`). Never commit anything in `app/out/` or `app/dist/`. (`app/build/` is a source directory — it holds icons, entitlements, and the macOS afterPack hook; it is committed.)
5. **Never skip the post-CI body verification.** `softprops/action-gh-release` silently leaves the body empty when updating an existing release. Verify with `gh release view vX.Y.Z --json body --jq '(.body | length)'` and fix with `gh release edit … --notes-file RELEASE_NOTES.md` if zero.
6. **Never overwrite `RELEASE_NOTES.md` outside the ship flow.** That file is the GitHub release body — touching it without an actual release confuses the next person.

## Version bumping

Version of record lives in [`app/package.json`](app/package.json) as `"version": "0.X.Y"`. The CI workflow [`release-electron.yml`](.github/workflows/release-electron.yml) fires on tags matching `v0.2.*`, `v0.[3-9].*`, or `v[1-9].*`. Patch bump by default; minor for a large batch of new features; major only for genuinely breaking changes.

Bumping the wrong field = the version stamp shown inside the app stays stale.

## Release flow recap (full version in [`ship.md`](ship.md))

1. Bump `version` in `app/package.json`.
2. Overwrite `RELEASE_NOTES.md` with the v0.X.Y body — required sections in order: *What's new*, *Install*, *Requirements*, *Full Changelog* link.
3. `git add` explicit files, commit, `git push origin main`, annotated tag, `git push origin v0.X.Y`.
4. `gh run watch <id>` until green.
5. **Verify body** — `gh release view v0.X.Y --json body --jq '(.body | length)'` then fix with `gh release edit` if zero.
6. Report run URL + draft release URL. User publishes manually.

## Technical notes

- Stack: Electron 39 + React 19 + Vite 7 + TypeScript 5.9 + Tailwind v4. Build orchestration via `electron-vite`; packaging via `electron-builder`.
- State management: single Zustand store at [`app/src/renderer/src/store.ts`](app/src/renderer/src/store.ts) — rows, config, audio state, modal slot.
- IPC layer: typed `window.api` exposed from preload, handlers registered in [`app/src/main/ipc.ts`](app/src/main/ipc.ts).
- Config lives at `app.getPath('userData')` — Electron's standard per-user data dir (`%APPDATA%\MusicSorter\` on Windows, `~/Library/Application Support/MusicSorter/` on macOS).
- Last.fm key is baked into [`app/src/main/lastfm.ts`](app/src/main/lastfm.ts) (`DEFAULT_LASTFM_API_KEY`). Shared across all users; no override path in the UI.

**Audio**
- Playback via wavesurfer.js: renderer fetches file bytes through `window.api.readFile`, wraps in a `Blob` URL, hands to wavesurfer. **Never** use a custom `local-audio://` scheme — `fetch()` refuses to parse them; we burned a debug cycle on it.
- Web Audio analyser feeds `currentAmp` into the store at ~20 Hz → drives the dancing-dude scaling.
- Volume slider applies a perceptual power-3 curve so the low end feels right.

**Waveforms**
- Per-row peaks decoded in a 4-worker concurrent pool ([`peaks.ts`](app/src/renderer/src/peaks.ts)).
  Renderer attempts Chromium's `OfflineAudioContext` first (fast, no user-gesture requirement); on failure falls back to IPC → main process `computePeaksMain` which spawns `ffmpeg-static` to decode anything Chromium can't.
- Peaks cache in `localStorage` keyed by filepath + mtime, so subsequent launches paint real waveforms instantly. Coalesced 300 ms write debounce.
- `StaticWave` shows decoded peaks when available, filename-seeded placeholder bars otherwise. Pointer-down + drag (with pointer capture) scrubs the cursor; release plays from that position. Click-with-no-drag also plays from position.
- Live `Waveform` (only mounted for the row currently playing) is wavesurfer.js with white-on-dark bars.

**Dialogs**
- Single modal slot in the store + `Modal` / `Prompt` / `Confirm` primitives in `components/Dialogs.tsx`. **All** confirmations / prompts go through these — no native `window.prompt` / `window.confirm` anywhere.
- Settings dialog mirrors the robogears Downloader's visual language (ALL-CAPS section labels, outlined Browse, single white Done).

**Layout**
- Row list is a CSS grid with `repeat(3, minmax(0, 1fr))` — fixed 3 columns; cards narrow as the window shrinks.

**Build & packaging**
- `electron-builder.yml` is branded as `MusicSorter` (`com.robogears.musicsorter`). Windows artifact is an NSIS installer (`MusicSorter-${version}-setup.exe`); macOS is a DMG (`MusicSorter-${version}-${arch}.dmg`, Apple Silicon only — explicit `mac.target: dmg` + `arch: [arm64]`).
- macOS ad-hoc signing via [`app/build/after-pack.js`](app/build/after-pack.js) (`codesign --force --deep --sign -`) so arm64 Gatekeeper accepts the build. Without it, unsigned arm64 .apps show as "damaged."
- `ffmpeg-static` is `asarUnpack`ed so `child_process.spawn` can exec the bundled binary in the packaged app. The `peaks.ts` resolver rewrites the in-asar path to `app.asar.unpacked` automatically.
- macOS build is Apple-Silicon only (`macos-latest` runner). Intel-Mac users need to build from source.
- Bundle size note: ffmpeg-static adds ~80 MB per platform; final installers are ~110 MB. This is the cost of bombproof format coverage.

**Updater** — [`app/src/main/updater.ts`](app/src/main/updater.ts), full doc in [`updater.md`](updater.md).
- On launch (packaged only), silently polls `/repos/robogears/MusicSorter/releases/latest`. If newer, sends `update:available` to the renderer → header pill appears.
- Settings has a manual "Check for updates" button hitting the same flow.
- Self-install path is macOS-only (DMG): downloads → `hdiutil` mount → `ditto` copy → double-fork bash daemon waits for parent PID → strip quarantine → backup → mv into `/Applications/` → ad-hoc re-sign → `open`. Handles App Translocation by detecting `/AppTranslocation/` in the running exe path. Logs to `~/Library/Logs/MusicSorter/`.
- Windows NSIS path: `canSelfInstall()` returns false → renderer opens the release page in the user's browser (the doc's graceful fallback).

**Local dev launch**
- Double-click [`run.bat`](run.bat) at the repo root → cd's into `app/` and runs `pnpm dev`. Same effect as `app/run.bat`, just one level up for convenience.

## Tone for end-of-turn summaries

(Stolen from `ship.md`'s tone section because it applies to every reply, not just release reports.)

- Lead with what shipped or what now works.
- One table is fine if it summarizes; avoid two.
- End-of-turn summary is one or two sentences. No preamble.
- If you spot something out of scope that should be fixed separately, flag it with the `mcp__ccd_session__spawn_task` tool instead of bloating the current turn.

## When you're not sure

- Don't ship. Ask.
- Don't touch the workflow's `draft: true`. Ask.
- Don't move a published tag. Bump and tag fresh.
- Don't introduce a new top-level dependency mid-task. Note it, ship the code change, mention the dep in your end-of-turn so the user can decide.
