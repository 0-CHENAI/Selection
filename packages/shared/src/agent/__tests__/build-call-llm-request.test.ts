/**
 * Tests for buildCallLlmRequest() — the shared pre-execution pipeline
 * used by PiAgent's call_llm PreToolUse intercept.
 *
 * Tests cover input validation, attachment processing, schema injection,
 * and the validateModel callback hook.
 */
import { describe, it, expect } from 'bun:test';
import { buildCallLlmRequest, callLlmPromptImages, createLLMTool, resolveCallLlmModel } from '../llm-tool.ts';
import type { LLMQueryRequest } from '../llm-tool.ts';
import { createMockBackendConfig, TestAgent } from './test-utils.ts';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';

// ============================================================
// Test fixtures
// ============================================================

const TMP_DIR = join(import.meta.dir, '__tmp_build_call_llm__');

function setupFixtures() {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(join(TMP_DIR, 'test.ts'), 'const x = 1;\nconst y = 2;\n');
  writeFileSync(join(TMP_DIR, 'empty.ts'), '');
  writeFileSync(join(TMP_DIR, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header
}

function cleanupFixtures() {
  rmSync(TMP_DIR, { recursive: true, force: true });
}

// ============================================================
// Tests
// ============================================================

describe('resolveCallLlmModel()', () => {
  it('uses the explicit model when present', () => {
    expect(resolveCallLlmModel('pi/gpt-5-mini', 'qwen/qwen3-max')).toBe('pi/gpt-5-mini');
  });

  it('inherits the session model when the caller omits one', () => {
    expect(resolveCallLlmModel(undefined, 'qwen/qwen3-max')).toBe('qwen/qwen3-max');
  });

  it('treats blank requested models as omitted', () => {
    expect(resolveCallLlmModel('   ', 'qwen/qwen3-max')).toBe('qwen/qwen3-max');
  });

  it('returns undefined when neither side has a model', () => {
    expect(resolveCallLlmModel(undefined, '  ')).toBeUndefined();
  });
});

describe('buildCallLlmRequest()', () => {
  // Setup/teardown
  setupFixtures();
  // Note: cleanup at end of file via process.on

  // --- Validation ---

  it('throws on empty prompt', async () => {
    await expect(
      buildCallLlmRequest({ prompt: '' }, { backendName: 'Test' })
    ).rejects.toThrow('Prompt is required');
  });

  it('throws on whitespace-only prompt', async () => {
    await expect(
      buildCallLlmRequest({ prompt: '   ' }, { backendName: 'Test' })
    ).rejects.toThrow('Prompt is required');
  });

  it('throws on missing prompt', async () => {
    await expect(
      buildCallLlmRequest({} as Record<string, unknown>, { backendName: 'Test' })
    ).rejects.toThrow('Prompt is required');
  });

  // --- Basic request ---

  it('builds request from prompt-only input', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'Summarize this' },
      { backendName: 'Test' }
    );
    expect(result.prompt).toBe('Summarize this');
    expect(result.systemPrompt).toBeUndefined();
    expect(result.model).toBeUndefined();
  });

  it('inherits defaultModel when the caller omits model', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'Research this' },
      { backendName: 'Test', defaultModel: 'qwen/qwen3-max' }
    );
    expect(result.model).toBe('qwen/qwen3-max');
  });

  it('keeps an explicit model instead of defaultModel', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'Research this', model: 'pi/gpt-5-mini' },
      { backendName: 'Test', defaultModel: 'qwen/qwen3-max' }
    );
    expect(result.model).toBe('pi/gpt-5-mini');
  });

  it('passes through systemPrompt', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test', systemPrompt: 'Be concise' },
      { backendName: 'Test' }
    );
    expect(result.systemPrompt).toContain('Be concise');
  });

  it('passes through maxTokens and temperature', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test', maxTokens: 1000, temperature: 0.5 },
      { backendName: 'Test' }
    );
    expect(result.maxTokens).toBe(1000);
    expect(result.temperature).toBe(0.5);
  });

  // --- Attachments ---

  it('processes text file attachments', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'Summarize', attachments: [join(TMP_DIR, 'test.ts')] },
      { backendName: 'Test' }
    );
    expect(result.prompt).toContain('<file path="test.ts">');
    expect(result.prompt).toContain('const x = 1;');
    expect(result.prompt).toContain('Summarize');
  });

  it('rejects image attachments when the active model has no vision', async () => {
    const error = await buildCallLlmRequest(
      { prompt: 'test', attachments: [join(TMP_DIR, 'image.png')] },
      { backendName: 'Selection Backend' },
    ).then(
      () => { throw new Error('expected image rejection'); },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain('vision is not enabled for the active model');
    expect(message).not.toContain('Selection Backend mode');
  });

  it('does not blame Selection Backend mode when a text-only model rejects an image', async () => {
    const image = join(TMP_DIR, 'image.png');
    await expect(
      buildCallLlmRequest(
        { prompt: 'Read the cover', attachments: [image] },
        { backendName: 'Selection Backend', defaultModel: 'deepseek-chat' }
      )
    ).rejects.toThrow('Image attachments are not supported by "deepseek-chat"');

    await expect(
      buildCallLlmRequest(
        { prompt: 'Read the cover', attachments: [image] },
        {
          backendName: 'Selection Backend',
          defaultModel: 'Laufry',
          imageSupport: {
            models: [{ id: 'Laufry', imageSupport: 'off', supportsImages: false }],
          },
        }
      )
    ).rejects.toThrow('vision is not enabled for this model');
  });

  it('passes image attachments for ORDER Laufry with vision enabled', async () => {
    const image = join(TMP_DIR, 'image.png');
    const result = await buildCallLlmRequest(
      { prompt: 'Read the cover slide', attachments: [image] },
      { backendName: 'Selection Backend', defaultModel: 'Laufry' }
    );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    expect(result.model).toBe('Laufry');
    expect(result.images).toEqual([{ type: 'image', data: png, mimeType: 'image/png' }]);
    expect(result.prompt).toContain('[Attached image: image.png]');
    expect(result.prompt).toContain('visual input');
    expect(result.prompt).toContain('Read the cover slide');
    expect(result.prompt).not.toContain(png);
    expect(callLlmPromptImages(result.images)).toEqual(result.images);
  });

  it('passes images for pi/Laufry and an explicit vision override', async () => {
    const image = join(TMP_DIR, 'image.png');
    const inherited = await buildCallLlmRequest(
      { prompt: 'look', attachments: [image] },
      { backendName: 'Selection Backend', defaultModel: 'pi/Laufry' }
    );
    expect(inherited.images).toHaveLength(1);
    expect(inherited.model).toBe('pi/Laufry');

    const forcedOn = await buildCallLlmRequest(
      { prompt: 'look', model: 'deepseek-chat', attachments: [image] },
      {
        backendName: 'Selection Backend',
        defaultModel: 'Laufry',
        imageSupport: {
          endpointSupportsImages: false,
          models: [{ id: 'deepseek-chat', imageSupport: 'on', supportsImages: true }],
        },
      }
    );
    expect(forcedOn.model).toBe('deepseek-chat');
    expect(forcedOn.images?.[0]?.mimeType).toBe('image/png');
  });

  it('keeps a learned vision rejection and an endpoint image block', async () => {
    const image = join(TMP_DIR, 'image.png');
    await expect(
      buildCallLlmRequest(
        { prompt: 'look', attachments: [image] },
        {
          backendName: 'Selection Backend',
          defaultModel: 'Laufry',
          imageSupport: {
            models: [{ id: 'Laufry', imageSupport: 'auto', learnedSupportsImages: false }],
          },
        }
      )
    ).rejects.toThrow('not supported by "Laufry"');

    await expect(
      buildCallLlmRequest(
        { prompt: 'look', attachments: [image] },
        {
          backendName: 'Selection Backend',
          defaultModel: 'Laufry',
          imageSupport: { endpointSupportsImages: false, models: ['Laufry'] },
        }
      )
    ).rejects.toThrow('not supported by "Laufry"');
  });

  it('keeps text files inline beside an allowed image', async () => {
    const result = await buildCallLlmRequest(
      {
        prompt: 'Compare',
        attachments: [join(TMP_DIR, 'test.ts'), join(TMP_DIR, 'image.png')],
      },
      { backendName: 'Selection Backend', defaultModel: 'Laufry' }
    );
    expect(result.prompt).toContain('<file path="test.ts">');
    expect(result.prompt).toContain('const x = 1;');
    expect(result.prompt).toContain('[Attached image: image.png]');
    expect(result.images).toHaveLength(1);
  });

  it('uses the explicit model rather than the session model for vision', async () => {
    const image = join(TMP_DIR, 'image.png');
    const allowed = await buildCallLlmRequest(
      { prompt: 'look', model: 'Laufry', attachments: [image] },
      { backendName: 'Selection Backend', defaultModel: 'deepseek-chat' }
    );
    expect(allowed.images).toHaveLength(1);

    await expect(
      buildCallLlmRequest(
        { prompt: 'look', model: 'deepseek-chat', attachments: [image] },
        { backendName: 'Selection Backend', defaultModel: 'Laufry' }
      )
    ).rejects.toThrow('not supported by "deepseek-chat"');
  });

  it('rejects missing file attachments', async () => {
    await expect(
      buildCallLlmRequest(
        { prompt: 'test', attachments: ['/nonexistent/file.ts'] },
        { backendName: 'Test' }
      )
    ).rejects.toThrow('File not found');
  });

  // --- Schema injection ---

  it('injects outputFormat schema into systemPrompt', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test', outputFormat: 'summary' },
      { backendName: 'Test' }
    );
    expect(result.systemPrompt).toContain('JSON');
    expect(result.systemPrompt).toContain('summary');
    expect(result.systemPrompt).toContain('key_points');
  });

  it('injects custom outputSchema into systemPrompt', async () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };
    const result = await buildCallLlmRequest(
      { prompt: 'test', outputSchema: schema },
      { backendName: 'Test' }
    );
    expect(result.systemPrompt).toContain('"name"');
    expect(result.systemPrompt).toContain('JSON');
  });

  it('appends schema to existing systemPrompt', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test', systemPrompt: 'Custom instructions', outputFormat: 'classification' },
      { backendName: 'Test' }
    );
    expect(result.systemPrompt).toContain('Custom instructions');
    expect(result.systemPrompt).toContain('category');
  });

  it('includes outputSchema in returned request from outputFormat', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test', outputFormat: 'summary' },
      { backendName: 'Test' }
    );
    expect(result.outputSchema).toBeDefined();
    expect((result.outputSchema as Record<string, unknown>).type).toBe('object');
  });

  it('includes custom outputSchema in returned request', async () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    };
    const result = await buildCallLlmRequest(
      { prompt: 'test', outputSchema: schema },
      { backendName: 'Test' }
    );
    expect(result.outputSchema).toEqual(schema);
  });

  it('does not include outputSchema when no schema specified', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test' },
      { backendName: 'Test' }
    );
    expect(result.outputSchema).toBeUndefined();
  });

  // --- validateModel callback ---

  it('calls validateModel with resolved model ID', async () => {
    let receivedModel = '';
    await buildCallLlmRequest(
      { prompt: 'test', model: 'some-model-id' },
      {
        backendName: 'Test',
        validateModel: (modelId) => {
          receivedModel = modelId;
          return modelId;
        },
      }
    );
    expect(receivedModel).toBe('some-model-id');
  });

  it('clears model when validateModel returns undefined', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test', model: 'some-model-id' },
      {
        backendName: 'Test',
        validateModel: () => undefined,
      }
    );
    expect(result.model).toBeUndefined();
  });

  it('uses corrected model from validateModel', async () => {
    const result = await buildCallLlmRequest(
      { prompt: 'test', model: 'some-model-id' },
      {
        backendName: 'Test',
        validateModel: () => 'corrected-model',
      }
    );
    expect(result.model).toBe('corrected-model');
  });

  it('lets the call_llm tool handler pass images only for a vision model', async () => {
    const image = join(TMP_DIR, 'image.png');
    const seen: LLMQueryRequest[] = [];
    const vision = createLLMTool({
      sessionId: 's',
      defaultModel: 'Laufry',
      getQueryFn: () => async (request) => {
        seen.push(request);
        return { text: 'cover looks fine' };
      },
    });
    const ok = await vision.handler({ prompt: 'Read the cover', attachments: [image] });
    expect(ok.isError).toBeUndefined();
    expect(seen[0]?.images).toHaveLength(1);
    expect(seen[0]?.model).toBe('Laufry');

    const blocked = createLLMTool({
      sessionId: 's',
      defaultModel: 'deepseek-chat',
      getQueryFn: () => async () => ({ text: 'should not run' }),
    });
    const refused = await blocked.handler({ prompt: 'Read the cover', attachments: [image] });
    expect(refused.isError).toBe(true);
    expect((refused.content[0] as { text: string }).text).toContain('not supported by "deepseek-chat"');
    expect((refused.content[0] as { text: string }).text).not.toContain('Selection Backend mode');
  });
});

describe('preExecuteCallLlm vision gate', () => {
  it('sends Laufry images through the Selection Backend path', async () => {
    const agent = new TestAgent(createMockBackendConfig({
      model: 'Laufry',
      runtime: { customModels: ['Laufry'] },
    }));
    const seen: LLMQueryRequest[] = [];
    agent.queryLlm = async (request) => {
      seen.push(request);
      return { text: 'saw the cover' };
    };

    const result = await (agent as unknown as {
      preExecuteCallLlm: (input: Record<string, unknown>) => Promise<{ text: string }>;
    }).preExecuteCallLlm({
      prompt: 'Read the cover slide',
      attachments: [join(TMP_DIR, 'image.png')],
    });

    expect(result.text).toBe('saw the cover');
    expect(seen[0]?.model).toBe('Laufry');
    expect(seen[0]?.images?.[0]?.mimeType).toBe('image/png');
    expect(seen[0]?.prompt).toContain('Read the cover slide');
  });

  it('still refuses a connection whose Laufry vision is explicitly off', async () => {
    const agent = new TestAgent(createMockBackendConfig({
      model: 'Laufry',
      runtime: {
        customModels: [{ id: 'Laufry', imageSupport: 'off', supportsImages: false }],
      },
    }));
    agent.queryLlm = async () => ({ text: 'should not run' });

    await expect((agent as unknown as {
      preExecuteCallLlm: (input: Record<string, unknown>) => Promise<unknown>;
    }).preExecuteCallLlm({
      prompt: 'Read the cover slide',
      attachments: [join(TMP_DIR, 'image.png')],
    })).rejects.toThrow('not supported by "Laufry"');
  });
});

// Cleanup
process.on('exit', () => {
  try { cleanupFixtures(); } catch {}
});
