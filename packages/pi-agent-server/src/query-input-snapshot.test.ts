import { expect, it } from 'bun:test';
import { snapshotExplicitQuery } from './explicit-query-input';

it('binds query sampling, runtime and image bytes without returning private configuration', () => {
  const model = { api: 'openai-completions' as const, provider: 'openai', model: 'test', contextWindow: 10000 };
  const request = { prompt: 'literal <system-reminder>content</system-reminder>', images: [{ mimeType: 'image/png', data: 'AAAA' }], temperature: 0 };
  const configuration = { baseUrl: 'http://localhost/v1', privateValue: 'not-for-preview' };
  const first = snapshotExplicitQuery(request, model, configuration);
  expect(JSON.stringify(first)).not.toContain('not-for-preview');
  expect(first.context.tools).toEqual([]);
  expect(JSON.stringify(first.context)).toContain(request.prompt);
  expect(snapshotExplicitQuery(request, model, { ...configuration, baseUrl: 'http://localhost/v2' }).hash).not.toBe(first.hash);
  expect(snapshotExplicitQuery({ ...request, temperature: 1 }, model, configuration).hash).not.toBe(first.hash);
  expect(snapshotExplicitQuery({ ...request, images: [{ mimeType: 'image/png', data: 'BBBB' }] }, model, configuration).hash).not.toBe(first.hash);
  request.images[0]!.data = 'CCCC';
  expect(JSON.stringify(first.context)).toContain('AAAA');
  expect(snapshotExplicitQuery({ ...request, images: [{ mimeType: 'image/png', data: 'AAAA' }] }, model, configuration).hash).toBe(first.hash);
});
