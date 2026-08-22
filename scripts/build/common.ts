/**
 * Common build utilities shared across all platforms
 */

import { $ } from 'bun';
import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  chmodSync,
  cpSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';

export type Platform = 'darwin' | 'win32' | 'linux';
export type Arch = 'x64' | 'arm64';

export interface BuildConfig {
  platform: Platform;
  arch: Arch;
  upload: boolean;
  uploadLatest: boolean;
  uploadScript: boolean;
  rootDir: string;
  electronDir: string;
}

/**
 * Bun version to bundle with the app.
 * Update this when upgrading Bun. Check latest at: https://github.com/oven-sh/bun/releases
 * This should match or be close to the version used in CI (setup-bun action).
 */
export const BUN_VERSION = 'bun-v1.3.9';

/**
 * uv version to bundle with the app.
 * Update this when upgrading uv. Check latest at: https://github.com/astral-sh/uv/releases
 */
export const UV_VERSION = '0.10.6';

interface OfficecliBuildManifest {
  tag: string;
  assets: Record<string, { name: string; url: string; sha256: string }>;
}

/** One reviewed manifest is the source of truth for runtime and build assets. */
const OFFICECLI_MANIFEST = JSON.parse(readFileSync(
  join(import.meta.dir, '../../apps/electron/resources/officecli/officecli-manifest.json'),
  'utf8',
)) as OfficecliBuildManifest;

export const OFFICECLI_VERSION = OFFICECLI_MANIFEST.tag;
const OFFICECLI_ASSET: Record<string, string> = Object.fromEntries(
  Object.entries(OFFICECLI_MANIFEST.assets).map(([key, asset]) => [key, asset.name]),
);
const OFFICECLI_ASSET_URL: Record<string, string> = Object.fromEntries(
  Object.entries(OFFICECLI_MANIFEST.assets).map(([key, asset]) => [key, asset.url]),
);
export const OFFICECLI_SHA256: Record<string, string> = Object.fromEntries(
  Object.entries(OFFICECLI_MANIFEST.assets).map(([key, asset]) => [key, asset.sha256]),
);

/** Desktop installers that must ship officecli even when built on another host. */
export const OFFICECLI_DESKTOP_TARGETS: Array<{ platform: Platform; arch: Arch }> = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
];

/**
 * Get platform key for resources/bin folder naming.
 */
export function getPlatformKey(platform: Platform, arch: Arch): string {
  return `${platform}-${arch}`;
}

/**
 * Get the Bun download filename for a platform/arch combination
 */
export function getBunDownloadName(platform: Platform, arch: Arch): string {
  const archMap: Record<Arch, string> = {
    x64: 'x64',
    arm64: 'aarch64',
  };

  const platformMap: Record<Platform, string> = {
    darwin: 'darwin',
    win32: 'windows',
    linux: 'linux',
  };

  const bunArch = archMap[arch];
  const bunPlatform = platformMap[platform];

  // Windows and Linux x64 use baseline build for broader CPU compatibility (no AVX2 requirement)
  if ((platform === 'win32' || platform === 'linux') && arch === 'x64') {
    return `bun-${bunPlatform}-x64-baseline`;
  }

  return `bun-${bunPlatform}-${bunArch}`;
}

/**
 * Get uv release artifact filename for a platform/arch combination.
 */
export function getUvDownloadName(platform: Platform, arch: Arch): string {
  if (platform === 'darwin' && arch === 'arm64') return 'uv-aarch64-apple-darwin.tar.gz';
  if (platform === 'darwin' && arch === 'x64') return 'uv-x86_64-apple-darwin.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'uv-aarch64-unknown-linux-gnu.tar.gz';
  if (platform === 'linux' && arch === 'x64') return 'uv-x86_64-unknown-linux-gnu.tar.gz';
  if (platform === 'win32' && arch === 'arm64') return 'uv-aarch64-pc-windows-msvc.zip';
  if (platform === 'win32' && arch === 'x64') return 'uv-x86_64-pc-windows-msvc.zip';

  throw new Error(`Unsupported uv target: ${platform}-${arch}`);
}

/**
 * Verify SHA256 checksum of a file
 */
export async function verifySha256(filePath: string, expectedHash: string): Promise<boolean> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const hash = createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  return hash.toLowerCase() === expectedHash.toLowerCase();
}

const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * Download a file with Bun's built-in fetch implementation.
 * This is the fallback on Windows installations where PowerShell exposes a
 * `curl` alias but no curl.exe exists for child processes.
 */
async function fetchDownload(dest: string, url: string): Promise<void> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    tls: process.env.CURL_INSECURE === '1'
      ? { rejectUnauthorized: false }
      : undefined,
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`);
  }

  await Bun.write(dest, response);
}

/**
 * Download a file, trying each URL until one succeeds.
 * Uses curl when a real executable is available and otherwise falls back to
 * Bun fetch. The historical export name is retained for build-script API
 * compatibility.
 */
export async function curlDownload(dest: string, urls: string[]): Promise<string> {
  const curlPath = Bun.which('curl');
  const curlInsecure = process.env.CURL_INSECURE === '1' ? ['-k'] : [];
  let lastError: unknown;

  for (const url of urls) {
    console.log(`  Downloading ${url}...`);

    if (curlPath) {
      try {
        await $`${curlPath} -fsSL ${curlInsecure} --retry 3 --retry-delay 2 --connect-timeout 20 -o ${dest} ${url}`;
        return url;
      } catch (err) {
        lastError = err;
      }
    } else {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await fetchDownload(dest, url);
          return url;
        } catch (err) {
          lastError = err;
          if (attempt < 3) {
            console.warn(`  Download attempt ${attempt} failed, retrying...`);
            await Bun.sleep(2_000);
          }
        }
      }
    }

    console.warn('  Download failed, trying next mirror');
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to download ${dest}`);
}

/**
 * Download and verify Bun binary
 * Uses the shared downloader so local Windows builds do not require curl.exe.
 */
export async function downloadBun(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config;
  const bunDownload = getBunDownloadName(platform, arch);
  const vendorDir = join(electronDir, 'vendor', 'bun');
  const bunBinary = platform === 'win32' ? 'bun.exe' : 'bun';
  const destPath = join(vendorDir, bunBinary);

  if (existsSync(destPath)) {
    console.log(`Bun already present at ${destPath}`);
    return;
  }

  console.log(`Downloading Bun ${BUN_VERSION} for ${platform}-${arch}...`);

  // Create vendor directory
  mkdirSync(vendorDir, { recursive: true });

  // Create temp directory
  const tempDir = join(electronDir, '.bun-download-temp');
  mkdirSync(tempDir, { recursive: true });

  try {
    const zipName = `${bunDownload}.zip`;
    const zipUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/${zipName}`;
    const checksumUrl = `https://github.com/oven-sh/bun/releases/download/${BUN_VERSION}/SHASUMS256.txt`;
    const zipMirrors = [
      zipUrl,
      `https://npmmirror.com/mirrors/bun/${BUN_VERSION}/${zipName}`,
      `https://registry.npmmirror.com/-/binary/bun/${BUN_VERSION}/${zipName}`,
    ];
    const checksumMirrors = [
      checksumUrl,
      `https://npmmirror.com/mirrors/bun/${BUN_VERSION}/SHASUMS256.txt`,
      `https://registry.npmmirror.com/-/binary/bun/${BUN_VERSION}/SHASUMS256.txt`,
    ];

    const zipPath = join(tempDir, zipName);
    const checksumPath = join(tempDir, 'SHASUMS256.txt');
    const cachedZip = join(electronDir, '.cache', 'downloads', zipName);
    if (existsSync(cachedZip)) {
      console.log(`  Using cached ${cachedZip}`);
      copyFileSync(cachedZip, zipPath);
    } else {
      await curlDownload(zipPath, zipMirrors);
      mkdirSync(dirname(cachedZip), { recursive: true });
      copyFileSync(zipPath, cachedZip);
    }
    console.log('  Download complete');

    console.log('  Downloading checksums...');
    await curlDownload(checksumPath, checksumMirrors);

    // Verify checksum
    console.log('  Verifying checksum...');
    const checksumContent = await Bun.file(checksumPath).text();
    const expectedHash = checksumContent
      .split('\n')
      .find((line) => line.includes(`${bunDownload}.zip`))
      ?.split(' ')[0];

    if (!expectedHash) {
      throw new Error(`Checksum not found for ${bunDownload}.zip`);
    }

    const isValid = await verifySha256(zipPath, expectedHash);
    if (!isValid) {
      throw new Error('Checksum verification failed!');
    }
    console.log('  Checksum verified ✓');

    // Extract
    console.log('  Extracting...');
    await extractArchive(zipPath, tempDir);

    // Copy binary
    const sourcePath = join(tempDir, bunDownload, bunBinary);

    copyFileSync(sourcePath, destPath);

    // Make executable on Unix
    if (platform !== 'win32') {
      chmodSync(destPath, 0o755);
    }

    console.log(`  Bun installed to ${destPath} ✓`);
  } finally {
    // Cleanup temp directory
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Find the first matching file recursively under a directory.
 */
function findFileRecursive(root: string, fileName: string): string | null {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const nested = findFileRecursive(fullPath, fileName);
      if (nested) return nested;
    }
  }
  return null;
}

function windowsSystemExecutable(fileName: string): string | null {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!windowsRoot) return null;

  const executable = join(windowsRoot, 'System32', fileName);
  return existsSync(executable) ? executable : null;
}

async function runExecutable(executable: string, args: string[]): Promise<void> {
  const child = Bun.spawn([executable, ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${executable} exited with code ${exitCode}`);
  }
}

async function extractArchive(archivePath: string, destination: string): Promise<void> {
  if (process.platform === 'win32') {
    // Bun's shell can run with a restricted PATH even when Windows system
    // tools exist. Resolve bsdtar by absolute path so ZIP and tar.gz archives
    // work without requiring PowerShell, unzip, or a PATH modification.
    const tar = Bun.which('tar.exe')
      ?? Bun.which('tar')
      ?? windowsSystemExecutable('tar.exe');
    if (!tar) {
      throw new Error('Unable to extract archive: Windows tar.exe was not found');
    }
    await runExecutable(tar, ['-xf', archivePath, '-C', destination]);
    return;
  }

  const executableName = archivePath.endsWith('.zip') ? 'unzip' : 'tar';
  const executable = Bun.which(executableName);
  if (!executable) {
    throw new Error(`Unable to extract archive: ${executableName} was not found`);
  }

  const args = archivePath.endsWith('.zip')
    ? ['-o', archivePath, '-d', destination]
    : ['-xzf', archivePath, '-C', destination];
  await runExecutable(executable, args);
}

/**
 * Download and verify uv binary, then install it to resources/bin/<platform-arch>/uv(.exe).
 */
export async function downloadUv(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config;
  const uvDownload = getUvDownloadName(platform, arch);
  const uvBinaryName = platform === 'win32' ? 'uv.exe' : 'uv';
  const platformKey = getPlatformKey(platform, arch);

  const targetDir = join(electronDir, 'resources', 'bin', platformKey);
  const targetPath = join(targetDir, uvBinaryName);

  // Skip when already provisioned
  if (existsSync(targetPath)) {
    console.log(`uv already present at ${targetPath}`);
    return;
  }

  console.log(`Downloading uv ${UV_VERSION} for ${platformKey}...`);

  mkdirSync(targetDir, { recursive: true });
  const tempDir = join(electronDir, '.uv-download-temp');
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  try {
    const assetUrl = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${uvDownload}`;
    const checksumUrl = `${assetUrl}.sha256`;

    const assetPath = join(tempDir, uvDownload);
    const checksumPath = join(tempDir, `${uvDownload}.sha256`);
    const extractDir = join(tempDir, 'extract');

    await curlDownload(assetPath, [assetUrl]);

    console.log('  Downloading checksum...');
    await curlDownload(checksumPath, [checksumUrl]);

    console.log('  Verifying checksum...');
    const checksumContent = await Bun.file(checksumPath).text();
    const hashMatch = checksumContent.match(/[a-fA-F0-9]{64}/);
    if (!hashMatch) {
      throw new Error(`Unable to parse checksum from ${checksumPath}`);
    }

    const isValid = await verifySha256(assetPath, hashMatch[0]);
    if (!isValid) {
      throw new Error('uv checksum verification failed');
    }
    console.log('  Checksum verified ✓');

    mkdirSync(extractDir, { recursive: true });

    await extractArchive(assetPath, extractDir);

    const extractedUv = findFileRecursive(extractDir, uvBinaryName);
    if (!extractedUv) {
      throw new Error(`Unable to locate ${uvBinaryName} in extracted archive`);
    }

    copyFileSync(extractedUv, targetPath);
    if (platform !== 'win32') {
      chmodSync(targetPath, 0o755);
    }

    console.log(`  uv installed to ${targetPath} ✓`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Download and verify the OfficeCLI binary into
 * resources/bin/<platform-arch>/officecli(.exe).
 */
export async function downloadOfficecli(config: BuildConfig): Promise<void> {
  const { platform, arch, electronDir } = config;
  const platformKey = getPlatformKey(platform, arch);
  const assetName = OFFICECLI_ASSET[platformKey];
  const releaseUrl = OFFICECLI_ASSET_URL[platformKey];
  const expectedHash = OFFICECLI_SHA256[platformKey];
  if (!assetName || !releaseUrl || !expectedHash) {
    throw new Error(`No OfficeCLI build for ${platformKey}`);
  }

  const destName = platform === 'win32' ? 'officecli.exe' : 'officecli';
  const targetDir = join(electronDir, 'resources', 'bin', platformKey);
  const targetPath = join(targetDir, destName);
  const stampPath = join(targetDir, 'officecli.version');

  if (existsSync(targetPath) && existsSync(stampPath)) {
    const stamped = (await Bun.file(stampPath).text()).trim();
    if (stamped === OFFICECLI_VERSION && await verifySha256(targetPath, expectedHash)) {
      console.log(`officecli ${OFFICECLI_VERSION} already present at ${targetPath}`);
      return;
    }
    console.warn(`Cached officecli failed version or checksum verification at ${targetPath}; downloading again.`);
  }

  console.log(`Downloading officecli ${OFFICECLI_VERSION} for ${platformKey}...`);
  mkdirSync(targetDir, { recursive: true });

  const tempDir = join(electronDir, '.officecli-download-temp');
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  try {
    const assetPath = join(tempDir, assetName);
    await curlDownload(assetPath, [
      releaseUrl,
      `https://ghproxy.net/${releaseUrl}`,
    ]);
    if (!(await verifySha256(assetPath, expectedHash))) {
      throw new Error(`officecli checksum verification failed for ${assetName}`);
    }

    copyFileSync(assetPath, targetPath);
    if (platform !== 'win32') {
      chmodSync(targetPath, 0o755);
    }
    if (process.platform === 'darwin' && platform === 'darwin') {
      try {
        await $`xattr -dr com.apple.quarantine ${targetPath}`.quiet();
      } catch {
        // No quarantine xattr is fine
      }
    }
    if (process.platform === 'win32') {
      const escaped = targetPath.replace(/'/g, "''");
      try {
        await $`powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '${escaped}'"`.quiet();
      } catch {
        // Unblock is best-effort; MOTW may already be absent
      }
    }
    await Bun.write(stampPath, `${OFFICECLI_VERSION}\n`);
    console.log(`  officecli installed to ${targetPath} ✓`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Fetch every desktop officecli binary so Mac/Windows installers can be built from either host. */
export async function downloadOfficecliDesktopTargets(
  base: Omit<BuildConfig, 'platform' | 'arch'>,
): Promise<void> {
  for (const target of OFFICECLI_DESKTOP_TARGETS) {
    await downloadOfficecli({ ...base, ...target });
  }
}

/**
 * Clean previous build artifacts
 */
export function cleanBuildArtifacts(config: BuildConfig): void {
  const { electronDir } = config;

  console.log('Cleaning previous builds...');

  const foldersToClean = [
    join(electronDir, 'vendor'),
    join(electronDir, 'node_modules', '@anthropic-ai'),
    join(electronDir, 'packages'),
    join(electronDir, 'release'),
  ];

  for (const folder of foldersToClean) {
    if (existsSync(folder)) {
      rmSync(folder, { recursive: true, force: true });
    }
  }
}

/**
 * Install dependencies
 * On Windows, uses hoisted linker to avoid .bun symlink directory
 */
function collectEsbuildBinaries(dir: string, found: string[]): void {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectEsbuildBinaries(full, found);
      continue;
    }
    if (entry.isFile() && entry.name === 'esbuild' && full.includes(`${join('bin', 'esbuild')}`)) {
      found.push(full);
    }
  }
}

/**
 * macOS 26+ kills ad-hoc/linker-signed Go binaries (esbuild) with
 * `SIGKILL (Code Signature Invalid)`. Re-sign after bun install so local
 * packaging can run. Vite vendors its own copy under node_modules/vite.
 */
export function resignNativeBuildTools(rootDir: string): void {
  if (process.platform !== 'darwin') return;

  const bins: string[] = [];
  collectEsbuildBinaries(join(rootDir, 'node_modules'), bins);

  for (const bin of bins) {
    if (!existsSync(bin) || lstatSync(bin).isSymbolicLink()) continue;
    try {
      execSync(`codesign --force --sign - --timestamp=none ${JSON.stringify(bin)}`, {
        stdio: 'pipe',
      });
      console.log(`Re-signed ${bin}`);
    } catch (err) {
      console.warn(`Failed to re-sign ${bin}:`, err instanceof Error ? err.message : err);
    }
  }
}

export async function installDependencies(config: BuildConfig): Promise<void> {
  const { rootDir, platform } = config;

  if (platform === 'win32') {
    // Use hoisted linker on Windows - Bun's default isolated mode creates
    // node_modules/.bun/ with symlinks that esbuild can't traverse on Windows
    // ("Access is denied" errors with junction points)
    // Hoisted mode creates flat npm-style node_modules without .bun
    console.log('Installing dependencies (Windows hoisted mode)...');
    await $`cd ${rootDir} && bun install --linker=hoisted`.quiet();
  } else {
    console.log('Installing dependencies...');
    await $`cd ${rootDir} && bun install`.quiet();
  }
}

/**
 * Copy @vscode/ripgrep into the staged node_modules. Replaces the previous
 * `vendor/ripgrep/<platform>/rg` shipped by the SDK before 0.2.113.
 */
export function copyRipgrep(config: BuildConfig): void {
  const { rootDir, electronDir } = config;
  const rgSource = join(rootDir, 'node_modules', '@vscode', 'ripgrep');
  const binaryName = config.platform === 'win32' ? 'rg.exe' : 'rg';
  const rgBinary = join(rgSource, 'bin', binaryName);

  if (!existsSync(rgSource) || !existsSync(rgBinary)) {
    throw new Error(
      `@vscode/ripgrep not installed or postinstall did not run. ` +
      `Run 'bun install' and 'bun pm trust @vscode/ripgrep'.`,
    );
  }

  const rgScope = join(electronDir, 'node_modules', '@vscode');
  const rgDest = join(rgScope, 'ripgrep');
  console.log('Copying @vscode/ripgrep...');
  mkdirSync(rgScope, { recursive: true });
  if (existsSync(rgDest)) {
    rmSync(rgDest, { recursive: true, force: true });
  }
  cpSync(rgSource, rgDest, { recursive: true, dereference: true });
}

/**
 * Copy network interceptor source files (Anthropic — runs under Bun via --preload)
 */
export function copyInterceptor(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const sharedSrcDir = join('packages', 'shared', 'src');
  const sourceDir = join(rootDir, sharedSrcDir);
  const destDir = join(electronDir, sharedSrcDir);

  const interceptorSource = join(sourceDir, 'unified-network-interceptor.ts');
  if (!existsSync(interceptorSource)) {
    throw new Error(`Interceptor not found at ${interceptorSource}`);
  }

  console.log('Copying interceptor...');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(interceptorSource, join(destDir, 'unified-network-interceptor.ts'));

  // Also copy shared infrastructure (imported by unified-network-interceptor.ts at runtime)
  const commonSource = join(sourceDir, 'interceptor-common.ts');
  if (existsSync(commonSource)) {
    copyFileSync(commonSource, join(destDir, 'interceptor-common.ts'));
  }

  // Copy request utilities (imported by unified-network-interceptor.ts)
  const requestUtilsSource = join(sourceDir, 'interceptor-request-utils.ts');
  if (existsSync(requestUtilsSource)) {
    copyFileSync(requestUtilsSource, join(destDir, 'interceptor-request-utils.ts'));
  }

  // Copy feature flags (imported by unified-network-interceptor.ts for fast mode / source templates)
  const featureFlagsSource = join(sourceDir, 'feature-flags.ts');
  if (existsSync(featureFlagsSource)) {
    copyFileSync(featureFlagsSource, join(destDir, 'feature-flags.ts'));
  }
}

/**
 * Verify the unified interceptor CJS bundle exists (runs under Node.js via --require)
 * Built by `bun run build:interceptor` into apps/electron/dist/
 */
export function copyInterceptorBundle(config: BuildConfig): void {
  const { electronDir } = config;

  const source = join(electronDir, 'dist', 'interceptor.cjs');
  if (!existsSync(source)) {
    console.warn('Warning: Interceptor bundle not found at', source, '— tool metadata will be unavailable for Pi sessions');
    return;
  }

  // Already in dist/ which is included in the packaged app — just verify it exists
  console.log('Interceptor bundle verified at:', source);
}

/**
 * Copy Session MCP Server to packaged app resources.
 * The session server provides session-scoped tools (SubmitPlan, config_validate, etc.) for agent sessions.
 */
export function copySessionServer(config: BuildConfig): void {
  const { rootDir, electronDir } = config;

  const sessionSource = join(rootDir, 'packages', 'session-mcp-server', 'dist', 'index.js');
  const sessionDest = join(electronDir, 'resources', 'session-mcp-server', 'index.js');

  if (!existsSync(sessionSource)) {
    console.warn(`Warning: Session server not found at ${sessionSource}. Session-scoped tools will not work.`);
    return;
  }

  console.log('Copying Session MCP Server...');
  mkdirSync(dirname(sessionDest), { recursive: true });
  copyFileSync(sessionSource, sessionDest);
}

/**
 * Map our Platform type to koffi's directory naming convention.
 * koffi uses: darwin_arm64, darwin_x64, linux_x64, win32_x64, etc.
 */
function koffiPlatformDir(platform: Platform, arch: Arch): string {
  return `${platform}_${arch}`;
}

/**
 * Copy Pi Agent Server to packaged app resources.
 *
 * The bundle requires a dedicated image resize Worker and Photon WASM, and uses --external
 * koffi so the bare import resolves through node_modules at runtime. We copy
 * the Worker, WASM, and Koffi runtime next to index.js, limiting Koffi to the
 * target platform's native binary (~4MB instead of ~80MB).
 */
export function copyPiAgentServer(config: BuildConfig): void {
  const { rootDir, electronDir, platform, arch } = config;

  const piSourceDir = join(rootDir, 'packages', 'pi-agent-server', 'dist');
  const piDestDir = join(electronDir, 'resources', 'pi-agent-server');
  const photonWasmName = 'photon_rs_bg.wasm';
  const imageResizeWorkerName = 'image-resize-worker.js';
  const photonWasmSource = join(piSourceDir, photonWasmName);
  const imageResizeWorkerSource = join(piSourceDir, imageResizeWorkerName);

  if (!existsSync(join(piSourceDir, 'index.js'))) {
    console.warn(`Warning: Pi agent server not found at ${piSourceDir}/index.js. Pi SDK sessions will not work.`);
    return;
  }
  if (!existsSync(photonWasmSource)) {
    throw new Error(
      `Pi Agent Server Photon WASM not found at ${photonWasmSource}. Run bun run build in packages/pi-agent-server.`,
    );
  }
  if (!existsSync(imageResizeWorkerSource)) {
    throw new Error(
      `Pi Agent Server image resize Worker not found at ${imageResizeWorkerSource}. Run bun run build in packages/pi-agent-server.`,
    );
  }

  console.log('Copying Pi Agent Server...');
  mkdirSync(piDestDir, { recursive: true });

  // 1. Copy the bundle and its image-processing runtime.
  copyFileSync(join(piSourceDir, 'index.js'), join(piDestDir, 'index.js'));
  copyFileSync(imageResizeWorkerSource, join(piDestDir, imageResizeWorkerName));
  copyFileSync(photonWasmSource, join(piDestDir, photonWasmName));

  // 2. Copy koffi npm package (external import, resolved via node_modules at runtime)
  const koffiSource = join(rootDir, 'node_modules', 'koffi');

  if (!existsSync(koffiSource)) {
    console.warn('  Warning: koffi not found in node_modules. Pi SDK sessions may not work.');
    return;
  }

  const koffiDest = join(piDestDir, 'node_modules', 'koffi');
  mkdirSync(koffiDest, { recursive: true });

  // Copy koffi JS files
  for (const entry of ['package.json', 'index.js', 'indirect.js', 'index.d.ts', 'lib']) {
    const src = join(koffiSource, entry);
    if (existsSync(src)) {
      cpSync(src, join(koffiDest, entry), { recursive: true });
    }
  }

  // Copy only the target platform's native binary
  const targetDir = koffiPlatformDir(platform, arch);
  const nativeSrc = join(koffiSource, 'build', 'koffi', targetDir);
  const nativeDest = join(koffiDest, 'build', 'koffi', targetDir);

  if (existsSync(nativeSrc)) {
    mkdirSync(nativeDest, { recursive: true });
    cpSync(nativeSrc, nativeDest, { recursive: true });
    const [nativeBinary] = readdirSync(nativeSrc);
    if (!nativeBinary) {
      throw new Error(`Koffi native binary directory is empty: ${nativeSrc}`);
    }
    const size = lstatSync(join(nativeSrc, nativeBinary)).size;
    console.log(`  Copied index.js + image Worker + Photon WASM + koffi/${targetDir} (${(size / 1024 / 1024).toFixed(1)}MB)`);
  } else {
    console.warn(`  Warning: koffi native binary not found for ${targetDir}`);
    cpSync(join(koffiSource, 'build'), join(koffiDest, 'build'), { recursive: true });
    console.log('  Copied index.js + image Worker + Photon WASM + koffi (all platforms as fallback)');
  }
}

/**
 * Build MCP servers (session) and Pi agent server.
 * Shared across all platforms to avoid drift.
 */
export function buildMcpServers(config: BuildConfig): void {
  const { rootDir } = config;

  const sessionDir = join(rootDir, 'packages', 'session-mcp-server');
  const sessionOut = join(sessionDir, 'dist', 'index.js');
  const piDir = join(rootDir, 'packages', 'pi-agent-server');
  const piOut = join(piDir, 'dist', 'index.js');

  console.log('Building MCP servers...');

  mkdirSync(join(sessionDir, 'dist'), { recursive: true });

  execSync(
    `bun build ${join(sessionDir, 'src', 'index.ts')} --outfile ${sessionOut} --target node --format cjs`,
    { cwd: rootDir, stdio: 'inherit' }
  );

  if (!existsSync(sessionOut)) {
    throw new Error(`Session MCP server output not found at ${sessionOut}`);
  }

  // Pi agent server uses --target=bun --format=esm because its Pi SDK deps are ESM-only.
  // --target=node --format=cjs leaves ESM deps as external require() calls that fail at runtime.
  // koffi is marked external because it's a native N-API module — bun can't inline .node binaries
  // and inlining its JS breaks the native binary resolution paths.
  // Optional: skip if package directory is missing (e.g., not synced to OSS).
  if (existsSync(join(piDir, 'src'))) {
    mkdirSync(join(piDir, 'dist'), { recursive: true });
    execSync('bun run build', { cwd: piDir, stdio: 'inherit' });
    if (!existsSync(piOut)) {
      throw new Error(`Pi agent server output not found at ${piOut}`);
    }
  } else {
    console.warn('Warning: Pi agent server package not found. Pi SDK sessions will not work.');
  }
}

/**
 * Build the WhatsApp worker subprocess (Baileys + Node runtime bundle).
 * Output ships as an extraResource at resources/messaging-whatsapp-worker/worker.cjs
 * and is spawned by WhatsAppAdapter. See electron-builder.yml `extraResources`.
 */
export function buildWhatsAppWorker(config: BuildConfig): void {
  const { rootDir } = config;
  const workerOut = join(rootDir, 'packages', 'messaging-whatsapp-worker', 'dist', 'worker.cjs');

  console.log('Building WhatsApp worker...');

  execSync('bun run build:wa-worker', { cwd: rootDir, stdio: 'inherit' });

  if (!existsSync(workerOut)) {
    throw new Error(`WhatsApp worker output not found at ${workerOut}`);
  }
}

/**
 * Verify MCP helper servers and Pi agent server are present in packaged resources.
 */
export function verifyMcpServersExist(config: BuildConfig): void {
  const { electronDir } = config;

  const sessionPath = join(electronDir, 'resources', 'session-mcp-server', 'index.js');
  const piPath = join(electronDir, 'resources', 'pi-agent-server', 'index.js');
  const imageResizeWorkerPath = join(electronDir, 'resources', 'pi-agent-server', 'image-resize-worker.js');
  const photonWasmPath = join(electronDir, 'resources', 'pi-agent-server', 'photon_rs_bg.wasm');

  if (!existsSync(sessionPath)) {
    throw new Error(`Session MCP server not found at ${sessionPath}`);
  }
  if (!existsSync(piPath)) {
    console.warn(`Warning: Pi agent server not found at ${piPath}. Pi SDK sessions will not work.`);
    return;
  }
  if (!existsSync(photonWasmPath)) {
    throw new Error(`Pi Agent Server Photon WASM not found at ${photonWasmPath}`);
  }
  if (!existsSync(imageResizeWorkerPath)) {
    throw new Error(`Pi Agent Server image resize Worker not found at ${imageResizeWorkerPath}`);
  }
}

/**
 * Build the Electron app (main, preload, renderer)
 */
export async function buildElectronApp(config: BuildConfig): Promise<void> {
  const { rootDir } = config;

  console.log('Building Electron app...');
  await $`cd ${rootDir} && bun run electron:build`;
}

/**
 * Create manifest.json for upload
 */
export async function createManifest(config: BuildConfig): Promise<string> {
  const { rootDir, electronDir } = config;

  const packageJson = await Bun.file(join(electronDir, 'package.json')).json();
  const version = packageJson.version;

  const uploadDir = join(rootDir, '.build', 'upload');
  mkdirSync(uploadDir, { recursive: true });

  const manifestPath = join(uploadDir, 'manifest.json');
  await Bun.write(manifestPath, JSON.stringify({ version }, null, 2));

  console.log(`Created manifest.json (version: ${version})`);
  return version;
}

/**
 * Upload to S3
 */
export async function uploadToS3(config: BuildConfig): Promise<void> {
  const { rootDir, upload, uploadLatest, uploadScript } = config;

  if (!upload) return;

  // Check for required env vars
  const required = [
    'S3_VERSIONS_BUCKET_ENDPOINT',
    'S3_VERSIONS_BUCKET_ACCESS_KEY_ID',
    'S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing S3 credentials: ${missing.join(', ')}`);
  }

  console.log('\n=== Uploading to S3 ===');

  const flags = ['--electron'];
  if (uploadLatest) flags.push('--latest');
  if (uploadScript) flags.push('--script');

  await $`cd ${rootDir} && bun run scripts/upload.ts ${flags}`;

  console.log('Upload complete ✓');
}

/**
 * Load environment variables from .env file
 */
export async function loadEnvFile(config: BuildConfig): Promise<void> {
  const envPath = join(config.rootDir, '.env');

  if (existsSync(envPath)) {
    const content = await Bun.file(envPath).text();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          process.env[key] = value;
        }
      }
    }
  }
}

/**
 * Get output artifact name for a platform/arch
 */
export function getArtifactName(platform: Platform, arch: Arch): string {
  switch (platform) {
    case 'darwin':
      return `Selection-${arch}.dmg`;
    case 'win32':
      return `Selection-${arch}.exe`;
    case 'linux':
      return `Selection-${arch}.AppImage`;
  }
}
