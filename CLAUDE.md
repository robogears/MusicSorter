# MusicSorter — project rules

## Release workflow

**Every push that ships a user-visible change must:**

1. **Bump the patch version** — don't reuse / force-move an existing tag.
   Past tags: `v0.1.0`, `v0.1.2`. Next is `v0.1.3`, then `v0.1.4`, etc.
   Bump the minor (`v0.2.0`) only for substantial feature batches.
2. **Update [`RELEASE_NOTES.md`](RELEASE_NOTES.md)** with a "What's new in vX.Y.Z"
   section at the top describing the changes. Older sections stay below as
   recap context — the file accumulates across releases.
3. **Commit + push to `main`**, then create the new annotated tag and push it.
   Tag-push triggers `.github/workflows/release.yml` which builds Windows +
   macOS binaries and creates a **draft** release.
4. **Always leave the release as a draft** — the workflow already sets
   `draft: true`. The user clicks "Publish release" manually on GitHub
   after reviewing the binaries and notes. Never change that to false.

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
