import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
  officecliBinaryName,
  resolveOfficecliBinary,
  resolveOfficecliRuntime,
} from './officecli.ts';

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'officecli-runtime-'));
  tempRoots.push(root);
  return root;
}

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'fixture');
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('OfficeCLI runtime resolution', () => {
  it('uses the explicit managed binary first', () => {
    const root = tempRoot();
    const binary = join(root, 'custom-officecli');
    touch(binary);

    expect(resolveOfficecliRuntime({ env: { CRAFT_OFFICECLI: binary }, cwd: root })).toEqual({
      path: binary,
      source: 'environment',
    });
  });

  it('normalizes a relative explicit path to an absolute binary path', () => {
    const root = tempRoot();
    const binary = join(root, 'bin', 'officecli');
    touch(binary);

    expect(resolveOfficecliBinary({
      env: { CRAFT_OFFICECLI: join('bin', 'officecli') },
      cwd: root,
    })).toBe(binary);
  });

  it('normalizes a relative cwd before resolving development resources', () => {
    const root = tempRoot();
    const binary = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, officecliBinaryName());
    touch(binary);

    expect(resolveOfficecliBinary({
      env: {},
      cwd: relative(process.cwd(), root),
    })).toBe(binary);
  });

  it('resolves Electron platform resources', () => {
    const root = tempRoot();
    const binary = join(root, 'resources', 'bin', 'darwin-arm64', 'officecli');
    touch(binary);

    expect(resolveOfficecliRuntime({
      env: { CRAFT_RESOURCES_BASE: root },
      cwd: join(root, 'empty'),
      platform: 'darwin',
      arch: 'arm64',
    })).toEqual({ path: binary, source: 'electron-resources' });
  });

  it('resolves the flat headless server resource', () => {
    const root = tempRoot();
    const binary = join(root, 'resources', 'bin', 'officecli');
    touch(binary);

    expect(resolveOfficecliRuntime({
      env: { CRAFT_BUNDLED_ASSETS_ROOT: root },
      cwd: join(root, 'empty'),
      platform: 'linux',
      arch: 'x64',
    })).toEqual({ path: binary, source: 'server-resources' });
  });

  it('resolves the repository development resource', () => {
    const root = tempRoot();
    const binary = join(root, 'apps', 'electron', 'resources', 'bin', 'darwin-x64', 'officecli');
    touch(binary);

    expect(resolveOfficecliBinary({
      env: {},
      cwd: root,
      platform: 'darwin',
      arch: 'x64',
    })).toBe(binary);
  });

  it('does not search PATH', () => {
    const root = tempRoot();
    const pathDir = join(root, 'path-bin');
    const binary = join(pathDir, 'officecli');
    const cwd = join(root, 'empty');
    touch(binary);
    mkdirSync(cwd);

    expect(resolveOfficecliBinary({
      env: { PATH: pathDir },
      cwd,
      platform: 'linux',
      arch: 'x64',
    })).toBeUndefined();
  });

  it('uses the platform executable name', () => {
    expect(officecliBinaryName('win32')).toBe('officecli.exe');
    expect(officecliBinaryName('linux')).toBe('officecli');
  });
});
