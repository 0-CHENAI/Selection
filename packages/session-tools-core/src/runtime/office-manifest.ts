import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OfficecliManifest } from '../office-types.ts';

const MANIFEST_NAME = 'officecli-manifest.json';
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

interface ManifestCacheEntry {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  manifest: OfficecliManifest;
}

const manifestCache = new Map<string, ManifestCacheEntry>();

export interface ResolvedOfficecliResources {
  root: string;
  versionRoot: string;
  manifestPath: string;
  manifest: OfficecliManifest;
}

export interface ResolveOfficecliResourcesOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  explicitRoot?: string;
}

function manifestAt(root: string): string | undefined {
  const candidate = join(root, MANIFEST_NAME);
  if (!existsSync(candidate)) return undefined;
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function loadManifest(path: string): OfficecliManifest {
  const stats = statSync(path);
  const { mtimeMs, ctimeMs, size } = stats;
  const cached = manifestCache.get(path);
  if (cached?.mtimeMs === mtimeMs && cached.ctimeMs === ctimeMs && cached.size === size) return cached.manifest;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as OfficecliManifest;
  const policy = parsed.commandPolicy;
  const policyValid = policy
    && ['read', 'edit', 'preview', 'lifecycle', 'admin'].every(category => {
      const commands = policy[category as keyof typeof policy];
      return Array.isArray(commands)
        && commands.every(command => typeof command === 'string' && /^[a-z][a-z0-9_-]*$/.test(command));
    });
  const assetsValid = parsed.assets
    && Object.values(parsed.assets).every(asset => (
      asset
      && typeof asset.name === 'string'
      && typeof asset.url === 'string'
      && /^[0-9a-f]{64}$/.test(asset.sha256)
    ));
  const compatibilityKeys = Object.keys(parsed.compatibilityRecipes ?? {});
  const importRecipe = parsed.compatibilityRecipes?.importViaAtomicBatch;
  const compatibilityValid = compatibilityKeys.every(key => key === 'importViaAtomicBatch')
    && (!importRecipe || (
      importRecipe.enabled === true
      && Number.isInteger(importRecipe.maxSourceBytes)
      && importRecipe.maxSourceBytes > 0
      && importRecipe.maxSourceBytes <= 50_000_000
      && typeof importRecipe.reason === 'string'
      && importRecipe.reason.trim().length >= 20
    ));
  if (
    parsed.manifestVersion !== 1
    || !/^\d+\.\d+\.\d+$/.test(parsed.version)
    || parsed.tag !== `v${parsed.version}`
    || !/^[0-9a-f]{40}$/.test(parsed.tagCommit)
    || !/^[0-9a-f]{8}$/.test(parsed.schemaCrc)
    || !assetsValid
    || !parsed.guides
    || !policyValid
    || !compatibilityValid
    || !Array.isArray(parsed.externalDependencies)
  ) {
    throw new Error(`Invalid OfficeCLI manifest: ${path}`);
  }
  manifestCache.set(path, { mtimeMs, ctimeMs, size, manifest: parsed });
  return parsed;
}

function candidateRoots(options: ResolveOfficecliResourcesOptions): string[] {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const roots: string[] = [];
  if (options.explicitRoot) roots.push(options.explicitRoot);
  if (env.CRAFT_OFFICECLI_RESOURCES) roots.push(env.CRAFT_OFFICECLI_RESOURCES);
  if (env.CRAFT_RESOURCES_BASE) {
    roots.push(
      join(env.CRAFT_RESOURCES_BASE, 'resources', 'officecli'),
      join(env.CRAFT_RESOURCES_BASE, 'officecli'),
    );
  }
  for (const base of [env.CRAFT_BUNDLED_ASSETS_ROOT, env.CRAFT_RESOURCES_PATH]) {
    if (!base) continue;
    roots.push(join(base, 'resources', 'officecli'), join(base, 'officecli'));
  }
  roots.push(
    join(cwd, 'apps', 'electron', 'resources', 'officecli'),
    join(cwd, 'resources', 'officecli'),
    resolve(moduleDirectory, '../../../../apps/electron/resources/officecli'),
  );
  return [...new Set(roots.map(root => resolve(root)))];
}

export function resolveOfficecliResources(
  options: ResolveOfficecliResourcesOptions = {},
): ResolvedOfficecliResources | undefined {
  for (const root of candidateRoots(options)) {
    const manifestPath = manifestAt(root);
    if (!manifestPath) continue;
    const manifest = loadManifest(manifestPath);
    const versionRoot = join(root, manifest.version);
    if (!existsSync(versionRoot)) continue;
    return { root, versionRoot, manifestPath, manifest };
  }
  return undefined;
}

export function clearOfficecliManifestCache(): void {
  manifestCache.clear();
}
