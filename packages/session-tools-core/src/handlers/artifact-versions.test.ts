import { expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleArtifactVersions } from './artifact-versions.ts';

test('requires an exact version identity before requesting restoration', async () => {
  const calls: unknown[] = [];
  const ctx = { artifactVersions: async (request: unknown) => { calls.push(request); return { currentVersion: 'new' }; } } as SessionToolContext;
  expect((await handleArtifactVersions(ctx, { action: 'restore', artifactId: 'artifact', versionId: 'old' })).isError).toBe(true);
  expect(calls).toHaveLength(0);
  const request = { action: 'restore' as const, artifactId: 'artifact', versionId: 'old', expectedVersion: 'current' };
  expect((await handleArtifactVersions(ctx, request)).isError).toBeFalsy();
  expect(calls).toEqual([request]);
});

test('lists versions by path and surfaces a conflict without retrying', async () => {
  const ctx = { artifactVersions: async (request: { action: string }) => {
    if (request.action === 'restore') throw new Error('Artifact changed outside this operation');
    return { versions: [{ id: 'old' }] };
  } } as SessionToolContext;
  expect((await handleArtifactVersions(ctx, { action: 'list', path: '/workspace/report.docx' })).isError).toBeFalsy();
  const conflict = await handleArtifactVersions(ctx, { action: 'restore', artifactId: 'artifact', versionId: 'old', expectedVersion: 'current' });
  expect(conflict.isError).toBe(true);
  expect(conflict.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Artifact changed') });
});
