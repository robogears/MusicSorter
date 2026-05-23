/**
 * Ad-hoc codesign the macOS .app so Gatekeeper accepts it without paying for
 * a Developer ID. Without this, arm64 builds show as "damaged" — unsigned
 * is harsher than the standard "unidentified developer" warning.
 *
 * Per updater.md Component 7. Runs as part of electron-builder packaging
 * (referenced by `afterPack` in electron-builder.yml).
 */
const { execSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename + '.app'
  const appPath = path.join(context.appOutDir, appName)
  console.log(`[after-pack] ad-hoc signing ${appPath}`)
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
}
