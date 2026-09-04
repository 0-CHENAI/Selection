/**
 * electron-builder afterPack hook
 *
 * Copies the pre-compiled macOS 26+ Liquid Glass icon (Assets.car) into the
 * app bundle. The Assets.car file is compiled locally using actool with the
 * macOS 26 SDK (not available in CI), then committed to the repo.
 *
 * To regenerate Assets.car after icon changes:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *
 * For older macOS versions, the app falls back to icon.icns which is
 * included separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');

function pruneForeignPlatformRuntimes(context, resourcesRoot) {
  const archName = ({ 1: 'x64', 3: 'arm64' })[context.arch] || String(context.arch);
  const target = `${context.electronPlatformName}-${archName}`;
  const supported = new Set(['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']);
  if (!supported.has(target)) {
    throw new Error(`Unsupported packaged OfficeCLI target: ${target}`);
  }

  const binDirectories = [
    path.join(resourcesRoot, 'app', 'resources', 'bin'),
    path.join(resourcesRoot, 'app', 'dist', 'resources', 'bin'),
  ];
  let foundTarget = false;
  for (const binDirectory of binDirectories) {
    if (!fs.existsSync(binDirectory)) continue;
    for (const entry of fs.readdirSync(binDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^(?:darwin|win32|linux)-(?:arm64|x64)$/.test(entry.name)) continue;
      const entryPath = path.join(binDirectory, entry.name);
      if (entry.name === target) foundTarget = true;
      else fs.rmSync(entryPath, { recursive: true, force: true });
    }
  }
  if (!foundTarget) throw new Error(`Packaged OfficeCLI runtime is missing for ${target}`);
  console.log(`Packaged OfficeCLI runtime pruned to ${target}`);
}

function resolvePackagedResourcesRoot(context) {
  if (context.electronPlatformName !== 'darwin') {
    return path.join(context.appOutDir, 'resources');
  }
  const productFilename = context.packager.appInfo.productFilename;
  if (!productFilename) throw new Error('Packaged app product filename is missing');
  return path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'Resources');
}

module.exports = async function afterPack(context) {
  const resourcesRoot = resolvePackagedResourcesRoot(context);
  pruneForeignPlatformRuntimes(context, resourcesRoot);

  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const appPath = context.appOutDir;
  const resourcesDir = resourcesRoot;
  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  console.log(`afterPack: looking for Assets.car at ${precompiledAssets}`);

  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    console.log('Warning: Pre-compiled Assets.car not found in resources/');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Don't fail the build if Assets.car can't be copied - app will use fallback icon.icns
    console.log(`Warning: Could not copy Assets.car: ${err.message}`);
    console.log('The app will use the fallback icon.icns on all macOS versions');
  }
};

module.exports.pruneForeignPlatformRuntimes = pruneForeignPlatformRuntimes;
module.exports.resolvePackagedResourcesRoot = resolvePackagedResourcesRoot;
