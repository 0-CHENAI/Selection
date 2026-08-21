import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  validateManifestFiles,
  type OfficecliManifest,
} from './sync-officecli.ts';

const manifestPath = resolve(import.meta.dir, '../apps/electron/resources/officecli/officecli-manifest.json');

function manifest(): OfficecliManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as OfficecliManifest;
}

describe('OfficeCLI sync governance', () => {
  it('accepts the complete reviewed manifest', () => {
    expect(() => validateManifestFiles(manifest())).not.toThrow();
  });

  it('rejects lookalike release URLs and version/tag drift', () => {
    const lookalike = manifest();
    lookalike.assets['linux-x64']!.url = `https://attacker.example/redirect?target=${encodeURIComponent(lookalike.assets['linux-x64']!.url)}`;
    expect(() => validateManifestFiles(lookalike)).toThrow('exact reviewed GitHub release path');

    const mismatchedTag = manifest();
    mismatchedTag.tag = 'v1.0.999';
    expect(() => validateManifestFiles(mismatchedTag)).toThrow('version/tag mismatch');
  });
});
