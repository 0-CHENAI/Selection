import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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

function driveBundle(messages: object[], done: (output: string, send: (message: object) => void) => boolean, preload = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = preload ? ['--preload', join(packageDir, '../shared/src/unified-network-interceptor.ts'), bundlePath] : [bundlePath];
    const child = spawn(process.execPath, args, {
      cwd: scratchDir,
      env: { ...process.env, CRAFT_SESSION_DIR: scratchDir, CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
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
      if (done(output, send)) finish();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', error => finish(error));
    child.on('exit', () => {
      if (!done(output, send)) finish(new Error(`bundle exited early; output:\n${output.slice(-2000)}`));
    });
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

describe('pi-agent-server bundle', () => {
  it('cancels the underlying HTTP evaluation without running business tools', async () => {
    let started!: () => void; let disconnected!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    const requestDisconnected = new Promise<void>(resolve => { disconnected = resolve; });
    const server = Bun.serve({ port: 0, fetch(request) {
      request.signal.addEventListener('abort', disconnected, { once: true });
      started();
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('data: {"id":"test","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n')); },
        cancel() { disconnected(); },
      }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const child = spawn(process.execPath, [bundlePath], { cwd: scratchDir, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' } });
    let output = ''; child.stdout.on('data', chunk => { output += chunk.toString(); });
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
    try {
      send({ type: 'init', apiKey: 'test-only', model: 'Laufry', cwd: scratchDir, workspaceRootPath: scratchDir,
        sessionId: 'evaluation', sessionPath: scratchDir, providerType: 'pi_compat', authType: 'api_key',
        baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api: 'openai-completions' },
        customModels: [{ id: 'Laufry', contextWindow: 8192, maxTokens: 2048 }] });
      send({ type: 'llm_query', id: 'evaluation-1', request: { purpose: 'progress-evaluation', model: 'Laufry', prompt: 'Evaluate.', maxTokens: 2048, timeoutMs: 5000 } });
      await requestStarted;
      send({ type: 'cancel_llm_query', id: 'evaluation-1' });
      await requestDisconnected;
      expect(output).not.toContain('pre_tool_use');
      expect(output).not.toContain('session_tool_completed');
    } finally { child.kill(); server.stop(true); }
  }, 10_000);

  it('runs an isolated utility query with its exact prompt through the bundled SDK', async () => {
    let sentPrompt = '';
    const server = Bun.serve({ port: 0, async fetch(request) {
      const body = await request.json() as { messages?: Array<{ role: string; content: string }> };
      sentPrompt = body.messages?.find(message => message.role === 'system')?.content ?? '';
      const chunks = [
        { id: 'utility', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Utility OK' }, finish_reason: null }] },
        { id: 'utility', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    } });
    try {
      const output = await driveBundle([
        { type: 'init', apiKey: 'test-only', model: 'Laufry', cwd: scratchDir,
          workspaceRootPath: scratchDir, sessionId: 'utility', sessionPath: scratchDir,
          providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
          customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'Laufry', contextWindow: 8192, maxTokens: 2048 }] },
        { type: 'llm_query', id: 'utility-1', request: { purpose: 'progress-evaluation', model: 'Laufry',
          systemPrompt: 'Exact utility prompt', prompt: 'Evaluate.', maxTokens: 128, timeoutMs: 5000 } },
      ], output => output.includes('"type":"llm_query_result"'));
      expect(output).toContain('Utility OK');
      expect(sentPrompt).toBe('Exact utility prompt');
    } finally { server.stop(true); }
  }, RUN_TIMEOUT_MS + 1000);

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
        model: 'pi/gpt-5.5',
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

  it('rejects a retired model before the SDK can fall back to another provider', async () => {
    const output = await driveBundle([
      {
        type: 'init', apiKey: '', model: 'pi/gpt-5.2-codex', cwd: scratchDir,
        workspaceRootPath: scratchDir, sessionId: 'retired-model', sessionPath: scratchDir,
        workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
        providerType: 'pi', authType: 'oauth', piAuth: {
          provider: 'openai-codex', credential: { type: 'api_key', key: 'fake-not-a-jwt' },
        },
      },
      { type: 'prompt', id: 'retired-model', message: 'hi', systemPrompt: 'Smoke test.' },
    ], output => output.includes('不在当前 Pi SDK 目录中'));
    expect(output).toContain('模型 pi/gpt-5.2-codex 不在当前 Pi SDK 目录中');
    expect(output).not.toContain('anthropic-messages');
  }, RUN_TIMEOUT_MS + 1000);
});


it.each([
  ['permission', 'test_wait', 'unknown'], ['proxy', 'test_wait', 'unknown'],
  ['proxy', 'mcp__session__task_help', 'read-only'], ['proxy', 'mcp__external__task_help', 'unknown'],
])('abort releases a pending %s bridge for %s with recovery %s', async (stage, toolName, recovery) => {
  const server = Bun.serve({ port: 0, fetch() {
    const chunks = [
      { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_wait', type: 'function', function: { name: toolName, arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  let aborted = false;
  let acknowledged = false;
  try {
    const output = await driveBundle([
      { type: 'init', apiKey: 'test-only', model: 'local-model', cwd: scratchDir, thinkingLevel: 'off',
        workspaceRootPath: scratchDir, sessionId: `abort-${stage}`, sessionPath: scratchDir,
        workingDirectory: scratchDir, plansFolderPath: join(scratchDir, 'plans'),
        providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`,
        customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'local-model', contextWindow: 8192, maxTokens: 128 }] },
      { type: 'register_tools', tools: [{ name: toolName, description: 'Test pending bridge.', inputSchema: { type: 'object', properties: {} } }] },
      { type: 'prompt', id: `abort-${stage}`, message: `Run ${toolName}.`, systemPrompt: 'Local protocol test.' },
    ], (output, send) => {
      const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const permission = events.find(event => event.type === 'pre_tool_use_request');
      if (permission && !acknowledged && stage === 'proxy') {
        acknowledged = true;
        send({ type: 'pre_tool_use_response', requestId: permission.requestId, action: 'continue' });
      }
      const waiting = stage === 'permission' ? permission : events.find(event => event.type === 'tool_execute_request');
      if (waiting && !aborted) { aborted = true; send({ type: 'abort' }); }
      return aborted && events.some(event => event.type === 'event' && event.event?.type === 'agent_end');
    });
    expect(aborted).toBe(true);
    expect(output).toContain('agent_end');
    const permission = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).find(event => event.type === 'pre_tool_use_request');
    expect(permission.recoveryClass).toBe(recovery);
  } finally { server.stop(true); }
}, RUN_TIMEOUT_MS + 1000);
