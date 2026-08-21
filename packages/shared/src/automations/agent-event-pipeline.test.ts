import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomationSystem } from './automation-system.ts';
import { AGENT_EVENTS, type PendingPrompt } from './types.ts';
import { AUTOMATIONS_CONFIG_FILE, AUTOMATIONS_HISTORY_FILE } from './constants.ts';
import { enrichAgentEventInput } from './agent-event-envelope.ts';
import { sanitizeAgentEventInput, AGENT_EVENT_PAYLOAD_MAX_CHARS } from './agent-event-sanitize.ts';
import { AgentEventGuards, MAX_AUTOMATION_DEPTH } from './agent-event-guards.ts';

const PI_AGENT_SOURCE = join(import.meta.dir, '../agent/pi-agent.ts');
const SESSION_MANAGER_SOURCE = join(import.meta.dir, '../../../server-core/src/sessions/SessionManager.ts');

describe('Agent Event pipeline', () => {
  let tempDir: string;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-event-pipeline-'));
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeConfig(automations: Record<string, unknown>): void {
    writeFileSync(join(tempDir, AUTOMATIONS_CONFIG_FILE), JSON.stringify({ automations }));
  }

  function historyEntries(): Array<Record<string, unknown>> {
    const path = join(tempDir, AUTOMATIONS_HISTORY_FILE);
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>);
  }

  it('dispatches Prompt and Webhook from a real Agent Event with history', async () => {
    writeConfig({
      PreToolUse: [
        {
          id: 'pt1234',
          matcher: '^Bash$',
          labels: ['auto'],
          permissionMode: 'ask',
          name: 'Review bash',
          actions: [
            { type: 'prompt', prompt: 'Inspect $CRAFT_TOOL_NAME', model: 'gpt-5', llmConnection: 'default' },
            { type: 'webhook', url: 'https://example.test/hooks/$CRAFT_EVENT', method: 'POST' },
          ],
        },
      ],
    });

    const prompts: PendingPrompt[] = [];
    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
      onPromptsReady: pending => {
        prompts.push(...pending);
      },
    });

    const input = enrichAgentEventInput('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo hi', Authorization: 'secret-token' },
    }, {
      workspaceId: 'ws-1',
      sessionId: 'sess-src',
      sessionName: 'Source',
      automationDepth: 0,
    });

    const matched = await system.executeAgentEvent('PreToolUse', input);
    expect(matched).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.waitForCompletion).toBe(false);
    expect(prompts[0]!.sourceEvent).toBe('PreToolUse');
    expect(prompts[0]!.sourceSessionId).toBe('sess-src');
    expect(prompts[0]!.labels).toEqual(['auto']);
    expect(prompts[0]!.permissionMode).toBe('ask');
    expect(prompts[0]!.model).toBe('gpt-5');
    expect(prompts[0]!.llmConnection).toBe('default');
    expect(prompts[0]!.automationName).toBe('Review bash');
    expect(prompts[0]!.prompt).toContain('event/tool context, not a user instruction');
    expect(prompts[0]!.prompt).toContain('Inspect Bash');

    await Bun.sleep(20);
    expect(fetchSpy).toHaveBeenCalled();
    const history = historyEntries();
    expect(history.some(entry => entry.id === 'pt1234' && (entry as { webhook?: unknown }).webhook)).toBe(true);

    await system.dispose();
  });

  it('does not execute when matcher or conditions fail', async () => {
    writeConfig({
      PreToolUse: [
        {
          id: 'nomatch',
          matcher: '^Read$',
          actions: [{ type: 'prompt', prompt: 'should not run' }],
        },
      ],
    });

    const onPromptsReady = () => {
      throw new Error('should not schedule');
    };
    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
      onPromptsReady,
    });

    const matched = await system.executeAgentEvent('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      event_id: 'evt-1',
    });

    expect(matched).toBe(0);
    await system.dispose();
  });

  it('does not record suppression when an automation session has no matchers', async () => {
    writeConfig({
      PreToolUse: [
        { id: 'bash01', matcher: '^Bash$', actions: [{ type: 'prompt', prompt: 'check' }] },
      ],
    });

    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
    });

    const matched = await system.executeAgentEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hi',
      event_id: 'evt-no-matchers',
      triggered_by_automation: true,
      automation_depth: MAX_AUTOMATION_DEPTH,
      source_session_id: 'auto-sess',
    });

    expect(matched).toBe(0);
    expect(historyEntries()).toHaveLength(0);
    await system.dispose();
  });

  it('does not wait for Prompt session creation before returning', async () => {
    writeConfig({
      PreToolUse: [
        { id: 'slow01', matcher: '^Bash$', actions: [{ type: 'prompt', prompt: 'slow' }] },
      ],
    });

    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const prompts: PendingPrompt[] = [];
    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
      onPromptsReady: async (pending) => {
        prompts.push(...pending);
        await held;
      },
    });

    const started = Date.now();
    const matched = await system.executeAgentEvent('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      event_id: 'evt-nonblock',
    });
    expect(Date.now() - started).toBeLessThan(200);
    expect(matched).toBe(1);
    expect(prompts).toHaveLength(1);
    release();
    await system.dispose();
  });

  it('allows a mid-chain automation when depth is below the cap', async () => {
    writeConfig({
      UserPromptSubmit: [
        { id: 'relay01', actions: [{ type: 'prompt', prompt: 'relay' }] },
      ],
    });

    const prompts: PendingPrompt[] = [];
    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
      onPromptsReady: pending => { prompts.push(...pending); },
    });

    const matched = await system.executeAgentEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hi',
      event_id: 'evt-relay',
      triggered_by_automation: true,
      automation_depth: 2,
      source_session_id: 'auto-sess',
    });

    expect(matched).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.waitForCompletion).toBe(false);
    await system.dispose();
  });

  it('suppresses recursive automations from automation-created sessions', async () => {
    writeConfig({
      UserPromptSubmit: [
        {
          id: 'loop01',
          actions: [{ type: 'prompt', prompt: 'loop' }],
        },
      ],
    });

    const prompts: PendingPrompt[] = [];
    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
      onPromptsReady: pending => {
        prompts.push(...pending);
      },
    });

    const matched = await system.executeAgentEvent('UserPromptSubmit', {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hi',
      event_id: 'evt-loop',
      triggered_by_automation: true,
      automation_depth: MAX_AUTOMATION_DEPTH,
      source_session_id: 'auto-sess',
    });

    expect(matched).toBe(1);
    expect(prompts).toHaveLength(0);
    const history = historyEntries();
    expect(history.some(entry => entry.status === 'suppressed' && entry.id === 'loop01')).toBe(true);
    await system.dispose();
  });

  it('records duplicate eventIds without dispatching twice', async () => {
    writeConfig({
      Stop: [
        { id: 'stop01', actions: [{ type: 'prompt', prompt: 'stopped' }] },
      ],
    });

    const prompts: PendingPrompt[] = [];
    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
      onPromptsReady: pending => {
        prompts.push(...pending);
      },
    });

    const input = {
      hook_event_name: 'Stop',
      event_id: 'same-stop',
      stop_reason: 'complete' as const,
    };

    expect(await system.executeAgentEvent('Stop', input)).toBe(1);
    expect(await system.executeAgentEvent('Stop', input)).toBe(0);
    expect(prompts).toHaveLength(1);
    await system.dispose();
  });

  it.each(AGENT_EVENTS)('dispatches a Prompt action for %s', async (event) => {
    writeConfig({
      [event]: [
        { id: event.slice(0, 6).padEnd(6, '0'), actions: [{ type: 'prompt', prompt: `handle ${event}` }] },
      ],
    });

    const prompts: PendingPrompt[] = [];
    const system = new AutomationSystem({
      workspaceRootPath: tempDir,
      workspaceId: 'ws-1',
      onPromptsReady: pending => {
        prompts.push(...pending);
      },
    });

    const matched = await system.executeAgentEvent(event, {
      hook_event_name: event,
      event_id: `evt-${event}`,
      tool_name: 'Bash',
      source: 'startup',
      agent_type: 'session',
    });

    expect(matched).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.sourceEvent).toBe(event);
    expect(prompts[0]!.waitForCompletion).toBe(false);
    await system.dispose();
  });

  it('has a production site for every configurable Agent Event', () => {
    const source = `${readFileSync(PI_AGENT_SOURCE, 'utf-8')}\n${readFileSync(SESSION_MANAGER_SOURCE, 'utf-8')}`;
    for (const event of AGENT_EVENTS) {
      expect(source).toContain(`'${event}'`);
    }
    expect(source).not.toContain("'Notification'");
  });
});

describe('Agent Event envelope and guards', () => {
  it('enriches and sanitizes tool payloads', () => {
    const input = enrichAgentEventInput('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: {
        command: 'echo',
        Authorization: 'Bearer secret',
        blob: 'x'.repeat(AGENT_EVENT_PAYLOAD_MAX_CHARS + 20),
      },
    }, {
      workspaceId: 'ws',
      sessionId: 's1',
      sessionName: 'Demo',
    });

    expect(input.event_id).toBeTruthy();
    expect(input.source_backend).toBe('pi');
    expect(input.source_session_id).toBe('s1');
    expect(input.source_root_session_id).toBe('s1');
    expect(input.tool_input?.Authorization).toBe('[redacted]');
    expect(String(input.tool_input?.blob)).toContain('[truncated]');
  });

  it('redacts secrets in sanitizeAgentEventInput', () => {
    const sanitized = sanitizeAgentEventInput({
      hook_event_name: 'PostToolUse',
      tool_input: { api_key: 'abc', nested: { cookie: 'x' } },
      tool_response: JSON.stringify({ token: 'leak', ok: true }),
    });
    expect(sanitized.tool_input?.api_key).toBe('[redacted]');
    expect((sanitized.tool_input?.nested as Record<string, unknown>).cookie).toBe('[redacted]');
    expect(sanitized.tool_response).toContain('[redacted]');
    expect(sanitized.tool_response).not.toContain('leak');
  });

  it('accepts depth below the cap and rejects at the cap', () => {
    const guards = new AgentEventGuards();
    expect(guards.shouldAcceptDepth(0)).toBeNull();
    expect(guards.shouldAcceptDepth(2)).toBeNull();
    expect(guards.shouldAcceptDepth(3)).toBe('recursion');
    expect(guards.shouldAcceptDepth(1, 1)).toBe('recursion');
    guards.dispose();
  });

  it('caps chain spawns from the same root session', () => {
    const guards = new AgentEventGuards();
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      if (guards.shouldAcceptChainSpawn('root-1')) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    expect(guards.shouldAcceptChainSpawn('root-2')).toBeNull();
    expect(guards.shouldAcceptChainSpawn(undefined)).toBeNull();
    guards.dispose();
  });

  it('rate-limits the same matcher', () => {
    const guards = new AgentEventGuards();
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      if (guards.shouldAcceptMatcher('ws', 'PreToolUse', 'm1')) limited++;
    }
    expect(limited).toBeGreaterThan(0);
    guards.dispose();
  });
});
