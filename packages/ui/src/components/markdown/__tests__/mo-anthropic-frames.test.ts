import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixtureDir = resolve(import.meta.dir, 'fixtures')
const toolFrames = readFileSync(join(fixtureDir, 'mo-round-tool.sse'), 'utf8')
const finalFrames = readFileSync(join(fixtureDir, 'mo-round-final.sse'), 'utf8')

function frameDeltas(source: string, kind: 'thinking_delta' | 'text_delta'): string[] {
  const field = kind === 'thinking_delta' ? 'thinking' : 'text'
  const pieces: string[] = []
  for (const block of source.split('\n\n')) {
    const line = block.split('\n').find(item => item.startsWith('data:'))
    if (!line) continue
    const payload = JSON.parse(line.slice(5).trim()) as { delta?: { type?: string; thinking?: string; text?: string } }
    if (payload.delta?.type === kind && typeof payload.delta[field] === 'string') pieces.push(payload.delta[field])
  }
  return pieces
}

/**
 * Offline replay of frames captured from a real Anthropic Messages stream.
 * The capture itself is not repeated here. Message and tool ids in the files
 * are placeholders.
 */
describe('recorded Anthropic Messages frames', () => {
  it('keeps server-sized thinking and text pieces, and leaves both in the work chain', async () => {
    const repoRoot = resolve(import.meta.dir, '../../../../../../')
    const sessionDir = mkdtempSync(join(tmpdir(), 'mo-frames-'))
    const interceptor = resolve(repoRoot, 'packages/shared/src/unified-network-interceptor.ts')
    const adapter = pathToFileURL(resolve(repoRoot, 'packages/shared/src/agent/backend/pi/event-adapter.ts')).href
    const sessions = pathToFileURL(resolve(repoRoot, 'packages/server-core/src/sessions/SessionManager.ts')).href
    const turns = pathToFileURL(resolve(repoRoot, 'packages/ui/src/components/chat/turn-utils.ts')).href
    const code = `
      import { streamSimple } from '@earendil-works/pi-ai/api/anthropic-messages';
      import { readFileSync } from 'node:fs';
      import { PiEventAdapter } from ${JSON.stringify(adapter)};
      import { SessionManager, createManagedSession } from ${JSON.stringify(sessions)};
      import { groupMessagesByTurn } from ${JSON.stringify(turns)};
      const frames = [
        readFileSync(${JSON.stringify(join(fixtureDir, 'mo-round-tool.sse'))}, 'utf8'),
        readFileSync(${JSON.stringify(join(fixtureDir, 'mo-round-final.sse'))}, 'utf8'),
      ];
      let request = 0;
      const server = Bun.serve({
        port: 0,
        fetch() {
          const body = frames[Math.min(request, frames.length - 1)];
          request += 1;
          const events = body.split('\\n\\n').filter(Boolean);
          return new Response(new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              for (const event of events) {
                controller.enqueue(encoder.encode(event + '\\n\\n'));
                // IPC only merges deltas that land in the same turn. The live
                // server spaces these frames by tens of milliseconds, so the
                // replay does too. A zero gap would glue a whole block.
                await Bun.sleep(16);
              }
              controller.close();
            },
          }), { headers: { 'content-type': 'text/event-stream' } });
        },
      });
      const manager = new SessionManager();
      const managed = createManagedSession({ id: 'session-1' }, { id: 'workspace-1', name: 'Workspace', rootPath: ${JSON.stringify(sessionDir)} }, { messagesLoaded: true });
      managed.isProcessing = true;
      managed.messages = [{ id: 'user-1', role: 'user', content: 'Look up demo.', timestamp: 1 }];
      manager.sessions.set(managed.id, managed);
      manager.persistSession = () => {};
      manager.captureChangedArtifacts = async () => [];
      const deltas = [];
      manager.setEventSink((_channel, _target, event) => {
        if (event.type === 'text_delta') deltas.push({ phase: event.phase, turnId: event.turnId, text: event.delta });
      });
      const adapt = (sdk) => {
        if (['text_start','text_delta','text_end','thinking_start','thinking_delta','thinking_end','toolcall_start','toolcall_delta','toolcall_end'].includes(sdk.type)) {
          return { type: 'message_update', assistantMessageEvent: sdk, message: sdk.partial };
        }
        if (sdk.type === 'done' || sdk.type === 'error') return { type: 'message_end', message: sdk.message ?? sdk.error };
        return null;
      };
      const model = { id: 'MO', name: 'MO', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'http://127.0.0.1:' + server.port, reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 256 };
      const adapterPi = new PiEventAdapter();
      adapterPi.startTurn('mo-fixture');
      const run = async (messages) => {
        let finalMessage;
        const stream = streamSimple(model, { messages }, { apiKey: 'test-key' });
        for await (const sdk of stream) {
          if (sdk.type === 'done' || sdk.type === 'error') finalMessage = sdk.message ?? sdk.error;
          const agentEvent = adapt(sdk);
          if (!agentEvent) continue;
          for (const craft of adapterPi.adaptEvent(agentEvent)) await manager.processEvent(managed, craft);
        }
        return finalMessage;
      };
      try {
        const first = await run([{ role: 'user', content: 'Look up demo.', timestamp: Date.now() }]);
        const call = first && first.content && first.content.find(part => part.type === 'toolCall');
        if (call) {
          for (const craft of adapterPi.adaptEvent({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: call.arguments || {} })) {
            await manager.processEvent(managed, craft);
          }
          for (const craft of adapterPi.adaptEvent({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, isError: false, result: { content: [{ type: 'text', text: 'demo record: status ok' }] } })) {
            await manager.processEvent(managed, craft);
          }
        }
        const second = await run([
          { role: 'user', content: 'Look up demo.', timestamp: Date.now() },
          first,
          { role: 'toolResult', toolCallId: call && call.id, toolName: call && call.name, content: [{ type: 'text', text: 'demo record: status ok' }], isError: false, timestamp: Date.now() },
        ]);
        const assistant = groupMessagesByTurn(managed.messages, { isSessionProcessing: false }).find(turn => turn.type === 'assistant');
        process.stdout.write('@@RESULT@@' + JSON.stringify({
          deltas,
          stop: [first && first.stopReason, second && second.stopReason],
          error: [first && first.errorMessage, second && second.errorMessage],
          activities: assistant ? assistant.activities.map(activity => ({ type: activity.type, content: activity.content || '', toolName: activity.toolName || '' })) : [],
          response: assistant && assistant.response ? assistant.response.text : '',
        }) + '\\n');
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
        CRAFT_DEBUG: '0',
        CRAFT_STREAM_TRACE: '1',
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timeout = setTimeout(() => proc.kill(), 30_000)
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      expect(exit, stderr).toBe(0)
      const line = stdout.split('\n').find(item => item.startsWith('@@RESULT@@'))
      expect(line, stdout).toBeTruthy()
      const result = JSON.parse(line!.slice('@@RESULT@@'.length)) as {
        deltas: Array<{ phase?: string; turnId?: string; text: string }>
        stop: Array<string | undefined>
        error: Array<string | undefined>
        activities: Array<{ type: string; content: string; toolName: string }>
        response: string
      }
      expect(result.error.map(item => item || '').join('')).toBe('')
      expect(result.stop).toEqual(['toolUse', 'stop'])
      const thinking = result.deltas.filter(item => item.turnId?.includes('__think')).map(item => item.text)
      const prose = result.deltas.filter(item => !item.turnId?.includes('__think')).map(item => item.text)
      expect(thinking).toEqual([...frameDeltas(toolFrames, 'thinking_delta'), ...frameDeltas(finalFrames, 'thinking_delta')])
      expect(prose).toEqual([...frameDeltas(toolFrames, 'text_delta'), ...frameDeltas(finalFrames, 'text_delta')])
      expect(thinking.join('')).toContain('Let me first make the tool call')
      expect(result.activities.map(activity => activity.type)).toEqual(['thinking', 'tool', 'thinking'])
      expect(result.activities.filter(activity => activity.type === 'thinking').map(activity => activity.content).join('\n')).toContain('Let me first make the tool call')
      expect(result.activities.filter(activity => activity.type === 'thinking').map(activity => activity.content).join('\n')).toContain('status ok')
      expect(result.response).toBe(frameDeltas(finalFrames, 'text_delta').join(''))
      expect(result.response).toContain('its status is ok.')
      expect(result.response).not.toContain('Let me first make the tool call')
      const traces = stderr.split('\n').filter(item => item.includes('@@STREAM@@')).map(item => JSON.parse(item.slice(item.indexOf('@@STREAM@@') + '@@STREAM@@'.length)) as { layer?: string; event?: string; chars?: number })
      const forwarded = traces.filter(item => item.layer === 'interceptor' && (item.event === 'thinking_delta' || item.event === 'text_delta'))
      expect(forwarded.map(item => item.chars)).toEqual(result.deltas.map(item => item.text.length))
    } finally {
      clearTimeout(timeout)
      proc.kill()
      rmSync(sessionDir, { recursive: true, force: true })
    }
  })
})
