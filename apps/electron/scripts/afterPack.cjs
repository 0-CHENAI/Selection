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
const os = require('os');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

function copySharpRuntime(context, resourcesRoot) {
  const archName = ({ 1: 'x64', 3: 'arm64' })[context.arch] || String(context.arch);
  const target = `${context.electronPlatformName}-${archName}`;
  const rootDir = path.resolve(context.packager.projectDir, '..', '..');
  const sharpPackage = JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules', 'sharp', 'package.json'), 'utf8'));
  // Windows prebuilt sharp already contains its libvips DLLs.
  const packages = context.electronPlatformName === 'win32'
    ? [`@img/sharp-${target}`]
    : [`@img/sharp-${target}`, `@img/sharp-libvips-${target}`];

  for (const name of packages) {
    const source = path.join(rootDir, 'node_modules', name);
    const destination = path.join(resourcesRoot, 'app', 'node_modules', name);
    const version = sharpPackage.optionalDependencies?.[name];
    if (!version) throw new Error(`Sharp does not support packaged target ${target}: ${name}`);

    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(source)) {
      fs.cpSync(source, destination, { recursive: true, dereference: true });
    } else {
      // Cross-platform builds do not install the target's optional dependency.
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-sharp-'));
      try {
        const archive = execFileSync('npm', ['pack', `${name}@${version}`, '--pack-destination', temporary, '--silent'],
          { encoding: 'utf8' }).trim().split(/\r?\n/).at(-1);
        if (!archive) throw new Error(`Could not download ${name}@${version}`);
        fs.mkdirSync(destination, { recursive: true });
        execFileSync('tar', ['-xzf', path.join(temporary, archive), '-C', destination, '--strip-components=1']);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  }

  const binding = path.join(resourcesRoot, 'app', 'node_modules', `@img/sharp-${target}`, 'lib', `sharp-${target}.node`);
  if (!fs.existsSync(binding)) throw new Error(`Packaged sharp binding is missing: ${binding}`);
  if (context.electronPlatformName === 'win32' && !fs.existsSync(path.join(path.dirname(binding), 'libvips-42.dll'))) {
    throw new Error(`Packaged sharp libvips DLL is missing for ${target}`);
  }
  if (target === `${process.platform}-${process.arch}`) {
    const fromMain = createRequire(path.join(resourcesRoot, 'app', 'dist', 'main.cjs'));
    fromMain(`@img/sharp-${target}/sharp.node`);
  }
  console.log(`Packaged sharp native runtime for ${target}`);
}

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

function copyAgentRuntimes(context, resourcesRoot) {
  const projectDir = context.packager.projectDir;
  // electron-builder excludes nested node_modules and may omit symlinked vendor directories.
  // Copy the reviewed runtime trees after its filters, before signing the application.
  for (const relative of ['resources/session-mcp-server', 'resources/pi-agent-server', 'vendor/bun']) {
    const source = path.join(projectDir, relative);
    if (!fs.existsSync(source)) throw new Error(`Required agent runtime is missing: ${relative}`);
    const destination = path.join(resourcesRoot, 'app', relative);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, dereference: true });
  }
  for (const relative of ['resources/session-mcp-server/index.js', 'resources/pi-agent-server/index.js',
    'resources/pi-agent-server/photon_rs_bg.wasm', 'resources/pi-agent-server/image-resize-worker.js',
    `vendor/bun/${context.electronPlatformName === 'win32' ? 'bun.exe' : 'bun'}`]) {
    if (!fs.existsSync(path.join(resourcesRoot, 'app', relative))) throw new Error(`Packaged agent runtime is missing: ${relative}`);
  }
  const ripgrep = 'node_modules/@vscode/ripgrep';
  const sources = [path.join(projectDir, ripgrep), path.join(projectDir, '..', '..', ripgrep)];
  const source = sources.find(candidate => fs.existsSync(candidate));
  if (!source) throw new Error('Required search runtime is missing: @vscode/ripgrep');
  const destination = path.join(resourcesRoot, 'app', ripgrep);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
  if (!fs.existsSync(path.join(destination, 'bin', context.electronPlatformName === 'win32' ? 'rg.exe' : 'rg'))) {
    throw new Error('Packaged search binary is missing');
  }
}

module.exports = async function afterPack(context) {
  const resourcesRoot = resolvePackagedResourcesRoot(context);
  copyAgentRuntimes(context, resourcesRoot);
  pruneForeignPlatformRuntimes(context, resourcesRoot);
  copySharpRuntime(context, resourcesRoot);

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
module.exports.copySharpRuntime = copySharpRuntime;
module.exports.copyAgentRuntimes = copyAgentRuntimes;
