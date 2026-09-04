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

function driveBundle(messages: object[], done: (output: string) => boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundlePath], {
      cwd: scratchDir,
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
