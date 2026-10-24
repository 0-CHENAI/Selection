import { describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { handleTextComplete, handleTextDelta } from '../../../../../../apps/electron/src/renderer/event-processor/handlers/text'
import type { SessionState } from '../../../../../../apps/electron/src/renderer/event-processor/types'

// Bun does not implement Vite's ?url asset loader.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

const { Markdown } = await import('../Markdown')
const { ResponseCard } = await import('../../chat/TurnCard')

const KIMI_ANSWER = '# 周报\n\n- 已完成流式修复\n\n详见 `code`。'
const OFFICIAL_ANSWER = '官方流式逐字到达。'
const THINKING = '先整理结构'

function squash(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, '')
}

/** Characters a reader should already be able to see. Markup markers are not text. */
function readable(source: string): string {
  return source.replace(/[`#>*_\[\]()-]/g, '').replace(/\s+/g, '')
}

function sessionState(): SessionState {
  return {
    session: {
      id: 'session-1',
      workspaceId: 'workspace-1',
      messages: [{ id: 'user-1', role: 'user', content: '写一份周报', timestamp: 1 }],
      isProcessing: true,
      lastMessageAt: 1,
    } as SessionState['session'],
    streaming: null,
  }
}

interface UiEvent {
  framing: string
  type: 'text_delta' | 'text_complete' | 'model' | 'headers'
  text?: string
  phase?: string
  turnId?: string
  t?: number
  arrived?: number
  deltas?: string[]
  stopReason?: string
  errorMessage?: string
}

/**
 * Simulated Moonshot Anthropic SSE. Not a live api.moonshot.cn call, and not
 * the official Kimi Code provider (Chat Completions since Pi 1.3.0).
 * Public framing: each event is `data:{json}` plus one LF (Kimi-style Anthropic
 * gateways) or official `event:` / blank-line SSE. Bytes are pushed in pieces,
 * then the next character waits a realistic token gap (well under the old 50ms hold).
 */
async function readLiveUiEvents(): Promise<UiEvent[]> {
  const repoRoot = resolve(import.meta.dir, '../../../../../../')
  const sessionDir = mkdtempSync(join(tmpdir(), 'kimi-live-'))
  const interceptor = resolve(repoRoot, 'packages/shared/src/unified-network-interceptor.ts')
  const adapter = pathToFileURL(resolve(repoRoot, 'packages/shared/src/agent/backend/pi/event-adapter.ts')).href
  const sessions = pathToFileURL(resolve(repoRoot, 'packages/server-core/src/sessions/SessionManager.ts')).href
  const code = `
    import { streamSimple } from '@earendil-works/pi-ai/api/anthropic-messages';
    import { PiEventAdapter } from ${JSON.stringify(adapter)};
    import { SessionManager, createManagedSession } from ${JSON.stringify(sessions)};
    const THINKING = ${JSON.stringify(THINKING)};
    const answers = { 'kimi-data': ${JSON.stringify(KIMI_ANSWER)}, 'anthropic-sse': ${JSON.stringify(OFFICIAL_ANSWER)} };
    let framing = 'kimi-data';
    const encoder = new TextEncoder();
    let acceptEncoding = '';
    const server = Bun.serve({
      port: 0,
      idleTimeout: 30,
      fetch(request) {
        acceptEncoding = request.headers.get('accept-encoding') ?? acceptEncoding;
        const answer = answers[framing];
        const kimi = framing === 'kimi-data';
        return new Response(new ReadableStream({
          async start(controller) {
            const send = async (name, payload) => {
              const json = JSON.stringify(payload);
              const frame = kimi ? 'data:' + json + '\\n' : 'event: ' + name + '\\ndata: ' + json + '\\n\\n';
              const bytes = encoder.encode(frame);
              const mid = Math.max(1, Math.floor(bytes.length / 2));
              for (let i = 0; i < mid; i++) controller.enqueue(bytes.subarray(i, i + 1));
              await Bun.sleep(1);
              for (let i = mid; i < bytes.length; i++) controller.enqueue(bytes.subarray(i, i + 1));
            };
            const message = { id: 'msg_kimi_live', type: 'message', role: 'assistant', content: [], model: 'kimi-k2', stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } };
            await send('message_start', { type: 'message_start', message });
            await send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
            for (const ch of THINKING) {
              await send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ch } });
              await Bun.sleep(12);
            }
            await send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } });
            await send('content_block_stop', { type: 'content_block_stop', index: 0 });
            await send('ping', { type: 'ping' });
            await send('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
            for (const ch of answer) {
              await send('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ch } });
              await Bun.sleep(12);
            }
            await send('content_block_stop', { type: 'content_block_stop', index: 1 });
            if (kimi) {
              await send('content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_kimi', name: 'read', input: {} } });
              await send('content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } });
              await Bun.sleep(12);
              await send('content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"notes.md"}' } });
              await send('content_block_stop', { type: 'content_block_stop', index: 2 });
            }
            await send('message_delta', { type: 'message_delta', delta: { stop_reason: kimi ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: answer.length } });
            await send('message_stop', { type: 'message_stop' });
            controller.close();
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const manager = new SessionManager();
    const managed = createManagedSession({ id: 'session-1' }, { id: 'workspace-1', name: 'Workspace', rootPath: ${JSON.stringify(sessionDir)} }, { messagesLoaded: true });
    managed.isProcessing = true;
    managed.messages = [{ id: 'user-1', role: 'user', content: '写一份周报', timestamp: 1 }];
    manager.sessions.set(managed.id, managed);
    manager.persistSession = () => {};
    manager.captureChangedArtifacts = async () => [];
    const emit = (value) => process.stdout.write('@@UI@@' + JSON.stringify({ ...value, t: Date.now() }) + '\\n');
    manager.setEventSink((_channel, _target, event) => {
      if (event.type === 'text_delta') emit({ framing, type: 'text_delta', text: event.delta, phase: event.phase, turnId: event.turnId });
      if (event.type === 'text_complete') emit({ framing, type: 'text_complete', text: event.text, phase: event.phase, turnId: event.turnId });
    });
    const adapt = (sdk) => {
      if (['text_start','text_delta','text_end','thinking_start','thinking_delta','thinking_end','toolcall_start','toolcall_delta','toolcall_end'].includes(sdk.type)) {
        return { type: 'message_update', assistantMessageEvent: sdk, message: sdk.partial };
      }
      if (sdk.type === 'done' || sdk.type === 'error') return { type: 'message_end', message: sdk.message ?? sdk.error };
      return null;
    };
    try {
      for (const name of ['kimi-data', 'anthropic-sse']) {
        framing = name;
        const adapterPi = new PiEventAdapter();
        adapterPi.startTurn('turn-' + name);
        const model = { id: 'kimi-k2', name: 'Kimi', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'http://127.0.0.1:' + server.port, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 256 };
        const stream = streamSimple(model, { messages: [{ role: 'user', content: '写一份周报', timestamp: Date.now() }] }, { apiKey: 'test-key' });
        const modelDeltas = [];
        let finalMessage;
        for await (const sdk of stream) {
          if (sdk.type === 'text_delta') modelDeltas.push(sdk.delta);
          if (sdk.type === 'done' || sdk.type === 'error') finalMessage = sdk.message ?? sdk.error;
          const agentEvent = adapt(sdk);
          if (!agentEvent) continue;
          for (const craft of adapterPi.adaptEvent(agentEvent)) await manager.processEvent(managed, craft);
        }
        emit({ framing, type: 'model', deltas: modelDeltas, stopReason: finalMessage && finalMessage.stopReason, errorMessage: finalMessage && finalMessage.errorMessage });
      }
      emit({ framing: 'kimi-data', type: 'headers', text: acceptEncoding });
    } finally {
      server.stop(true);
    }
  `
  const proc = Bun.spawn([process.execPath, '--preload', interceptor, '--eval', code], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CRAFT_SESSION_DIR: sessionDir,
      CRAFT_PI_MODEL_API: 'anthropic-messages',
      CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0',
      CRAFT_DEBUG: '0',
      CRAFT_STREAM_TRACE: '1',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timeout = setTimeout(() => proc.kill(), 35_000)
  const events: UiEvent[] = []
  const started = Date.now()
  const readStdout = (async () => {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('@@UI@@')) {
          events.push({ ...JSON.parse(line.slice(6)) as UiEvent, arrived: Date.now() - started })
        }
        newline = buffer.indexOf('\n')
      }
    }
  })()
  try {
    const [stderr, exit] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
      readStdout,
    ])
    expect(exit, stderr).toBe(0)
    const traces = stderr.split('\n').filter(line => line.startsWith('@@STREAM@@')).map(line => JSON.parse(line.slice('@@STREAM@@'.length)) as { layer: string; chars?: number; event?: string })
    const paced = traces.filter(trace => (trace.layer === 'interceptor' || trace.layer === 'ipc-delta' || trace.layer === 'adapter-delta') && (trace.event === 'text_delta' || trace.event === 'thinking_delta' || trace.layer === 'ipc-delta'))
    expect(paced.length).toBeGreaterThan(0)
    expect(paced.every(trace => trace.chars === 1), JSON.stringify(paced.slice(0, 8))).toBe(true)
    const net = traces.filter(trace => trace.layer === 'net-read')
    expect(net.length).toBeGreaterThan(10)
    return events
  } finally {
    clearTimeout(timeout)
    proc.kill()
    rmSync(sessionDir, { recursive: true, force: true })
  }
}

function paint(content: string, streaming: boolean): string {
  const markdown = renderToStaticMarkup(<Markdown isStreaming={streaming}>{content}</Markdown>)
  const card = renderToStaticMarkup(
    <ResponseCard text={content} isStreaming={streaming} isTurnComplete={!streaming} />,
  )
  return markdown + card
}

describe('Kimi Anthropic live stream reaches the UI one character at a time', () => {
  it('paints each paced character and keeps the finished Markdown intact', async () => {
    const events = await readLiveUiEvents()
    expect(events.find(event => event.type === 'headers')?.text).toBe('identity')
    for (const [framing, answer] of [['kimi-data', KIMI_ANSWER], ['anthropic-sse', OFFICIAL_ANSWER]] as const) {
      const mine = events.filter(event => event.framing === framing)
      const model = mine.find(event => event.type === 'model')
      const deltas = mine.filter(event => event.type === 'text_delta')
      const thinkingDeltas = deltas.filter(event => event.phase === 'intermediate')
      const answerDeltas = deltas.filter(event => event.phase !== 'intermediate')
      const completes = mine.filter(event => event.type === 'text_complete')
      const complete = completes.find(event => !event.turnId?.includes('__think'))
      expect(model?.stopReason, JSON.stringify(model)).not.toBe('error')
      expect(model?.errorMessage ?? '', model?.errorMessage).toBe('')
      expect(model?.deltas, `${framing} parser`).toEqual([...answer])
      expect(thinkingDeltas.map(event => event.text), `${framing} thinking was held`).toEqual([...THINKING])
      expect(answerDeltas.map(event => event.text), `${framing} UI deltas were coalesced`).toEqual([...answer])
      expect(completes.find(event => event.turnId?.includes('__think'))?.text).toBe(THINKING)
      expect(complete?.text).toBe(answer)
      const firstAnswer = answerDeltas[0]?.arrived ?? 0
      expect(thinkingDeltas.every(event => (event.arrived ?? 0) < firstAnswer)).toBe(true)
      const gaps = answerDeltas.slice(1).map((event, index) => (event.arrived ?? 0) - (answerDeltas[index]?.arrived ?? 0))
      expect(Math.max(...gaps, 0), `${framing} answer gaps ${gaps.join(',')}`).toBeLessThan(400)

      let state = sessionState()
      let seen = ''
      for (const delta of answerDeltas.map(event => event.text ?? '')) {
        seen += delta
        state = handleTextDelta(state, {
          type: 'text_delta', sessionId: 'session-1', delta, phase: 'unclassified', turnId: framing,
        })
        const content = state.session.messages.at(-1)?.content ?? ''
        expect(content).toBe(seen)
        expect(state.session.messages.at(-1)?.isStreaming).toBe(true)
        const html = paint(content, true)
        // An unclosed inline code span still shows its marker. Compare the
        // words the reader should already have, not the unfinished syntax.
        expect(squash(html).replace(/[`#>*_\[\]()-]/g, '')).toContain(readable(seen))
        expect(squash(html)).not.toContain(THINKING)
      }
      state = handleTextComplete(state, {
        type: 'text_complete', sessionId: 'session-1', text: complete?.text ?? '', turnId: framing,
        isIntermediate: framing === 'kimi-data',
      })
      const finalText = state.session.messages.at(-1)?.content ?? ''
      expect(finalText).toBe(answer)
      expect(state.session.messages.at(-1)?.isStreaming).toBe(false)
      const finalHtml = paint(finalText, false)
      expect(squash(finalHtml)).toContain(readable(answer))
      expect(squash(finalHtml)).not.toContain(THINKING)
      expect(finalHtml).not.toContain('notes.md')
      if (framing === 'kimi-data') {
        expect(finalHtml).toContain('<h1')
        expect(finalHtml).toContain('已完成流式修复')
        expect(finalHtml).toContain('<li')
        expect(finalHtml).toContain('<code')
        expect(finalHtml).toContain('code')
      }
    }
  }, 40_000)
})
