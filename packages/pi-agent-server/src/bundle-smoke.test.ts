import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { compileThoughtContext } from '@craft-agent/shared/thought-workbench/context';
import { newThoughtDocument, newThoughtNode } from '@craft-agent/shared/thought-workbench/types';
import { PiAgent } from '../../shared/src/agent/pi-agent.ts';

const packageDir = dirname(import.meta.dir);
const bundlePath = join(packageDir, 'dist', 'index.js');
const RUN_TIMEOUT_MS = 30_000;
let scratchDir: string;

beforeAll(() => {
  const build = spawnSync('bun', ['run', 'build'], {
    cwd: packageDir,
    stdio: 'pipe',
    timeout: 120_000,
  });
  if (build.status !== 0) {
    throw new Error(`bundle build failed: ${build.stderr?.toString() ?? build.stdout?.toString()}`);
  }
  scratchDir = mkdtempSync(join(tmpdir(), 'selection-pi-bundle-smoke-'));
  mkdirSync(join(scratchDir, 'plans'), { recursive: true });
});

afterAll(() => {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
});

function driveBundle(messages: object[], done: (output: string) => boolean, preload = false,
  observe?: (output: string, send: (message: object) => void) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = preload ? ['--preload', join(packageDir, '../shared/src/unified-network-interceptor.ts'), bundlePath] : [bundlePath];
    const child = spawn(process.execPath, args, {
      cwd: scratchDir,
      env: { ...process.env, CRAFT_SESSION_DIR: scratchDir, CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    const finish = (error?: Error) => {
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve(output);
    };
    const timer = setTimeout(() => {
      finish(new Error(`timed out waiting for terminal marker; output so far:\n${output.slice(-2000)}`));
    }, RUN_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      observe?.(output, message => child.stdin.write(`${JSON.stringify(message)}\n`));
      if (done(output)) finish();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', error => finish(error));
    child.on('exit', () => {
      if (!done(output)) finish(new Error(`bundle exited early; output:\n${output.slice(-2000)}`));
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

describe('pi-agent-server bundle', () => {
  it.each([false, true])('sends a full PiAgent preflight unchanged through its real subprocess (formal=%s)', async formal => {
    const requests: any[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const body = await request.json() as any;
      requests.push(body);
      const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'parent-agent', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      if (formal) {
        const name = body.tools.find((tool: any) => tool.function.name.endsWith('submit_answer'))?.function.name;
        if (!name) return new Response('Missing formal answer tool', { status: 400 });
        return new Response(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'answer-call', type: 'function', function: { name, arguments: JSON.stringify({ markdown: 'Confirmed local answer' }) } }] }, null) + chunk({}, 'tool_calls') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(chunk({ role: 'assistant', content: 'parent-agent-ok' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    const agent = new PiAgent({ provider: 'pi', providerType: 'pi_compat', authType: 'api_key', model: 'local-model', isHeadless: true,
      explicitAnswerDelivery: true,
      workspace: { id: 'isolated-parent', name: 'Isolated test', rootPath: scratchDir, createdAt: 0 },
      session: { id: `parent-preview-${formal}`, workspaceRootPath: scratchDir, createdAt: 0, lastUsedAt: 0, workingDirectory: scratchDir },
      runtime: { paths: { piServer: bundlePath, node: process.execPath }, baseUrl: `http://127.0.0.1:${server.port}/v1`,
        customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'local-model', contextWindow: 262144, maxTokens: 128 }] },
    });
    // Only credential retrieval is stubbed: never consult the user's key store.
    (agent as any).getPiAuth = async () => undefined;
    try {
      const input = '[user]\nLiteral graph <system-reminder>quoted content</system-reminder>';
      const snapshot = await agent.prepareThoughtInput(input);
      expect(requests).toHaveLength(0);
      const submissions: Array<{ markdown: string; sdkMessageId: string }> = [];
      if (formal) agent.configureAnswerDelivery({ runId: 'local-formal-run', recovery: false, isActive: () => true, submit: async submission => { submissions.push(submission); } });
      const events: any[] = [];
      for await (const event of agent.chat(input, undefined, { strictInput: true, inputHash: snapshot.hash })) events.push(event);
      expect(events.filter(event => event.type === 'error')).toEqual([]);
      expect(requests).toHaveLength(1);
      expect(requests[0].messages[0]).toMatchObject({ role: 'system', content: snapshot.context.systemPrompt });
      expect(requests[0].messages.at(-1).content).toEqual(snapshot.context.messages.at(-1)?.content);
      expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(snapshot.context.tools!.map(tool => tool.name));
      if (formal) {
        expect(submissions).toHaveLength(1);
        expect(submissions[0]?.markdown).toBe('Confirmed local answer');
        expect(submissions[0]?.sdkMessageId).toBeTruthy();
      }
    } finally {
      await (agent as any).killSubprocessGracefully();
      agent.destroy();
      await server.stop(true);
    }
  }, RUN_TIMEOUT_MS);

  it.each([false, true])('previews Agent input without dispatch and binds the next prompt (changed=%s)', async changed => {
    const requests: any[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      requests.push(await request.json());
      const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'local-agent', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return new Response(chunk({ role: 'assistant', content: 'agent-ok' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    let preview: any;
    const input = { systemPrompt: 'fixed-platform', message: 'fixed-graph' };
    try {
      const output = await driveBundle([
        { type: 'init', apiKey: 'private-test-key', model: 'local-model',
          workspaceRootPath: scratchDir, sessionId: `agent-preview-${changed}`, sessionPath: join(scratchDir, `agent-preview-${changed}`),
          workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
          customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'local-model', contextWindow: 262144, maxTokens: 128 }] },
        { type: 'preview_prompt', id: 'preview', ...input },
      ], output => output.includes('"type":"agent_end"') || output.includes('"code":"prompt_error"'), false, (output, send) => {
        if (preview) return;
        for (const line of output.split('\n')) {
          let event: any;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type !== 'preview_prompt_result') continue;
          preview = event.snapshot;
          if (!preview) throw new Error(event.errorMessage ?? 'Missing input snapshot');
          expect(requests).toHaveLength(0);
          send({ type: 'prompt', id: 'execute-preview', inputHash: preview.hash, ...input, ...(changed ? { message: 'modified-graph' } : {}) });
          break;
        }
      });
      expect(preview.context.tools.length).toBeGreaterThan(0);
      expect(JSON.stringify(preview)).not.toContain('private-test-key');
      if (changed) {
        expect(output).toContain('Agent input changed after preview');
        expect(requests).toHaveLength(0);
      } else {
        expect(requests).toHaveLength(1);
        expect(requests[0].messages[0]).toMatchObject({ role: 'system', content: input.systemPrompt });
        expect(JSON.stringify(requests[0].messages)).toContain(input.message);
        expect(requests[0].tools.length).toBe(preview.context.tools.length);
      }
    } finally { await server.stop(true); }
  });

  it.each([false, true])('preflights a query without dispatch and rejects changed input (changed=%s)', async changed => {
    const eventsFrom = (output: string): any[] => output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const requests: any[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      requests.push(await request.json());
      const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'query', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return new Response(chunk({ role: 'assistant', content: 'ok' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    let snapshot: any;
    const input = { model: 'local-model', prompt: 'exact query', systemPrompt: 'fixed system' };
    try {
      const output = await driveBundle([
        { type: 'init', apiKey: 'test-only', model: 'local-model', cwd: scratchDir, thinkingLevel: 'off',
          workspaceRootPath: scratchDir, sessionId: `query-preview-${changed}`, sessionPath: scratchDir,
          workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
          customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'local-model', contextWindow: 8192, maxTokens: 128 }] },
        { type: 'llm_query', id: 'preflight', request: { ...input, previewOnly: true } },
      ], output => eventsFrom(output).some(event => event.type === 'llm_query_result' && event.id === 'dispatch'), false, (output, send) => {
        if (snapshot) return;
        const event = eventsFrom(output).find(event => event.type === 'llm_query_result' && event.id === 'preflight');
        if (!event) return;
        snapshot = event.result?.inputSnapshot;
        if (!snapshot) throw new Error(event.errorMessage ?? 'Missing query preflight');
        expect(requests).toHaveLength(0);
        send({ type: 'llm_query', id: 'dispatch', request: { ...input, inputHash: snapshot.hash, ...(changed ? { prompt: 'changed query' } : {}) } });
      });
      expect(snapshot.context.tools).toEqual([]);
      const result = eventsFrom(output).find(event => event.type === 'llm_query_result' && event.id === 'dispatch');
      if (changed) {
        expect(result?.errorMessage).toContain('preview changed');
        expect(requests).toHaveLength(0);
      } else {
        expect(result?.result.text).toBe('ok');
        expect(requests).toHaveLength(1);
        expect(requests[0].messages[0]).toEqual({ role: 'system', content: input.systemPrompt });
      }
    } finally { await server.stop(true); }
  }, RUN_TIMEOUT_MS);

  it('rejects an oversized workbench Agent turn before model dispatch', async () => {
    let requests = 0;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
      requests++;
      return new Response('must not dispatch', { status: 500 });
    } });
    try {
      const output = await driveBundle([
        { type: 'init', apiKey: 'test-only', model: 'local-model',
          workspaceRootPath: scratchDir, sessionId: 'agent-overflow', sessionPath: join(scratchDir, 'agent-overflow'),
          workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
          customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'local-model', contextWindow: 8192, maxTokens: 128 }] },
        { type: 'prompt', id: 'agent-overflow', strictInput: true, systemPrompt: 'platform', message: '超窗标记'.repeat(10000) },
      ], output => output.includes('"code":"prompt_error"'));
      expect(output).toContain('no previewed content was removed');
      expect(requests).toBe(0);
    } finally { await server.stop(true); }
  });

  it('cancels an in-flight exact-input stream instead of committing its partial answer', async () => {
    let requests = 0;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
      requests++;
      const stream = new ReadableStream({ start(controller) {
        const chunk = { id: 'cancel-stream', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'partial-only' }, finish_reason: null }] };
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
        // Intentionally leave the provider stream open until the client aborts.
      } });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    } });
    let cancelled = false;
    const eventsFrom = (output: string) => output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    try {
      const output = await driveBundle([
        { type: 'init', apiKey: 'test-only', model: 'local-model', cwd: scratchDir, thinkingLevel: 'off',
          workspaceRootPath: scratchDir, sessionId: 'cancel-wire', sessionPath: scratchDir,
          workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
          customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'local-model', contextWindow: 8192, maxTokens: 128 }] },
        { type: 'llm_query', id: 'cancel-query', stream: true, request: { strictInput: true, model: 'local-model', prompt: 'Return a long answer' } },
      ], output => eventsFrom(output).some(event => event.type === 'llm_query_result' && event.id === 'cancel-query'), false,
      (output, send) => {
        if (!cancelled && eventsFrom(output).some(event => event.type === 'llm_query_delta' && event.id === 'cancel-query')) {
          cancelled = true;
          send({ type: 'abort' });
        }
      });
      const results = eventsFrom(output).filter(event => event.type === 'llm_query_result' && event.id === 'cancel-query');
      expect(cancelled).toBe(true);
      expect(requests).toBe(1);
      expect(results).toHaveLength(1);
      expect(results[0].result).toBeNull();
      expect(results[0].errorMessage).toMatch(/cancel|abort/i);
    } finally { server.stop(true); }
  }, RUN_TIMEOUT_MS + 130_000);

  it.each([false, true])('sends the exact cut graph through the bundled SDK to a local provider without tools (image=%s)', async withImage => {
    const document = newThoughtDocument('wire-graph');
    document.nodes = ['kept', 'cut', 'target'].map(id => ({ ...newThoughtNode(id), question: id === 'cut' ? 'CUT-UNIQUE-SECRET' : id, answer: id === 'kept' ? 'previous answer' : '' }));
    document.nodes[2]!.model = 'local-model';
    const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7SsAAAAASUVORK5CYII=' };
    if (withImage) document.nodes[2]!.materials.push({ id: 'pixel', name: 'pixel.png', mimeType: image.mimeType, text: '', digest: createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex') });
    document.edges = ['kept', 'cut'].map(id => ({ id, source: id, target: 'target', kind: 'context' as const, depth: 'full' as const, order: 0 }));
    expect(JSON.stringify(await compileThoughtContext(document, 'target'))).toContain('CUT-UNIQUE-SECRET');
    document.edges = document.edges.filter(edge => edge.source !== 'cut');
    const context = await compileThoughtContext(document, 'target');
    const requests: any[] = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      requests.push(await request.json());
      const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({ id: 'local-wire', object: 'chat.completion.chunk', created: 1, model: 'local-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
      return new Response(chunk({ role: 'assistant', content: 'wire-ok' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    try {
      const output = await driveBundle([
        { type: 'init', apiKey: 'test-only', model: 'local-model', cwd: scratchDir, thinkingLevel: 'off',
          workspaceRootPath: scratchDir, sessionId: 'wire-graph', sessionPath: scratchDir,
          workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
          customEndpoint: { api: 'openai-completions', supportsImages: withImage }, customModels: [{ id: 'local-model', contextWindow: 8192, maxTokens: 128, supportsImages: withImage }] },
        { type: 'llm_query', id: 'wire-query', stream: true, request: { strictInput: true, model: context.model,
          images: withImage ? [image] : undefined,
          systemPrompt: context.systemPrompt, prompt: context.prompt,
          messages: context.messages.filter(message => message.role !== 'system').slice(0, -1).map(({ role, content }) => ({ role, content })) } },
        { type: 'llm_query', id: 'oversized-query', request: { strictInput: true, model: context.model, prompt: '超窗标记'.repeat(10000) } },
      ], output => ['wire-query', 'oversized-query'].every(id => output.split('\n').some(line => { try { const event = JSON.parse(line); return event.type === 'llm_query_result' && event.id === id; } catch { return false; } })));
      const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const completed = events.find(event => event.type === 'llm_query_result' && event.id === 'wire-query');
      expect(completed?.errorMessage).toBeUndefined();
      expect(completed?.result.text).toBe('wire-ok');
      const rejected = events.find(event => event.type === 'llm_query_result' && event.id === 'oversized-query');
      expect(rejected?.errorMessage).toContain('no previewed content was removed');
      expect(rejected?.result).toBeNull();
      expect(requests).toHaveLength(1);
      expect(requests[0].model).toBe(context.model);
      expect(JSON.stringify(requests)).not.toContain('CUT-UNIQUE-SECRET');
      expect(requests[0].messages).toEqual([
        { role: 'system', content: context.systemPrompt },
        ...(withImage ? [{ role: 'user', content: '[Material: pixel.png ]\n' }] : []),
        { role: 'user', content: 'kept' },
        { role: 'assistant', content: 'previous answer' },
        { role: 'user', content: [{ type: 'text', text: 'target' }, ...(withImage ? [{ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }] : [])] },
      ]);
      expect(requests[0].tools ?? []).toEqual([]);
      expect(events.filter(event => event.type === 'llm_query_delta').map(event => event.text).join('')).toBe('wire-ok');
      expect(events.filter(event => event.type === 'llm_query_delta').map(event => ({ id: event.id, sequence: event.sequence }))).toEqual([{ id: 'wire-query', sequence: 1 }]);
    } finally { server.stop(true); }
  }, RUN_TIMEOUT_MS + 130_000);

  it('carries request diagnostics from the preload through bundled SDK message_end', async () => {
    const server = Bun.serve({ port: 0, fetch() {
      return new Response('data: {"error":{"message":"The model service is taking too long to respond."}}\n\n',
        { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'bundle-297' } });
    } });
    try {
      const output = await driveBundle([
        { type: 'init', apiKey: 'test-only', model: 'local-model', cwd: scratchDir, thinkingLevel: 'off',
          workspaceRootPath: scratchDir, sessionId: 'bundle-297', sessionPath: scratchDir,
          workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
          providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
          customEndpoint: { api: 'openai-completions' }, customModels: [{id:'local-model',contextWindow:8192,maxTokens:128}] },
        { type: 'prompt', id: 'p297', message: 'hello', systemPrompt: 'Local protocol test.' },
      ], output => output.split('\n').some(line => {
        try { const e = JSON.parse(line); return e.type === 'event' && e.event?.type === 'message_end' && !!e.event.message?.craftTransportDiagnostics; } catch { return false; }
      }), true);
      const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const terminal = events.find(e => e.type === 'event' && e.event?.type === 'message_end' && e.event.message?.craftTransportDiagnostics);
      expect(terminal).toBeDefined();
      expect(JSON.parse(terminal.event.message.craftTransportDiagnostics[0])).toMatchObject({ providerRequestId: 'bundle-297', phase: 'provider-error', httpStatus: 200 });
    } finally { server.stop(true); }
  }, RUN_TIMEOUT_MS + 130_000);

  it('resolves a ChatGPT bearer credential through the bundled Pi auth pipeline', async () => {
    const output = await driveBundle([
      {
        type: 'init',
        apiKey: '',
        model: 'pi/gpt-5.2-codex',
        cwd: scratchDir,
        thinkingLevel: 'off',
        workspaceRootPath: scratchDir,
        sessionId: 'bundle-smoke',
        sessionPath: scratchDir,
        workingDirectory: scratchDir,
        plansFolderPath: join(scratchDir, 'plans'),
        providerType: 'pi',
        authType: 'oauth',
        piAuth: {
          provider: 'openai-codex',
          credential: { type: 'api_key', key: 'fake-not-a-jwt' },
        },
      },
      { type: 'prompt', id: 'p1', message: 'hi', systemPrompt: 'You are a smoke test.' },
    ], output => (
      output.includes('accountId') ||
      output.includes('No API key found') ||
      output.includes('OAuth auth derivation failed')
    ));

    expect(output).not.toContain('No API key found');
    expect(output).not.toContain('OAuth auth derivation failed');
    expect(output).not.toContain('Cannot find module');
    expect(output).toContain('Failed to extract accountId from token');
  }, RUN_TIMEOUT_MS + 130_000);
});
