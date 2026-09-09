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

function driveBundle(messages: object[], done: (output: string) => boolean, preload = false): Promise<string> {
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
