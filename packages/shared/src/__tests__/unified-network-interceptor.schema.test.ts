import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

let injectMetadataIntoToolSchema: typeof import('../unified-network-interceptor.ts').injectMetadataIntoToolSchema;
let sanitizeEmptyTextCacheControl: typeof import('../unified-network-interceptor.ts').sanitizeEmptyTextCacheControl;
let upgradePromptCacheTtl: typeof import('../unified-network-interceptor.ts').upgradePromptCacheTtl;
let _resetConfigCacheForTesting: typeof import('../interceptor-common.ts')._resetConfigCacheForTesting;

describe('unified-network-interceptor schema metadata injection', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ injectMetadataIntoToolSchema, sanitizeEmptyTextCacheControl, upgradePromptCacheTtl } = await import('../unified-network-interceptor.ts'));
    ({ _resetConfigCacheForTesting } = await import('../interceptor-common.ts'));
  });

  it('injects metadata fields into empty/zero-arg schemas', () => {
    const schema = { type: 'object' };
    const result = injectMetadataIntoToolSchema(schema);

    expect(result.properties._displayName).toBeDefined();
    expect(result.properties._intent).toBeDefined();
    expect(result.required).toContain('_displayName');
    expect(result.required).toContain('_intent');
  });

  it('preserves existing properties and required keys while prepending metadata keys', () => {
    const schema = {
      type: 'object',
      properties: {
        url: { type: 'string' },
      },
      required: ['url'],
    };

    const result = injectMetadataIntoToolSchema(schema);

    expect(result.properties.url).toEqual({ type: 'string' });
    expect(result.required).toEqual(['_displayName', '_intent', 'url']);
  });

  it('does not duplicate metadata keys when already present in required', () => {
    const schema = {
      properties: {
        _displayName: { type: 'string', description: 'custom display name schema' },
        _intent: { type: 'string', description: 'custom intent schema' },
      },
      required: ['_intent', '_displayName'],
    };

    const result = injectMetadataIntoToolSchema(schema);

    expect(result.required).toEqual(['_displayName', '_intent']);
    expect(result.properties._displayName).toEqual({ type: 'string', description: 'custom display name schema' });
    expect(result.properties._intent).toEqual({ type: 'string', description: 'custom intent schema' });
  });
});

describe('sanitizeEmptyTextCacheControl', () => {
  it('strips cache_control from empty text blocks', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);

    expect(stripped).toBe(1);
    expect((body.messages[0]!.content as any[])[0].cache_control).toBeUndefined();
    expect((body.messages[0]!.content as any[])[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips cache_control from whitespace-only text blocks', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '   \n\t  ', cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);

    expect(stripped).toBe(1);
    expect((body.messages[0]!.content as any[])[0].cache_control).toBeUndefined();
  });

  it('leaves non-text blocks untouched', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: {}, cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);

    expect(stripped).toBe(0);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('handles messages without content arrays', () => {
    const body = {
      messages: [{ role: 'user', content: 'plain string' }],
    };

    const stripped = sanitizeEmptyTextCacheControl(body);
    expect(stripped).toBe(0);
  });

  it('returns 0 when no messages present', () => {
    expect(sanitizeEmptyTextCacheControl({})).toBe(0);
  });
});

describe('upgradePromptCacheTtl', () => {
  it('leaves blocks without ttl untouched', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
        ],
      }],
    };

    const result = upgradePromptCacheTtl(body);

    expect(result).toBe(0);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips ttl from message content', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'hello', cache_control: { type: 'ephemeral', ttl: '1h' } },
          { type: 'text', text: 'world', cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
      }],
    };

    const stripped = upgradePromptCacheTtl(body);

    expect(stripped).toBe(2);
    expect((body.messages[0]!.content as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((body.messages[0]!.content as any[])[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips ttl from system prompt', () => {
    const body = {
      system: [
        { type: 'text', text: 'You are helpful', cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages: [],
    };

    const stripped = upgradePromptCacheTtl(body);

    expect(stripped).toBe(1);
    expect((body.system as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('strips ttl from top-level cache_control', () => {
    const body = {
      cache_control: { type: 'ephemeral', ttl: '1h' },
      messages: [],
    };

    const stripped = upgradePromptCacheTtl(body);

    expect(stripped).toBe(1);
    expect(body.cache_control as any).toEqual({ type: 'ephemeral' });
  });

  it('leaves blocks without cache_control untouched', () => {
    const body = {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'no cache' },
        ],
      }],
    };

    expect(upgradePromptCacheTtl(body)).toBe(0);
    expect((body.messages[0]!.content as any[])[0].cache_control).toBeUndefined();
  });

  it('returns 0 when no messages or system prompt', () => {
    expect(upgradePromptCacheTtl({})).toBe(0);
  });

  it('strips ttl from tool cache_control', () => {
    const body = {
      tools: [
        { name: 'search', description: 'do a search', cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
      messages: [],
    };

    const stripped = upgradePromptCacheTtl(body);

    expect(stripped).toBe(1);
    expect((body.tools as any[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});
