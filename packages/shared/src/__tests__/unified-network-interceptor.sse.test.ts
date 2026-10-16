import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { answerPreviewContext } from '../answer-preview-context.ts';
import { toolMetadataStore } from '../interceptor-common.ts';

let createOpenAiSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiSseStrippingStream;
let createOpenAiResponsesSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiResponsesSseStrippingStream;
let createAnthropicSseStrippingStream: typeof import('../unified-network-interceptor.ts').createAnthropicSseStrippingStream;
let stripMetadataFieldsFromRawJson: typeof import('../unified-network-interceptor.ts').stripMetadataFieldsFromRawJson;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function runThroughProcessor(
  processor: TransformStream<Uint8Array, Uint8Array>,
  chunks: string[],
): Promise<string> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const output = input.pipeThrough(processor);
  const reader = output.getReader();
  let result = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

describe('unified-network-interceptor SSE processors', () => {
  let sessionDir: string;

  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    createOpenAiSseStrippingStream = mod.createOpenAiSseStrippingStream;
    createOpenAiResponsesSseStrippingStream = mod.createOpenAiResponsesSseStrippingStream;
    createAnthropicSseStrippingStream = mod.createAnthropicSseStrippingStream;
    stripMetadataFieldsFromRawJson = mod.stripMetadataFieldsFromRawJson;
  });

  afterAll(() => {
    delete process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  });

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'interceptor-sse-'));
    toolMetadataStore.setSessionDir(sessionDir);
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('previews Anthropic arguments while SDK metadata stripping is still buffering (#350)', async () => {
    const previews: unknown[] = [];
    const processor = answerPreviewContext.run(p => previews.push(p), createAnthropicSseStrippingStream);
    const writer = processor.writable.getWriter();
    let output = '';
    const drained = (async () => {
      const reader = processor.readable.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += decoder.decode(chunk.value);
      }
    })();
    await writer.write(encoder.encode('event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"answer","name":"submit_answer"}}\n\n'));
    await writer.write(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify({ index: 0, delta: { type: 'input_json_delta', partial_json: '{"markdown":"Early' } })}\n\n`));
    expect(previews).toEqual([{ toolCallId: 'answer', text: 'Early' }]);
    expect(output).not.toContain('Early');
    await writer.close();
    await drained;
  });

  it('streams isolated answer previews before finish without duplicating SDK tool calls (#350)', async () => {
    const previews: Array<{ toolCallId: string; text: string }> = [];
    const unrelated: unknown[] = [];
    const processor = answerPreviewContext.run(p => previews.push(p), createOpenAiSseStrippingStream);
    const writer = processor.writable.getWriter();
    const reader = processor.readable.getReader();
    let output = '';
    const drained = (async () => {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        output += decoder.decode(item.value);
      }
    })();
    const chunk = (args: string, first = false) => encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...(first ? { id: 'answer', function: { name: 'session__submit_answer', arguments: args } } : { function: { arguments: args } }) }] } }] })}\n\n`);
    await answerPreviewContext.run(p => unrelated.push(p), () => writer.write(chunk('{"_intent":"deliver", "markdown":"# Early', true)));
    expect(previews).toEqual([{ toolCallId: 'answer', text: '# Early' }]);
    expect(unrelated).toEqual([]);
    expect(output).toBe('');
    await writer.write(chunk(' answer"}'));
    await writer.write(encoder.encode('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'));
    await writer.close();
    await drained;
    const toolChunks = output.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).filter(event => event.choices[0].delta.tool_calls);
    expect(toolChunks).toHaveLength(1);
    expect(JSON.parse(toolChunks[0].choices[0].delta.tool_calls[0].function.arguments)).toEqual({ markdown: '# Early answer' });
  });

  it('previews OpenAI Responses submit_answer arguments before the function call is done', async () => {
    const previews: Array<{ toolCallId: string; text: string }> = [];
    const processor = answerPreviewContext.run(p => previews.push(p), createOpenAiResponsesSseStrippingStream);
    const writer = processor.writable.getWriter();
    const drained = (async () => {
      const reader = processor.readable.getReader();
      let output = '';
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        output += decoder.decode(item.value);
      }
      return output;
    })();
    const event = (value: Record<string, unknown>) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
    await writer.write(event({ type: 'response.output_item.added', output_index: 0,
      item: { type: 'function_call', call_id: 'answer', name: 'submit_answer' } }));
    await writer.write(event({ type: 'response.function_call_arguments.delta', output_index: 0,
      delta: '{"markdown":"正在生成' }));
    expect(previews).toEqual([{ toolCallId: 'answer', text: '正在生成' }]);
    await writer.write(event({ type: 'response.function_call_arguments.done', output_index: 0,
      call_id: 'answer', arguments: '{"markdown":"正在生成正文"}' }));
    expect(previews.at(-1)).toEqual({ toolCallId: 'answer', text: '正在生成正文' });
    await writer.close();
    const output = await drained;
    expect(output).toContain('response.function_call_arguments.delta');
    expect(output).toContain('response.function_call_arguments.done');
  });

  it('OpenAI: does not drop the terminal chunk when delta.tool_calls is an empty array (#995)', async () => {
    // Some OpenAI-compatible relays send `tool_calls: []` on ordinary content and
    // even on the terminal finish_reason chunk. Treating that as a tool-call delta
    // dropped the chunk, so the SDK reported "Stream ended without finish_reason".
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"","tool_calls":[]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"hi","tool_calls":[]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[]},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);
    expect(out).toContain('"finish_reason":"stop"');
    expect(out).toContain('"content":"hi"');
    expect(out).toContain('[DONE]');
    // The empty key must also be stripped from forwarded chunks — the Pi SDK
    // downstream mishandles tool_calls deltas and must never see it.
    expect(out).not.toContain('"tool_calls":[]');
  });

  it('OpenAI: handles multiple tool calls in one delta chunk without dropping calls', async () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"toolA","arguments":"{\\"a\\":1,\\"_intent\\":\\"intent-1\\",\\"_displayName\\":\\"Display 1\\"}"}},{"index":1,"id":"call_2","type":"function","function":{"name":"toolB","arguments":"{\\"b\\":2,\\"_intent\\":\\"intent-2\\",\\"_displayName\\":\\"Display 2\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(out).toContain('"id":"call_1"');
    expect(out).toContain('"id":"call_2"');
    expect(out).toContain('"arguments":"{\\"a\\":1}"');
    expect(out).toContain('"arguments":"{\\"b\\":2}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    expect(toolMetadataStore.get('call_1', sessionDir)?.intent).toBe('intent-1');
    expect(toolMetadataStore.get('call_2', sessionDir)?.displayName).toBe('Display 2');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI: processes tool calls for multiple choices', async () => {
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"toolA","arguments":"{\\"x\\":1,\\"_intent\\":\\"intent-a\\"}"}}]}},{"index":1,"delta":{"tool_calls":[{"index":0,"id":"call_b","type":"function","function":{"name":"toolB","arguments":"{\\"y\\":2,\\"_displayName\\":\\"Display B\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"},{"index":1,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(out).toContain('"id":"call_a"');
    expect(out).toContain('"id":"call_b"');
    expect(out).toContain('"choices":[{"index":1');
    expect(out).toContain('"arguments":"{\\"x\\":1}"');
    expect(out).toContain('"arguments":"{\\"y\\":2}"');

    expect(toolMetadataStore.get('call_a', sessionDir)?.intent).toBe('intent-a');
    expect(toolMetadataStore.get('call_b', sessionDir)?.displayName).toBe('Display B');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('OpenAI Responses: strips metadata on function_call done events', async () => {
    const sse = [
      'data: {"type":"response.function_call_arguments.done","call_id":"call_resp_1","arguments":"{\\"foo\\":1,\\"_intent\\":\\"do thing\\",\\"_displayName\\":\\"Do Thing\\"}"}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_resp_1","id":"fc_1","name":"mcp__craft__search","arguments":"{\\"foo\\":1,\\"_intent\\":\\"do thing\\",\\"_displayName\\":\\"Do Thing\\"}"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiResponsesSseStrippingStream(), sse);

    expect(out).toContain('"type":"response.function_call_arguments.done"');
    expect(out).toContain('"arguments":"{\\"foo\\":1}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    const meta = toolMetadataStore.get('call_resp_1', sessionDir);
    expect(meta?.intent).toBe('do thing');
    expect(meta?.displayName).toBe('Do Thing');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('Anthropic: supports multi-line data payloads and strips metadata', async () => {
    const sse = [
      'event: content_block_start\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta",\n',
      'data: "partial_json":"{\\"path\\":\\"/tmp\\",\\"_intent\\":\\"Read file\\",\\"_displayName\\":\\"Read Tmp\\"}"}}\n\n',
      'event: content_block_stop\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
    ];

    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);

    expect(out).toContain('event: content_block_delta');
    expect(out).toContain('"partial_json":"{\\"path\\":\\"/tmp\\"}"');
    expect(out).not.toContain('_intent');
    expect(out).not.toContain('_displayName');

    const meta = toolMetadataStore.get('toolu_1', sessionDir);
    expect(meta?.intent).toBe('Read file');
    expect(meta?.displayName).toBe('Read Tmp');

    rmSync(sessionDir, { recursive: true, force: true });
  });

  /**
   * Same rule as @earendil-works/pi-ai 1.2.0 anthropic-messages stream():
   * text_delta is appended only when event.index still points at an open text block.
   * content_block_stop clears that index, so later deltas on it are dropped.
   */
  function piVisibleText(sse: string): string {
    const blocks: Array<{ type: string; index?: number }> = [];
    let text = '';
    let event = '';
    let data = '';
    const flush = () => {
      if (!data) { event = ''; return; }
      if (event === 'content_block_start' || event === 'content_block_delta' || event === 'content_block_stop') {
        const parsed = JSON.parse(data) as {
          index?: number;
          content_block?: { type?: string };
          delta?: { type?: string; text?: string };
        };
        if (event === 'content_block_start' && parsed.content_block?.type === 'text') {
          blocks.push({ type: 'text', index: parsed.index });
        } else if (event === 'content_block_start') {
          blocks.push({ type: parsed.content_block?.type ?? 'other', index: parsed.index });
        } else if (event === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          const block = blocks.find(item => item.index === parsed.index);
          if (block?.type === 'text' && parsed.delta.text) text += parsed.delta.text;
        } else if (event === 'content_block_stop') {
          const block = blocks.find(item => item.index === parsed.index);
          if (block) delete block.index;
        }
      }
      event = '';
      data = '';
    };
    for (const line of sse.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { flush(); continue; }
      if (trimmed.startsWith('event:')) event = trimmed.slice(6).trim();
      else if (trimmed.startsWith('data:')) {
        const value = trimmed.slice(5).trim();
        data = data ? `${data}\n${value}` : value;
      }
    }
    flush();
    return text;
  }

  it('keeps Kimi answer text that arrives without an open text block', async () => {
    const thinking = (token: string) =>
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: token } })}\n\n`;
    const text = (token: string, index = 0) =>
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: token } })}\n\n`;
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      thinking('先想'),
      // Answer tokens reuse the thinking index. Pi drops them.
      text('正文'),
      text('还在'),
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      // A later text block is closed early, then more tokens continue on that index.
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      text('开头', 1),
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      text('续写', 1),
      text('未停', 1),
    ];
    const raw = sse.join('');
    expect(piVisibleText(raw)).toBe('开头');
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(piVisibleText(out)).toBe('正文还在开头续写未停');
    expect(out).toContain('"index":1000000');
    expect(out).toContain('"index":1000001');
  });

  it('does not rewrite a normal Anthropic text stream', async () => {
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    ];
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(piVisibleText(out)).toBe('你好');
    expect(out).not.toContain('1000000');
  });

  it('releases Kimi events that omit the blank-line separator, including a split UTF-8 token', async () => {
    const first = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n';
    const second = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"中"}}\n';
    const third = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"文"}}\n';
    const bytes = encoder.encode(first + second + third);
    const splitAt = encoder.encode(first).length + encoder.encode(second.slice(0, second.indexOf('中'))).length + 1;
    const processor = createAnthropicSseStrippingStream();
    const writer = processor.writable.getWriter();
    const reader = processor.readable.getReader();
    const collected: Uint8Array[] = [];
    const drained = (async () => {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        collected.push(item.value);
      }
    })();
    await writer.write(bytes.slice(0, splitAt));
    await writer.write(bytes.slice(splitAt));
    await writer.close();
    await drained;
    const out = decoder.decode(Buffer.concat(collected));
    expect(piVisibleText(out)).toBe('中文');
  });

  it('forwards a full Anthropic Messages stream, including ping, signature, usage, errors, and unknown events', async () => {
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg","usage":{"input_tokens":3,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"先想"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"redacted"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      ': keepalive\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"正文"}}\n\n',
      'event: vendor_extension\ndata: {"type":"vendor_extension","note":"ignore"}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"/tmp\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":3}\n\n',
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":12}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(piVisibleText(out)).toBe('正文');
    expect(out).toContain('"signature":"sig-1"');
    expect(out).toContain('"type":"redacted_thinking"');
    expect(out).toContain('event: ping');
    expect(out).toContain('event: vendor_extension');
    expect(out).toContain('event: error');
    expect(out).toContain('"message":"busy"');
    expect(out).toContain('"stop_reason":"end_turn"');
    expect(out).toContain('"output_tokens":12');
    expect(out).toContain('"partial_json":"{\\"path\\":\\"/tmp\\"}"');
    expect(out).not.toContain('1000000');
  });

  it('normalizes third-party reasoning aliases onto Pi thinking blocks', async () => {
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"reasoning","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"reasoning_delta","reasoning":"推理"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature","signature":"sig-2"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text","text":"答案"}}\n\n',
    ];
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(out).toContain('"type":"thinking"');
    expect(out).toContain('"type":"thinking_delta"');
    expect(out).toContain('"thinking":"推理"');
    expect(out).toContain('"type":"signature_delta"');
    expect(out).toContain('"signature":"sig-2"');
    expect(out).not.toContain('"type":"reasoning_delta"');
    expect(out).not.toContain('undefined');
    expect(piVisibleText(out)).toBe('答案');
  });

  it('keeps a normal Anthropic stream event-for-event', async () => {
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg","usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('');
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), [sse]);
    expect(out).toBe(sse);
  });

  it('parses CRLF, bare CR, and a CR/LF split across chunks', async () => {
    const crlf = 'event: content_block_start\r\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\r\n\r\n'
      + 'event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"A"}}\r\n\r\n';
    const cr = 'event: content_block_delta\rdata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"B"}}\r\r';
    const split = encoder.encode('event: content_block_delta\r\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"C"}}\r\n\r\n');
    const breakAt = split.indexOf(0x0d);
    const processor = createAnthropicSseStrippingStream();
    const writer = processor.writable.getWriter();
    const reader = processor.readable.getReader();
    const collected: Uint8Array[] = [];
    const drained = (async () => {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        collected.push(item.value);
      }
    })();
    await writer.write(encoder.encode(crlf + cr));
    await writer.write(split.slice(0, breakAt + 1));
    await writer.write(split.slice(breakAt + 1));
    await writer.close();
    await drained;
    expect(piVisibleText(decoder.decode(Buffer.concat(collected)))).toBe('ABC');
  });

  it('joins multi-line data and emits it as separate data fields', async () => {
    const sse = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {',
      'data:   "type": "content_block_delta",',
      'data:   "index": 0,',
      'data:   "delta": {"type": "text_delta", "text": "a\\nb"}',
      'data: }',
      '',
    ].join('\n');
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), [sse]);
    expect(piVisibleText(out)).toBe('a\nb');
    const delta = out.split('\n\n').find(frame => frame.includes('content_block_delta') && frame.includes('text_delta'));
    expect(delta?.split('\n').filter(line => line.startsWith('data:')).length).toBeGreaterThan(1);
    expect(delta).not.toContain('\n  "type"');
  });

  it('infers the event name when a gateway sends data only', async () => {
    const sse = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
      + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"仅数据"}}\n\n';
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), [sse]);
    expect(piVisibleText(out)).toBe('仅数据');
    expect(out).toContain('event: content_block_delta');
  });

  it('does not concatenate a data-only event into the next event line', async () => {
    const sse = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n'
      + 'event: content_block_delta\n'
      + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"分开"}}\n\n';
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), [sse]);
    expect(piVisibleText(out)).toBe('分开');
  });

  it('coerces string indexes and keeps interleaved text, thinking, and tool blocks apart', async () => {
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":"0","content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":"0","delta":{"type":"text_delta","text":"甲"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"乙"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_2","name":"Read"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":"0","delta":{"type":"text_delta","text":"丙"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":2}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"\\"/tmp\\"}"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n',
    ];
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(piVisibleText(out)).toBe('甲丙');
    expect(out).toContain('"thinking":"乙"');
    expect(out).toContain('"partial_json":"{\\"path\\":\\"/tmp\\"}"');
    const stopAt = out.indexOf('"stop_reason":"tool_use"');
    const toolJsonAt = out.indexOf('"partial_json":"{\\"path\\":\\"/tmp\\"}"');
    expect(toolJsonAt).toBeGreaterThan(-1);
    expect(stopAt).toBeGreaterThan(toolJsonAt);
  });

  it('closes recovered blocks before stop_reason and drops an empty orphan signature', async () => {
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"正文"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":""}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
    ];
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(piVisibleText(out)).toBe('正文');
    const textStop = out.indexOf('"index":1000000');
    const stopReason = out.indexOf('"stop_reason":"end_turn"');
    expect(out.slice(0, stopReason)).toContain('"type":"content_block_stop"');
    expect(textStop).toBeGreaterThan(-1);
    expect(stopReason).toBeGreaterThan(textStop);
    expect(out.match(/"type":"thinking"/g)).toEqual(['"type":"thinking"']);
  });

  it('forwards a mid-stream error after closing recovered text', async () => {
    const sse = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"半截"}}\n\n',
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n',
    ];
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(piVisibleText(out)).toBe('半截');
    expect(out.indexOf('content_block_stop')).toBeLessThan(out.indexOf('event: error'));
    expect(out).toContain('"message":"busy"');
  });

  it('fails a huge SSE line without echoing the payload', async () => {
    const huge = 'x'.repeat(80);
    const sse = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${huge}"}}\n\n`;
    const out = await runThroughProcessor(createAnthropicSseStrippingStream({ maxBufferChars: 40 }), [sse]);
    expect(out).toContain('event: error');
    expect(out).toContain('maximum size');
    expect(out).not.toContain(huge);
  });

  it('keeps a message_stop that arrives without a data payload', async () => {
    const sse = [
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"完"}}\n\n',
      'event: ping\n\n',
      'event: message_stop\n\n',
    ];
    const out = await runThroughProcessor(createAnthropicSseStrippingStream(), sse);
    expect(piVisibleText(out)).toBe('完');
    expect(out).toContain('event: ping');
    expect(out).toContain('event: message_stop');
    expect(out).toContain('{"type":"message_stop"}');
  });

  /**
   * Moonshot's Anthropic-compatible endpoint frames each SSE event as
   * `data:{json}` and a single LF. There is no `event:` line and no blank
   * line. Tokens must be visible after the chunk that completes them, and
   * the flushed text must equal the full answer.
   */
  it('streams Kimi data-only Anthropic events incrementally and keeps the full answer', async () => {
    const head = '# 周报\n\n';
    const midA = '- 已完成流式修复\n';
    const midB = '- 最终内容完整\n\n';
    const tail = '详见 `code` 与 {括号}。';
    const answer = head + midA + midB + tail;
    const thinkingSeed = '先整理结构';
    const thinkingMore = '，再写正文';
    const line = (event: unknown) => `data:${JSON.stringify(event)}\n`;
    const messageStart = {
      type: 'message_start',
      message: { id: 'msg_kimi', usage: { input_tokens: 11, output_tokens: 0 } },
    };
    const thinkStart = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: thinkingSeed, signature: '' },
    };
    const thinkDelta = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: thinkingMore },
    };
    const signature = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig-kimi' },
    };
    const thinkStop = { type: 'content_block_stop', index: 0 };
    const textStart = {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'text', text: head },
    };
    const textMidA = {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: midA },
    };
    const textMidB = {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: midB },
    };
    const textTail = {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: tail },
    };
    const textStop = { type: 'content_block_stop', index: 1 };
    const usage = {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 24 },
    };
    const stop = { type: 'message_stop' };

    const thinkBytes = encoder.encode(line(thinkDelta));
    const thinkCut = Math.floor(thinkBytes.length / 2);
    const tailBytes = encoder.encode(line(textTail));
    const tailCut = Math.floor(tailBytes.length / 2);
    const chunks: Array<string | Uint8Array> = [
      line(messageStart) + line(thinkStart).replace(/\n$/, '\r\n'),
      thinkBytes.slice(0, thinkCut),
      thinkBytes.slice(thinkCut),
      line(signature) + line(thinkStop) + 'data: {"type":"ping"}\n',
      line(textStart),
      `data:${JSON.stringify(textMidA)}${JSON.stringify(textMidB)}\n`,
      tailBytes.slice(0, tailCut),
      tailBytes.slice(tailCut),
      `${line(textStop)}${line(usage)}data:${JSON.stringify(stop)}`,
    ];
    const expected = [
      '',
      '',
      '',
      '',
      head,
      head + midA + midB,
      head + midA + midB,
      answer,
      answer,
    ];

    const processor = createAnthropicSseStrippingStream();
    const writer = processor.writable.getWriter();
    const reader = processor.readable.getReader();
    const parts: string[] = [];
    const reading = (async () => {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        parts.push(decoder.decode(item.value));
      }
    })();
    await new Promise(resolve => setTimeout(resolve, 0));
    const seen: string[] = [];
    for (const chunk of chunks) {
      const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
      await writer.write(bytes);
      await new Promise(resolve => setTimeout(resolve, 0));
      seen.push(piVisibleText(parts.join('')));
    }
    expect(seen).toEqual(expected);
    await writer.close();
    await reading;
    const out = parts.join('');
    expect(piVisibleText(out)).toBe(answer);
    expect(out).toContain(`"thinking":"${thinkingSeed}"`);
    expect(out).toContain(`"thinking":"${thinkingMore}"`);
    expect(out).toContain('"text":""');
    expect(out).toContain('"thinking":""');
    expect(out).toContain('"signature":"sig-kimi"');
    expect(out).toContain('event: ping');
    expect(out).toContain('"output_tokens":24');
    expect(out).toContain('"stop_reason":"end_turn"');
    expect(out).toContain('event: message_stop');
    expect(out).not.toContain('1000000');
  });

  it('drops buffered tool arguments when the reader cancels', async () => {
    const processor = createAnthropicSseStrippingStream();
    const writer = processor.writable.getWriter();
    const reader = processor.readable.getReader();
    const firstWrite = writer.write(encoder.encode(
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_x","name":"Read"}}\n\n',
    ));
    const first = await reader.read();
    expect(first.done).toBe(false);
    await firstWrite;
    const cancel = reader.cancel();
    await writer.close().catch(() => {});
    await cancel;
    const after = await reader.read();
    expect(after.done).toBe(true);
  });

  describe('stripMetadataFieldsFromRawJson', () => {
    it('strips _intent and _displayName from valid JSON', () => {
      const input = '{"path":"/tmp","_intent":"Read file","_displayName":"Read Tmp"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp"}');
      expect(result).not.toContain('_intent');
      expect(result).not.toContain('_displayName');
    });

    it('strips metadata fields at the beginning of the object', () => {
      const input = '{"_intent":"do thing","_displayName":"Do Thing","path":"/tmp"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp"}');
    });

    it('strips metadata fields in the middle of the object', () => {
      const input = '{"a":1,"_intent":"do thing","_displayName":"Do Thing","b":2}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('handles escaped quotes in metadata values', () => {
      const input = '{"path":"/tmp","_intent":"Read \\"special\\" file","_displayName":"Read"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp"}');
    });

    it('returns unchanged JSON when no metadata fields present', () => {
      const input = '{"path":"/tmp","limit":10}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{"path":"/tmp","limit":10}');
    });

    it('handles JSON with only metadata fields', () => {
      const input = '{"_intent":"do thing","_displayName":"Do Thing"}';
      const result = stripMetadataFieldsFromRawJson(input);
      expect(result).toBe('{}');
    });
  });
});
