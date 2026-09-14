import { expect, test } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { snapshotAgentInput } from './agent-input-snapshot.ts';

test('captures exact model-facing input, isolates mutations and hashes private runtime configuration', async () => {
  const input = { systemPrompt: 'platform', message: 'graph', images: [{ type: 'image' as const, data: 'AQ==', mimeType: 'image/png' }] };
  const runtime = { messages: [], tools: [{ name: 'tool', description: 'description', parameters: Type.Object({}) }],
    model: { id: 'model', api: 'openai-completions', provider: 'provider', contextWindow: 100000 },
    configuration: { baseUrl: 'https://example.invalid', headers: { authorization: 'private-token' } } };
  const snapshot = await snapshotAgentInput(input, runtime);
  expect(JSON.stringify(snapshot)).not.toContain('private-token');
  expect(snapshot.context.messages[0]?.content).toEqual([{ type: 'text', text: 'graph' }, ...input.images]);
  expect((await snapshotAgentInput(input, runtime)).hash).toBe(snapshot.hash);
  runtime.configuration.headers.authorization = 'rotated';
  expect((await snapshotAgentInput(input, runtime)).hash).not.toBe(snapshot.hash);
  runtime.tools[0]!.description = 'changed';
  input.images[0]!.data = 'Ag==';
  expect(snapshot.context.tools?.[0]?.description).toBe('description');
  expect(JSON.stringify(snapshot.context)).toContain('AQ==');
});
