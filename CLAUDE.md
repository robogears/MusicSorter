# MusicSorter — project rules

## Release workflow

**Source of truth: [`ship.md`](ship.md).** Read it before any release work and
follow the sequence exactly. Highlights you must internalize:

- Never ship without an explicit user instruction ("ship it", "release", etc.).
  Code changes outside that flow stop at the edit + smoke-test.
- Version lives in `APP_VERSION` (top of [`sorter.py`](sorter.py)). Patch-bump
  by default; never force-move a published tag.
- `RELEASE_NOTES.md` is **overwritten** every release — no cumulative sections.
  The required structure (What's new → Install → Requirements → Full Changelog
  link) is mandatory; the GitHub Actions workflow's `body_path` consumer
  depends on it.
- `draft: true` in `.github/workflows/release.yml` stays — every release lands
  as a draft for the user to review and Publish manually.
- After CI completes, verify `gh release view vX.Y.Z --json body --jq '(.body | length)'`
  and fix with `gh release edit … --notes-file RELEASE_NOTES.md` if empty.

## Build outputs

- Windows: `dist/MusicSorter.exe` (PyInstaller `--onefile --windowed`)
- macOS: `dist/MusicSorter.app` → zipped to `MusicSorter-macos.zip`
- Local rebuilds are produced by running PyInstaller manually; releases
  go through GitHub Actions exclusively now.

## Config file

- Lives in `app_dir()` — varies by OS in frozen builds, equals the script
  folder in dev. Never read/write `config.json` from anywhere else.
- `lastfm_api_key` in `config.json` is treated as "use built-in default"
  when it's empty, missing, the legacy `YOUR_...` placeholder, or equal
  to `DEFAULT_LASTFM_API_KEY`. The on-disk file should never contain the
  baked default key as a literal string.
