# MusicSorter — project memory

> Single source of truth for any agent working on this repo.
> Companion docs: [`ship.md`](ship.md) for releases, [`updater.md`](updater.md) for the in-app updater architecture, [`BOT_PROMPT.md`](BOT_PROMPT.md) as a paste-in bootstrap for non-Claude-Code agents.

## What it is

Dark-themed desktop app that sorts music files into genre folders. Reads each track's tags, asks Last.fm for genre tags, suggests a destination folder, lets the user override + click Move. Live waveform with audio preview and a tiny dancing ASCII friend.

## Repo layout — two stacks currently coexist

```
Z:\MusicSorter\
├── sorter.py                   # Python build (original, shipping)
├── run.bat                     # Python launcher
├── config.json                 # Python's local dev config (gitignored; key inside)
├── config.json.example         # Python template
├── requirements.txt            # Python runtime deps
├── make_icon.py                # Regenerates icon.{ico,icns,png} from ASCII
├── icon.{ico,icns,png}         # Shared icon assets (dancing dude)
├── RELEASE_NOTES.md            # Overwritten per release — current notes only
├── README.md                   # User-facing readme
├── CLAUDE.md                   # THIS FILE — project memory
├── ship.md                     # Release process source of truth
├── updater.md                  # In-app updater architecture (Electron)
├── BOT_PROMPT.md               # Bootstrap prompt for non-Claude agents
├── .github/workflows/
│   ├── release.yml             # Python build → matches v0.1.* tags
│   └── release-electron.yml    # Electron build → matches v0.2.* / v0.[3-9].* / v[1-9].*
└── app/                        # Electron + React + Vite + TS rewrite
    ├── src/
    │   ├── main/               # IPC handlers, fs, metadata, lastfm, config
    │   ├── preload/            # Typed bridge → window.api
    │   ├── renderer/src/       # React UI (App, Row, Settings, Waveform, Dude…)
    │   └── shared/types.ts     # Cross-context interfaces
    ├── electron.vite.config.ts
    ├── electron-builder.yml    # Branded "MusicSorter" (com.robogears.musicsorter)
    ├── package.json            # Electron version lives here
    ├── resources/icon.png      # Window icon (dancing dude)
    └── run.bat                 # `cd app && pnpm dev`
```

**Which stack is "live"?** Both ship in parallel:
- Python continues on `main` for users already on `v0.1.x`.
- Electron lives on the `electron-rewrite` branch, targeting `v0.2.0+`. When it reaches durable parity it will merge to `main`.

## Hard rules — never violate

These mirror [`ship.md`](ship.md)'s rules but are repeated here so they're visible without opening another file:

1. **Never ship without an explicit user instruction.** Phrases that trigger shipping: *"ship it"*, *"release"*, *"push it"*, *"tag vX.Y.Z"*, *"do a release"*. Code changes outside that stop at the edit + smoke-test.
2. **Never force-move a published tag.** Bump to a new version. The narrow exception is unpublished drafts (still in draft state on GitHub) — those may be deleted + retagged.
3. **Never flip `draft: true` to `false`** in either workflow. Every release lands as a draft for the user to review and Publish manually.
4. **Never commit secrets.** `config.json` is gitignored; never stage it. Never commit anything in `dist/` or `build/`.
5. **Never skip the post-CI body verification.** `softprops/action-gh-release` silently leaves the body empty when updating an existing release. Verify with `gh release view vX.Y.Z --json body --jq '(.body | length)'` and fix with `gh release edit … --notes-file RELEASE_NOTES.md` if zero.
6. **Never overwrite `RELEASE_NOTES.md` outside the ship flow.** That file is the GitHub release body — touching it without an actual release confuses the next person.

## Version-bumping per stack

Each stack owns its own version-of-record field:

| Stack | Version field | Tag prefix matched by CI |
|---|---|---|
| Python | `APP_VERSION = "0.1.X"` near top of [`sorter.py`](sorter.py) | `v0.1.*` |
| Electron | `"version": "0.2.X"` in [`app/package.json`](app/package.json) | `v0.2.*`, `v0.[3-9].*`, `v[1-9].*` |

Bumping the wrong field for the wrong tag = the version stamp shown inside the app stays stale.

## Release flow recap (full version in [`ship.md`](ship.md))

1. Bump version (per stack).
2. Overwrite `RELEASE_NOTES.md` with the v0.X.Y body — required sections in order: *What's new*, *Install*, *Requirements*, *Full Changelog* link.
3. `git add` explicit files, commit, `git push origin main`, annotated tag, `git push origin v0.X.Y`.
4. `gh run watch <id>` until green.
5. **Verify body** — `gh release view v0.X.Y --json body --jq '(.body | length)'` then fix with `gh release edit` if zero.
6. Report run URL + draft release URL. User publishes manually.

## Per-stack notes

### Python (`sorter.py`)

- Single-file app: GUI is `customtkinter` + `tkinter`, audio is `just_playback` + `miniaudio`, metadata is `mutagen`.
- Config lives next to `sorter.py` in dev; in `%APPDATA%\MusicSorter\config.json` (Windows) or `~/Library/Application Support/MusicSorter/config.json` (macOS) for frozen builds — see `app_dir()`.
- `lastfm_api_key` field is treated as "use built-in default" when empty, missing, the legacy `YOUR_...` placeholder, or equal to `DEFAULT_LASTFM_API_KEY`. The on-disk file **never** carries the baked default key as a literal string.
- Frozen builds via PyInstaller; CI bundles `customtkinter`, `just_playback`, `miniaudio`, `cffi` (incl. `--hidden-import _cffi_backend` — needed since v0.1.4).

### Electron (`app/`)

- Stack: Electron 39 + React 19 + Vite 7 + TypeScript 5.9 + Tailwind v4. Build orchestration via `electron-vite`; packaging via `electron-builder`.
- State management: Zustand single store (`app/src/renderer/src/store.ts`).
- IPC layer: typed `window.api` exposed from preload, handlers registered in `app/src/main/ipc.ts`.
- Audio playback: HTMLAudioElement bytes fetched via `window.api.readFile`, wrapped in a Blob URL, handed to wavesurfer.js. **Do not** try to use a custom-scheme URL — `fetch()` refuses to parse them and we already burned a debug cycle on that.
- Web Audio analyser feeds `currentAmp` in the store → the dancing-dude scales with live amplitude.
- Waveform peaks: pre-decoded per row during enrichment (see `peaks.ts`). When a row isn't playing, `StaticWave` renders those peaks as muted gray bars; when playing, wavesurfer.js takes over with white-on-dark.
- Settings dialog mirrors the robogears Downloader's visual language (ALL-CAPS section labels, outlined Browse, single white Done).
- macOS build is Apple-Silicon only (`macos-latest` runner). Intel-Mac users need to build from source.
- For the in-app updater architecture (Windows portable + macOS DMG with self-install, no signing), see [`updater.md`](updater.md). Not implemented yet in the Electron app — it's a roadmap doc.

## Tone for end-of-turn summaries

(Stolen from `ship.md`'s tone section because it applies to every reply, not just release reports.)

- Lead with what shipped or what now works.
- One table is fine if it summarizes; avoid two.
- End-of-turn summary is one or two sentences. No preamble.
- If you spot something out of scope that should be fixed separately, flag it with the `mcp__ccd_session__spawn_task` tool instead of bloating the current turn.

## When you're not sure

- Don't ship. Ask.
- Don't touch the workflows' `draft: true`. Ask.
- Don't move a published tag. Bump and tag fresh.
- Don't introduce a new top-level dependency mid-task. Note it, ship the code change, mention the dep in your end-of-turn so the user can decide.
