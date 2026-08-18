/**
 * Tests for the call_llm partial-output recovery path.
 */
import { describe, it, expect } from 'bun:test';
import { createLLMTool, type LLMQueryRequest, type LLMQueryResult } from '../llm-tool.ts';

describe('call_llm tool — warning prefix rendering', () => {
  function buildTool(queryFn: (req: LLMQueryRequest) => Promise<LLMQueryResult>) {
    return createLLMTool({
      sessionId: 'test-session',
      getQueryFn: () => queryFn,
    });
  }

  function argsFor(prompt: string): Parameters<ReturnType<typeof buildTool>['handler']>[0] {
    return {
      prompt,
      attachments: undefined,
      model: undefined,
      systemPrompt: undefined,
      maxTokens: undefined,
      temperature: undefined,
      outputFormat: undefined,
      outputSchema: undefined,
    };
  }

  async function invoke(tool: ReturnType<typeof buildTool>, prompt: string) {
    return tool.handler(argsFor(prompt));
  }

  it('renders a [Partial result — …] prefix when queryFn returns a warning', async () => {
    const tool = buildTool(async () => ({
      text: 'Draft body here.',
      warning: 'Model stopped at max turns (num_turns=10)',
    }));

    const resp = await invoke(tool, 'draft a paragraph');

    expect(resp.content[0]!.type).toBe('text');
    const body = (resp.content[0] as { text: string }).text;
    expect(body.startsWith('[Partial result — Model stopped at max turns (num_turns=10)]')).toBe(true);
    expect(body).toContain('Draft body here.');
  });

  it('renders plain text when no warning is set', async () => {
    const tool = buildTool(async () => ({ text: 'Clean response.' }));

    const resp = await invoke(tool, 'hi');

    expect((resp.content[0] as { text: string }).text).toBe('Clean response.');
  });

  it('renders warning with placeholder body when text is empty but warning set', async () => {
    const tool = buildTool(async () => ({
      text: '',
      warning: 'Model stopped at max turns (num_turns=10)',
    }));

    const resp = await invoke(tool, 'hi');

    const body = (resp.content[0] as { text: string }).text;
    expect(body).toContain('[Partial result —');
    expect(body).toContain('(no text produced before stop)');
  });

  it('renders "(Model returned empty response)" when both text and warning are empty', async () => {
    const tool = buildTool(async () => ({ text: '' }));

    const resp = await invoke(tool, 'hi');

    expect((resp.content[0] as { text: string }).text).toBe('(Model returned empty response)');
  });
});
