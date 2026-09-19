import { beforeAll, expect, it } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiEventAdapter } from '../../shared/src/agent/backend/pi/event-adapter';

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


for (const api of ['anthropic-messages', 'openai-completions'] as const) {
  it(`anchors ID-less assistant messages to their actual persisted SDK entry (${api})`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'pi-idless-anchor-'));
    const text = '完整正文：换门的概率是 2/3。';
    const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const body = api === 'anthropic-messages'
      ? sse('message_start', { type: 'message_start', message: { id: 'provider-message', type: 'message', role: 'assistant', content: [], model: 'local-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } })
        + sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        + sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
        + sse('content_block_stop', { type: 'content_block_stop', index: 0 })
        + sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } })
        + sse('message_stop', { type: 'message_stop' })
      : `data: ${JSON.stringify({ id: 'provider-message', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ id: 'provider-message', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`;
    const server = Bun.serve({ port: 0, fetch: () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }) });
    const child = spawn(process.execPath, [join(import.meta.dir, '../dist/index.js')], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    });
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    const events: Array<Record<string, any>> = [];
    let timer: ReturnType<typeof setTimeout>;
    const ended = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('No assistant completion')), 5000);
      let buffer = '';
      child.stdout.on('data', data => {
        buffer += data.toString();
        const lines = buffer.split('\n'); buffer = lines.pop()!;
        for (const line of lines) {
          const message = JSON.parse(line);
          if (message.type === 'error') reject(new Error(message.message));
          if (message.event) events.push(message.event);
          if (message.event?.type === 'agent_end') resolve();
        }
      });
      child.on('error', reject);
    });
    child.stderr.resume();
    const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
    try {
      send({ type: 'init', apiKey: 'local-test', model: 'local-model', cwd: root, workspaceRootPath: root, sessionPath: root, sessionId: 'anchor', providerType: 'pi_compat', authType: 'api_key', baseUrl: `http://127.0.0.1:${server.port}`, customEndpoint: { api }, customModels: [{ id: 'local-model', contextWindow: 8192, maxTokens: 128 }] });
      send({ type: 'prompt', id: 'test', answerRunId: 'answer-run', message: 'Reply with plain text.', systemPrompt: 'Local test.' });
      await ended;
      const completion = events.find(e => e.type === 'message_end' && e.message?.role === 'assistant');
      expect(completion?.message.id).toBeUndefined();
      expect(completion?.sdkMessageId).toBeString();
      const anchor = events.find(e => e.type === 'pi_turn_anchor' && e.sdkMessageId === completion?.sdkMessageId);
      expect(anchor?.sdkTurnAnchor).toBeString();
      expect(events.indexOf(anchor!)).toBeGreaterThan(events.indexOf(completion!));
      const adapter = new PiEventAdapter();
      adapter.startTurn();
      const adapted = events.flatMap(event => [...adapter.adaptEvent(event as never)]);
      expect(adapted).toContainEqual(expect.objectContaining({ type: 'text_complete', text, sdkMessageId: completion!.sdkMessageId }));
      expect(adapted).toContainEqual(expect.objectContaining({ type: 'pi_turn_anchor', sdkMessageId: completion!.sdkMessageId, sdkTurnAnchor: anchor!.sdkTurnAnchor }));
      const files = (await readdir(root, { recursive: true })).filter(name => name.endsWith('.jsonl'));
      const entries = (await Promise.all(files.map(name => readFile(join(root, name), 'utf8')))).flatMap(content => content.trim().split('\n').map(line => JSON.parse(line)));
      const entry = entries.find(e => e.id === anchor?.sdkTurnAnchor);
      expect(entry?.message.role).toBe('assistant');
      expect(entry?.message.content).toContainEqual({ type: 'text', text });
    } finally {
      clearTimeout(timer!);
      server.stop(true); child.kill(); await exited;
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);
}
