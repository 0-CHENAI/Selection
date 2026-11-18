import { expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

for (const [api, path] of [
  ['openai-responses', '/v1/responses'],
  ['openai-completions', '/v1/chat/completions'],
] as const) {
  it(`keeps Pi's strict read schema on ${path} after adding UI metadata`, async () => {
    const requests: Array<{ path: string; tool: Record<string, unknown> }> = [];
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        const body = await request.json();
        requests.push({
          path: new URL(request.url).pathname,
          tool: api === 'openai-responses' ? body.tools[0] : body.tools[0].function,
        });
        // The outgoing request is under test. End the SDK stream without a retry.
        return Response.json({ error: { message: 'End of local capture' } }, { status: 400 });
      },
    });
    const configDir = mkdtempSync(join(tmpdir(), 'pi-strict-tools-'));
    try {
      const interceptor = resolve(import.meta.dir, '../../shared/src/unified-network-interceptor.ts');
      const client = `
        import { getModel, streamSimple } from '@earendil-works/pi-ai/compat';
        import { createReadToolDefinition } from '@earendil-works/pi-coding-agent';
        const model = { ...getModel('openai', 'gpt-4o'), api: process.env.CRAFT_PI_MODEL_API,
          baseUrl: ${JSON.stringify(server.url.origin + '/v1')}, compat: { supportsStrictMode: true } };
        await streamSimple(model, {
          tools: [createReadToolDefinition(process.cwd())],
          messages: [{ role: 'user', content: 'test', timestamp: 1 }],
        }, { apiKey: 'sk-local-test', maxRetries: 0 }).result();
      `;
      const child = Bun.spawn([process.execPath, '--preload', interceptor, '--eval', client], {
        cwd: resolve(import.meta.dir, '../../..'),
        env: { ...process.env, CRAFT_CONFIG_DIR: configDir, CRAFT_SESSION_DIR: configDir,
          CRAFT_PI_MODEL_API: api, CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0', NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
        stdout: 'ignore', stderr: 'pipe',
      });
      try {
        const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        expect(exit, stderr).toBe(0);
      } finally { child.kill(); }
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ path, tool: { name: 'read', strict: true, parameters: {
        additionalProperties: false,
        properties: { _intent: { type: 'string' }, _displayName: { type: 'string' }, path: { type: 'string' } },
        required: expect.arrayContaining(['path', 'offset', 'limit', '_intent', '_displayName']),
      } } });
    } finally {
      server.stop(true);
      rmSync(configDir, { recursive: true, force: true });
    }
  });
}
