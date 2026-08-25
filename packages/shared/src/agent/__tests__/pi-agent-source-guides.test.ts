import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgent } from '../pi-agent.ts';
import type { BackendConfig } from '../backend/types.ts';

function createConfig(workspaceRootPath: string): BackendConfig {
  return {
    provider: 'pi',
    workspace: {
      id: 'ws-source-guides',
      name: 'Source Guide Tests',
      rootPath: workspaceRootPath,
    } as any,
    session: {
      id: 'session-source-guides',
      workspaceRootPath,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    } as any,
    isHeadless: true,
  };
}

describe('PiAgent source guide preparation', () => {
  let workspaceRootPath: string;
  let guidePath: string;
  let agent: PiAgent;
  let sent: Array<Record<string, unknown>>;
  let automationCalls: string[];

  beforeEach(async () => {
    workspaceRootPath = mkdtempSync(join(tmpdir(), 'selection-source-guide-'));
    const sourcePath = join(workspaceRootPath, 'sources', 'anysearch');
    mkdirSync(sourcePath, { recursive: true });
    guidePath = join(sourcePath, 'guide.md');
    agent = new PiAgent(createConfig(workspaceRootPath));
    agent.setPermissionMode('allow-all');
    await agent.setSourceServers({ anysearch: {} as any }, {}, ['anysearch']);

    sent = [];
    automationCalls = [];
    (agent as any).send = (message: Record<string, unknown>) => sent.push(message);
    (agent as any).emitAutomationEvent = async (event: string) => automationCalls.push(event);
  });

  afterEach(() => {
    agent.destroy();
    rmSync(workspaceRootPath, { recursive: true, force: true });
  });

  it('executes source tools immediately when their guide is an empty skeleton', async () => {
    writeFileSync(guidePath,
      '# anysearch\n\n## Guidelines\n\n(Add usage guidelines here)\n\n## Context\n\n(Add context about this source)',
    );

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-empty-guide',
      toolCallId: 'call-empty-guide',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 1,
    });

    expect(sent.at(-1)).toEqual({
      type: 'pre_tool_use_response',
      requestId: 'source-empty-guide',
      action: 'allow',
    });
    expect(automationCalls).toEqual(['PreToolUse']);
  });

  it('prepares meaningful guides internally and executes only after a new model decision', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-first',
      toolCallId: 'call-first',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3', _intent: 'Search official model announcements' },
      assistantGeneration: 5,
    });

    const first = sent.at(-1)!;
    expect(first.action).toBe('prepare_source_guide');
    expect(first.sourceGuide).toMatchObject({
      sourceSlug: 'anysearch',
      guideContent: '# anysearch\nPrefer official model announcements.',
      assistantGeneration: 5,
      alreadyPreparedInGeneration: false,
    });
    expect(automationCalls).toHaveLength(0);
    expect((agent as any).preToolMetadataByCallId.has('call-first')).toBe(false);

    const preparation = first.sourceGuide as Record<string, unknown>;
    (agent as any).handleLine(JSON.stringify({
      type: 'source_guide_prepared',
      toolCallId: 'call-first',
      sourceSlug: preparation.sourceSlug,
      guidePath: preparation.guidePath,
      guideVersion: preparation.guideVersion,
      assistantGeneration: 5,
    }));

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-sibling',
      toolCallId: 'call-sibling',
      toolName: 'mcp__anysearch__batch_search',
      input: { queries: ['Kimi K3'] },
      assistantGeneration: 5,
    });
    expect(sent.at(-1)?.action).toBe('prepare_source_guide');
    expect((sent.at(-1)?.sourceGuide as Record<string, unknown>).alreadyPreparedInGeneration).toBe(true);
    expect(automationCalls).toHaveLength(0);

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-real-call',
      toolCallId: 'call-real',
      toolName: 'mcp__anysearch__batch_search',
      input: { queries: ['Kimi K3 official announcement'] },
      assistantGeneration: 6,
    });
    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'source-real-call',
      action: 'allow',
    });
    expect(automationCalls).toEqual(['PreToolUse']);
  });

  it('uses the same lazy preparation protocol for API sources', async () => {
    writeFileSync(guidePath, '# anysearch\nUse GET /v2/search with the query parameter q.');

    await (agent as any).handlePreToolUseRequest({
      requestId: 'api-first',
      toolCallId: 'api-call-first',
      toolName: 'api_anysearch',
      input: { path: '/v1/search', method: 'GET', params: { q: 'Kimi K3' } },
      assistantGeneration: 9,
    });

    const first = sent.at(-1)!;
    expect(first.action).toBe('prepare_source_guide');
    expect((first.sourceGuide as Record<string, unknown>).guideContent).toContain('GET /v2/search');
    expect(automationCalls).toHaveLength(0);

    const preparation = first.sourceGuide as Record<string, unknown>;
    (agent as any).handleLine(JSON.stringify({
      type: 'source_guide_prepared',
      toolCallId: 'api-call-first',
      sourceSlug: preparation.sourceSlug,
      guidePath: preparation.guidePath,
      guideVersion: preparation.guideVersion,
      assistantGeneration: 9,
    }));

    await (agent as any).handlePreToolUseRequest({
      requestId: 'api-real-call',
      toolCallId: 'api-call-real',
      toolName: 'api_anysearch',
      input: { path: '/v2/search', method: 'GET', params: { q: 'Kimi K3' } },
      assistantGeneration: 10,
    });

    expect(sent.at(-1)?.action).toBe('allow');
    expect(automationCalls).toEqual(['PreToolUse']);
  });

  it('reports unreadable existing guides as real failures without pretending to execute', async () => {
    mkdirSync(guidePath);

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-unreadable',
      toolCallId: 'call-unreadable',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 1,
    });

    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'source-unreadable',
      action: 'block',
    });
    expect(String(sent.at(-1)?.reason)).toContain('cannot be read');
    expect(automationCalls).toEqual(['PreToolUse']);
  });

  it('fails safely if a source somehow reaches execution before guide preparation', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');

    await (agent as any).handleToolExecuteRequest({
      requestId: 'source-unprepared-execute',
      toolName: 'mcp__anysearch__search',
      args: { query: 'Kimi K3' },
    });

    expect(sent.at(-1)).toMatchObject({
      type: 'tool_execute_response',
      requestId: 'source-unprepared-execute',
      result: { isError: true },
    });
    const result = sent.at(-1)?.result as { content: string };
    expect(result.content).toContain('not executed');
  });

  it('ignores stale preparation acknowledgements after context reset', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');
    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-before-reset',
      toolCallId: 'call-before-reset',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 2,
    });
    const preparation = sent.at(-1)?.sourceGuide as Record<string, unknown>;

    agent.resetPrerequisiteState();
    (agent as any).handleLine(JSON.stringify({
      type: 'source_guide_prepared',
      toolCallId: 'call-before-reset',
      sourceSlug: preparation.sourceSlug,
      guidePath: preparation.guidePath,
      guideVersion: preparation.guideVersion,
      assistantGeneration: 2,
    }));

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-after-reset',
      toolCallId: 'call-after-reset',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 3,
    });
    expect(sent.at(-1)?.action).toBe('prepare_source_guide');
  });

  it('does not accept preparation acknowledgements from a different assistant generation', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');
    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-original-generation',
      toolCallId: 'call-original-generation',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 3,
    });
    const preparation = sent.at(-1)?.sourceGuide as Record<string, unknown>;

    (agent as any).handleLine(JSON.stringify({
      type: 'source_guide_prepared',
      toolCallId: 'call-original-generation',
      sourceSlug: preparation.sourceSlug,
      guidePath: preparation.guidePath,
      guideVersion: preparation.guideVersion,
      assistantGeneration: 9,
    }));

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-after-invalid-ack',
      toolCallId: 'call-after-invalid-ack',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 4,
    });
    expect(sent.at(-1)?.action).toBe('prepare_source_guide');
  });

  it('reports an internal preparation failure once and never marks the guide ready', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');
    const surfacedEvents: Array<Record<string, unknown>> = [];
    (agent as any).eventQueue.enqueue = (event: Record<string, unknown>) => surfacedEvents.push(event);

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-failed-preparation',
      toolCallId: 'call-failed-preparation',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 2,
    });
    const preparation = sent.at(-1)?.sourceGuide as Record<string, unknown>;

    (agent as any).handleLine(JSON.stringify({
      type: 'source_guide_failed',
      toolCallId: 'call-failed-preparation',
      sourceSlug: preparation.sourceSlug,
      guidePath: preparation.guidePath,
      guideVersion: preparation.guideVersion,
      assistantGeneration: 2,
      reason: 'The tool result could not be delivered.',
    }));

    expect((agent as any).pendingSourceGuidePreparations.size).toBe(0);
    expect(surfacedEvents).toHaveLength(1);
    expect(surfacedEvents[0]).toMatchObject({ type: 'error' });
    expect(String(surfacedEvents[0]?.message)).toContain('could not be delivered');
    expect(String(surfacedEvents[0]?.message)).toContain('not executed');

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-retry-after-failure',
      toolCallId: 'call-retry-after-failure',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 3,
    });
    expect(sent.at(-1)?.action).toBe('prepare_source_guide');
  });

  it('never prepares or executes an uncorrelated source tool call', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-missing-id',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 2,
    });

    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'source-missing-id',
      action: 'block',
    });
    expect(String(sent.at(-1)?.reason)).toContain('no identifier');
    expect(automationCalls).toHaveLength(0);
  });

  it('still requires user approval for a mutation after its source is activated', async () => {
    await agent.setSourceServers({}, {}, []);
    agent.setPermissionMode('ask');

    const requestedPermissions: string[] = [];
    agent.onSourceActivationRequest = async (slug) => {
      await agent.setSourceServers({ [slug]: {} as any }, {}, [slug]);
      return true;
    };
    agent.onPermissionRequest = (request) => {
      requestedPermissions.push(request.toolName);
      agent.respondToPermission(request.requestId, false);
    };

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-activate-mutation',
      toolCallId: 'call-activate-mutation',
      toolName: 'mcp__anysearch__create_item',
      input: { title: 'Do not create without approval' },
      assistantGeneration: 1,
    });

    expect(requestedPermissions).toEqual(['mcp__anysearch__create_item']);
    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'source-activate-mutation',
      action: 'block',
      reason: 'Permission denied by user.',
    });
  });

  it('prepares mutation guidance before asking for approval and executes only once approved', async () => {
    writeFileSync(guidePath, '# anysearch\nRequire an explicit item title.');
    agent.setPermissionMode('ask');
    const requestedPermissions: string[] = [];
    agent.onPermissionRequest = (request) => {
      requestedPermissions.push(request.toolName);
      agent.respondToPermission(request.requestId, true);
    };

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-write-prepare',
      toolCallId: 'call-write-prepare',
      toolName: 'mcp__anysearch__create_item',
      input: { title: 'Unreviewed title' },
      assistantGeneration: 5,
    });
    expect(requestedPermissions).toHaveLength(0);
    expect(automationCalls).toHaveLength(0);

    const preparation = sent.at(-1)?.sourceGuide as Record<string, unknown>;
    (agent as any).handleLine(JSON.stringify({
      type: 'source_guide_prepared',
      toolCallId: 'call-write-prepare',
      sourceSlug: preparation.sourceSlug,
      guidePath: preparation.guidePath,
      guideVersion: preparation.guideVersion,
      assistantGeneration: 5,
    }));

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-write-real',
      toolCallId: 'call-write-real',
      toolName: 'mcp__anysearch__create_item',
      input: { title: 'Explicit reviewed title' },
      assistantGeneration: 6,
    });

    expect(requestedPermissions).toEqual(['mcp__anysearch__create_item']);
    expect(automationCalls).toEqual(['PermissionRequest', 'PreToolUse']);
    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'source-write-real',
      action: 'allow',
    });
  });

  it('fails closed if source activation claims success without activating the source', async () => {
    await agent.setSourceServers({}, {}, []);
    const surfacedEvents: Array<Record<string, unknown>> = [];
    (agent as any).eventQueue.enqueue = (event: Record<string, unknown>) => surfacedEvents.push(event);
    agent.onSourceActivationRequest = async () => true;

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-false-activation',
      toolCallId: 'call-false-activation',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 1,
    });

    expect(sent.at(-1)).toMatchObject({
      type: 'pre_tool_use_response',
      requestId: 'source-false-activation',
      action: 'block',
    });
    expect(String(sent.at(-1)?.reason)).toContain('not active');
    expect(automationCalls).toHaveLength(0);
    expect(surfacedEvents).toEqual([]);
  });

  it('reads guides from the new workspace after the agent changes workspaces', async () => {
    writeFileSync(guidePath, '# anysearch\nOld workspace instructions.');
    const newWorkspaceRoot = join(workspaceRootPath, 'next-workspace');
    const nextSourceDirectory = join(newWorkspaceRoot, 'sources', 'anysearch');
    mkdirSync(nextSourceDirectory, { recursive: true });
    writeFileSync(join(nextSourceDirectory, 'guide.md'), '# anysearch\nNew workspace instructions.');

    agent.setWorkspace({
      id: 'ws-next-source-guides',
      name: 'Next Source Guide Workspace',
      rootPath: newWorkspaceRoot,
    } as any);
    await agent.setSourceServers({ anysearch: {} as any }, {}, ['anysearch']);

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-next-workspace',
      toolCallId: 'call-next-workspace',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 1,
    });

    expect(sent.at(-1)?.action).toBe('prepare_source_guide');
    expect((sent.at(-1)?.sourceGuide as Record<string, unknown>).guidePath)
      .toBe(join(nextSourceDirectory, 'guide.md'));
    expect((sent.at(-1)?.sourceGuide as Record<string, unknown>).guideContent)
      .toContain('New workspace instructions.');
  });

  it('discards in-flight guide preparation when its subprocess exits', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');
    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-before-subprocess-exit',
      toolCallId: 'call-before-subprocess-exit',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 2,
    });

    expect((agent as any).pendingSourceGuidePreparations.size).toBe(1);
    (agent as any).handleSubprocessExit(1, null);
    expect((agent as any).pendingSourceGuidePreparations.size).toBe(0);
    expect((agent as any).readToolInputsByCallId.size).toBe(0);
  });

  it('invalidates prepared source guides after a successful manual compaction response', async () => {
    writeFileSync(guidePath, '# anysearch\nPrefer official model announcements.');
    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-before-manual-compaction',
      toolCallId: 'call-before-manual-compaction',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 2,
    });
    const preparation = sent.at(-1)?.sourceGuide as Record<string, unknown>;
    (agent as any).handleLine(JSON.stringify({
      type: 'source_guide_prepared',
      toolCallId: 'call-before-manual-compaction',
      sourceSlug: preparation.sourceSlug,
      guidePath: preparation.guidePath,
      guideVersion: preparation.guideVersion,
      assistantGeneration: 2,
    }));

    (agent as any).pendingCompactions.set('manual-compact', {
      resolve: () => {},
      reject: () => {},
    });
    (agent as any).handleLine(JSON.stringify({
      type: 'compact_result',
      id: 'manual-compact',
      success: true,
      result: {
        summary: 'Compacted conversation',
        firstKeptEntryId: 'entry-1',
        tokensBefore: 5000,
      },
    }));

    await (agent as any).handlePreToolUseRequest({
      requestId: 'source-after-manual-compaction',
      toolCallId: 'call-after-manual-compaction',
      toolName: 'mcp__anysearch__search',
      input: { query: 'Kimi K3' },
      assistantGeneration: 3,
    });
    expect(sent.at(-1)?.action).toBe('prepare_source_guide');
  });
});
