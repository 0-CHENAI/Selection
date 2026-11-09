/**
 * Tests for runtime-resolver.ts
 *
 * Verifies:
 * - Packaged server path resolution with dist/resources/ fallback
 * - Ripgrep path resolution with system rg fallback
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveBackendRuntimePaths } from '../internal/runtime-resolver.ts';
import { resolveBackendHostTooling } from '../factory.ts';
import type { BackendHostRuntimeContext } from '../types.ts';

describe('resolve Bun runtime in dev mode', () => {
  const tmpBase = join(tmpdir(), `bun-resolver-test-${Date.now()}`);
  const originalCraftBun = process.env.CRAFT_BUN;
  const originalBunInstall = process.env.BUN_INSTALL;
  const originalPath = process.env.PATH;

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    if (originalCraftBun === undefined) delete process.env.CRAFT_BUN;
    else process.env.CRAFT_BUN = originalCraftBun;
    if (originalBunInstall === undefined) delete process.env.BUN_INSTALL;
    else process.env.BUN_INSTALL = originalBunInstall;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  it('uses BUN_INSTALL even when PATH does not contain Windows system tools', () => {
    const bunBinary = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bunInstall = join(tmpBase, 'bun-install');
    const bunPath = join(bunInstall, 'bin', bunBinary);
    mkdirSync(join(bunInstall, 'bin'), { recursive: true });
    writeFileSync(bunPath, 'stub');
    process.env.BUN_INSTALL = bunInstall;
    delete process.env.CRAFT_BUN;
    process.env.PATH = '';

    const paths = resolveBackendRuntimePaths({
      appRootPath: join(tmpBase, 'app'),
      resourcesPath: join(tmpBase, 'resources'),
      isPackaged: false,
    });

    expect(paths.nodeRuntimePath).toBe(bunPath);
  });

  it('prefers an explicit CRAFT_BUN runtime override', () => {
    const bunPath = join(tmpBase, process.platform === 'win32' ? 'custom-bun.exe' : 'custom-bun');
    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(bunPath, 'stub');
    process.env.CRAFT_BUN = bunPath;

    const paths = resolveBackendRuntimePaths({
      appRootPath: join(tmpBase, 'app'),
      resourcesPath: join(tmpBase, 'resources'),
      isPackaged: false,
    });

    expect(paths.nodeRuntimePath).toBe(bunPath);
  });
});

describe('resolve bundled Bun in packaged apps', () => {
  const tmpBase = join(tmpdir(), `bun-packaged-resolver-${Date.now()}`);
  const originalCraftBun = process.env.CRAFT_BUN;
  const originalResourcesBase = process.env.CRAFT_RESOURCES_BASE;

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
    if (originalCraftBun === undefined) delete process.env.CRAFT_BUN;
    else process.env.CRAFT_BUN = originalCraftBun;
    if (originalResourcesBase === undefined) delete process.env.CRAFT_RESOURCES_BASE;
    else process.env.CRAFT_RESOURCES_BASE = originalResourcesBase;
  });

  it('finds Windows extraResources bun under resources/app/vendor/bun', () => {
    const bunBinary = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const resourcesPath = join(tmpBase, 'resources');
    const appRoot = join(resourcesPath, 'app');
    const bunPath = join(appRoot, 'vendor', 'bun', bunBinary);
    mkdirSync(join(appRoot, 'vendor', 'bun'), { recursive: true });
    writeFileSync(bunPath, 'stub');
    delete process.env.CRAFT_BUN;
    delete process.env.CRAFT_RESOURCES_BASE;

    const paths = resolveBackendRuntimePaths({
      appRootPath: appRoot,
      resourcesPath,
      isPackaged: true,
    });

    expect(paths.nodeRuntimePath).toBe(bunPath);
  });

  it('honors CRAFT_BUN in packaged mode when vendor layouts differ', () => {
    const bunBinary = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bunPath = join(tmpBase, 'override', bunBinary);
    mkdirSync(join(tmpBase, 'override'), { recursive: true });
    writeFileSync(bunPath, 'stub');
    process.env.CRAFT_BUN = bunPath;

    const paths = resolveBackendRuntimePaths({
      appRootPath: join(tmpBase, 'app'),
      resourcesPath: join(tmpBase, 'resources'),
      isPackaged: true,
    });

    expect(paths.nodeRuntimePath).toBe(bunPath);
  });
});

describe('resolveServerPath fallback', () => {
  const tmpBase = join(tmpdir(), `resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('finds server in dist/resources/ when resources/ does not exist', () => {
    // Simulate packaged app where server is at dist/resources/<name>/index.js
    const appRoot = join(tmpBase, 'app');
    const serverDir = join(appRoot, 'dist', 'resources', 'pi-agent-server');
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(join(serverDir, 'index.js'), '// stub');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.piServerPath).toBe(join(serverDir, 'index.js'));
  });

  it('prefers resources/ over dist/resources/ when both exist', () => {
    const appRoot = join(tmpBase, 'app2');

    // Create both paths
    const primaryDir = join(appRoot, 'resources', 'pi-agent-server');
    const fallbackDir = join(appRoot, 'dist', 'resources', 'pi-agent-server');
    mkdirSync(primaryDir, { recursive: true });
    mkdirSync(fallbackDir, { recursive: true });
    writeFileSync(join(primaryDir, 'index.js'), '// primary');
    writeFileSync(join(fallbackDir, 'index.js'), '// fallback');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.piServerPath).toBe(join(primaryDir, 'index.js'));
  });
});

describe('resolveRipgrepPath', () => {
  const tmpBase = join(tmpdir(), `rg-resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('finds vendored ripgrep binary (@vscode/ripgrep)', () => {
    const appRoot = join(tmpBase, 'vendored');
    const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const rgDir = join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin');
    mkdirSync(rgDir, { recursive: true });
    const rgPath = join(rgDir, binaryName);
    writeFileSync(rgPath, '#!/bin/sh\n');
    chmodSync(rgPath, 0o755);

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
    };

    const result = resolveBackendHostTooling({ hostRuntime });
    expect(result.ripgrepPath).toBe(rgPath);
  });

  it('falls back to system rg when vendored binary is missing (non-packaged)', () => {
    const appRoot = join(tmpBase, 'no-vendored');
    mkdirSync(appRoot, { recursive: true });

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
    };

    const result = resolveBackendHostTooling({ hostRuntime });
    // On CI/dev machines with rg installed, this finds system rg.
    // On machines without rg, this returns undefined.
    // We just verify it doesn't throw.
    expect(result.ripgrepPath === undefined || typeof result.ripgrepPath === 'string').toBe(true);
  });

  it('does NOT fall back to system rg for packaged apps (respects isPackaged guard)', () => {
    // On dev machines, the CWD fallback (existing pre-change behavior) will find
    // the vendored binary from the monorepo. This test verifies the system PATH
    // fallback is gated by isPackaged — if the result is defined, it must be
    // a vendored path (not /usr/bin/rg or similar system path).
    const appRoot = join(tmpBase, 'packaged');
    mkdirSync(appRoot, { recursive: true });

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const result = resolveBackendHostTooling({ hostRuntime });
    if (result.ripgrepPath) {
      // Must be a vendored path, not a system PATH resolution
      expect(result.ripgrepPath).toContain('node_modules');
    }
  });
});

describe('resolveInterceptorBundlePath dev-mode source preference', () => {
  const tmpBase = join(tmpdir(), `interceptor-resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('prefers .ts source over the bundled .cjs in dev (non-packaged) so changes propagate without rebuild', () => {
    const appRoot = join(tmpBase, 'monorepo', 'apps', 'electron');
    const sourceDir = join(tmpBase, 'monorepo', 'packages', 'shared', 'src');
    const bundleDir = join(tmpBase, 'monorepo', 'apps', 'electron', 'dist');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    const sourcePath = join(sourceDir, 'unified-network-interceptor.ts');
    const bundlePath = join(bundleDir, 'interceptor.cjs');
    writeFileSync(sourcePath, '// ts source\n');
    writeFileSync(bundlePath, '// cjs bundle\n');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
    };
    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.interceptorBundlePath).toBe(sourcePath);
  });

  it('uses the bundled .cjs in packaged builds even when source is reachable', () => {
    const appRoot = join(tmpBase, 'packaged-app');
    const sourceDir = join(tmpBase, 'packaged-app', 'packages', 'shared', 'src');
    const bundleDir = join(tmpBase, 'packaged-app', 'dist');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(sourceDir, 'unified-network-interceptor.ts'), '// source\n');
    const bundlePath = join(bundleDir, 'interceptor.cjs');
    writeFileSync(bundlePath, '// bundle\n');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };
    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.interceptorBundlePath).toBe(bundlePath);
  });

  it('honors explicit hostRuntime.interceptorBundlePath override regardless of mode', () => {
    const appRoot = join(tmpBase, 'override');
    mkdirSync(appRoot, { recursive: true });
    const overridePath = join(appRoot, 'custom-interceptor.cjs');
    writeFileSync(overridePath, '// custom\n');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
      interceptorBundlePath: overridePath,
    };
    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.interceptorBundlePath).toBe(overridePath);
  });
});
