import { beforeAll, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

beforeAll(() => {
  const result = spawnSync(process.execPath, ['run', 'build'], {
    cwd: join(import.meta.dir, '..'), stdio: 'pipe', timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`Pi bundle build failed: ${result.stderr?.toString()}`);
}, 130_000);

it('publishes answer arguments before the upstream tool stream finishes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-answer-preview-'));
  let finishStream!: () => void;
  const server = Bun.serve({ port: 0, fetch() {
    return new Response(new ReadableStream({ start(controller) {
      const send = (delta: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`));
      send({ tool_calls: [{ index: 0, id: 'answer', type: 'function', function: { name: 'submit_answer', arguments: '{"markdown":"Early answer' } }] });
      finishStream = () => { controller.close(); };
    } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const child = spawn(process.execPath, ['--preload', join(import.meta.dir, '../../shared/src/unified-network-interceptor.ts'), join(import.meta.dir, '../dist/index.js')], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0' },
  });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  let timer: ReturnType<typeof setTimeout>;
  const preview = new Promise<unknown>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('No answer preview before stream completion')), 5000);
    let lines = '';
    child.stdout.on('data', data => {
      lines += data.toString();
      const parts = lines.split('\n'); lines = parts.pop()!;
      for (const line of parts) {
        const message = JSON.parse(line);
        if (message.event?.type === 'answer_preview') resolve(message.event);
      }
    });
    child.on('error', reject);
  });
  child.stderr.resume();
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
  try {
    send({ type: 'init', apiKey: 'local-test', model: 'local-model', cwd: root, workspaceRootPath: root, sessionPath: root, sessionId: 'preview', providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}/v1`, customEndpoint: { api: 'openai-completions' }, customModels: [{ id: 'local-model', contextWindow: 8192, maxTokens: 128 }] });
    send({ type: 'prompt', id: 'test', answerRunId: 'answer-run', message: 'Reply', systemPrompt: 'Local test.' });
    expect(await preview).toMatchObject({ type: 'answer_preview', text: 'Early answer', answerRunId: 'answer-run' });
  } finally {
    clearTimeout(timer!);
    finishStream?.(); server.stop(true); child.kill(); await exited;
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);
