// electron-builder afterSign hook (macOS): re-signs the outer bundle, ad hoc, with a stable designated requirement.
//
// In-app updates go through Squirrel.Mac, which only installs a new version if its signature satisfies the
// designated requirement of the running app. An ad hoc signature's default requirement is its own cdhash,
// which changes with every build, so no update would ever pass. Requiring only the bundle identifier lets
// each version accept the next one (the download itself is checked by electron-updater's sha512).
//
// Only the outer bundle is re-signed: electron-builder's `mac.requirements` would apply the same requirement
// to every helper and framework, whose identifiers differ, and break their signatures.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const id = context.packager.appInfo.id
  execFileSync('codesign', [
    '--force',
    '--sign', '-',
    '--identifier', id,
    '--preserve-metadata=entitlements,flags',
    `-r=designated => identifier "${id}"`,
    app
  ], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • designated requirement set  identifier=${id}`)
}
