import { expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

it('refreshes OAuth catalogs, preserves API-key selections and keeps Copilot cache on failure', () => {
  const root = mkdtempSync(join(tmpdir(), 'oauth-model-refresh-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'ws', name: 'ws', slug: 'ws', createdAt: 1, updatedAt: 1 }))
    const configPath = join(root, 'config.json')
    const connection = (slug: string, piAuthProvider: string, authType = 'oauth', models = ['pi/old']) => ({
      slug, name: slug, providerType: 'pi', authType, piAuthProvider,
      models, defaultModel: models[0], modelSelectionMode: 'userDefined3Tier', createdAt: 1,
    })
    const connections = [
      connection('chatgpt', 'openai-codex'),
      connection('kimi', 'kimi-coding'),
      connection('xai', 'xai'),
      connection('api-key', 'openai', 'api_key'),
      connection('copilot-offline', 'github-copilot', 'oauth', ['pi/policy-cached']),
      connection('copilot-empty', 'github-copilot', 'oauth', []),
      connection('copilot-online', 'github-copilot'),
      connection('copilot-none', 'github-copilot', 'oauth', ['pi/policy-cached']),
      connection('race-default', 'kimi-coding'),
      { ...connection('race-api', 'openai', 'api_key'), modelSelectionMode: 'automaticallySyncedFromProvider' },
      connection('race-provider', 'xai'),
      connection('invalid-default', 'xai'),
      connection('race-copilot-credentials', 'github-copilot', 'oauth', ['pi/policy-cached']),
    ]
    writeFileSync(configPath, JSON.stringify({
      workspaces: [{ id: 'ws', name: 'ws', rootPath: workspace, createdAt: 1 }],
      activeWorkspaceId: 'ws', activeSessionId: null, defaultLlmConnection: 'chatgpt', llmConnections: connections,
    }))
    const serviceUrl = pathToFileURL(join(import.meta.dir, 'index.ts')).href
    const registryUrl = pathToFileURL(join(import.meta.dir, 'registry.ts')).href
    const run = Bun.spawnSync([process.execPath, '--eval', `
      import { initModelRefreshService } from ${JSON.stringify(serviceUrl)};
      import { MODEL_FETCHERS } from ${JSON.stringify(registryUrl)};
      import { updateLlmConnection } from '@craft-agent/shared/config';
      let copilotToken = 'account-one';
      let releaseCopilot;
      let copilotCalls = 0;
      const copilotWait = new Promise(resolve => { releaseCopilot = resolve; });
      MODEL_FETCHERS.pi = {
        refreshIntervalMs: 0,
        fetchModels: async connection => {
          if (connection.slug === 'copilot-none') return { models: [] };
          if (connection.slug.startsWith('copilot-') && connection.slug !== 'copilot-online') throw new Error('offline');
          if (connection.slug === 'race-default') updateLlmConnection(connection.slug, { defaultModel: 'pi/new' });
          if (connection.slug === 'race-api') updateLlmConnection(connection.slug, { models: ['pi/user'], defaultModel: 'pi/user', modelSelectionMode: 'userDefined3Tier' });
          if (connection.slug === 'race-provider') updateLlmConnection(connection.slug, { piAuthProvider: 'kimi-coding' });
          if (connection.slug === 'race-copilot-credentials' && ++copilotCalls === 1) await copilotWait;
          if (connection.slug === 'invalid-default') return { models: [{ id: 'pi/new', name: 'New', shortName: 'New', description: '', provider: 'pi', contextWindow: 100000 }], serverDefault: 'pi/missing' };
          return { models: [
            { id: 'pi/old', name: 'Old', shortName: 'Old', description: '', provider: 'pi', contextWindow: 100000 },
            { id: 'pi/new', name: 'New', shortName: 'New', description: '', provider: 'pi', contextWindow: 100000 }
          ] };
        }
      };
      const service = initModelRefreshService(async slug => slug === 'race-copilot-credentials' ? { oauthRefreshToken: copilotToken } : {});
      for (const slug of ${JSON.stringify(connections.map(item => item.slug).filter(slug => slug !== 'race-copilot-credentials'))}) await service.refreshConnection(slug);
      const oldRequest = service.refreshConnection('race-copilot-credentials');
      await Promise.resolve();
      copilotToken = 'account-two';
      const newRequest = service.refreshNow('race-copilot-credentials');
      releaseCopilot();
      await Promise.all([oldRequest, newRequest]);
      if (copilotCalls !== 2) throw new Error('Reauthentication did not trigger a fresh request');
      service.stopAll();
    `], { env: { ...process.env, CRAFT_CONFIG_DIR: root }, stdout: 'pipe', stderr: 'pipe' })
    expect(run.stderr.toString()).not.toContain('error:')
    expect(run.exitCode).toBe(0)

    const stored = JSON.parse(readFileSync(configPath, 'utf8')).llmConnections
    for (const slug of ['chatgpt', 'kimi', 'xai', 'copilot-online']) {
      const item = stored.find((entry: { slug: string }) => entry.slug === slug)
      expect(item.modelSelectionMode).toBe('automaticallySyncedFromProvider')
      expect(item.models.map((model: { id: string }) => model.id)).toEqual(['pi/old', 'pi/new'])
      expect(item.defaultModel).toBe('pi/old')
    }
    expect(stored.find((entry: { slug: string }) => entry.slug === 'api-key').models).toEqual(['pi/old'])
    expect(stored.find((entry: { slug: string }) => entry.slug === 'copilot-offline').models).toEqual(['pi/policy-cached'])
    expect(stored.find((entry: { slug: string }) => entry.slug === 'copilot-empty').models).toEqual([])
    const none = stored.find((entry: { slug: string }) => entry.slug === 'copilot-none')
    expect(none.models).toEqual([])
    expect(none.defaultModel).toBe('')
    expect(none.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    expect(stored.find((entry: { slug: string }) => entry.slug === 'race-default').defaultModel).toBe('pi/new')
    expect(stored.find((entry: { slug: string }) => entry.slug === 'race-api').models).toEqual(['pi/user'])
    expect(stored.find((entry: { slug: string }) => entry.slug === 'race-provider').models).toEqual(['pi/old'])
    expect(stored.find((entry: { slug: string }) => entry.slug === 'invalid-default').defaultModel).toBe('pi/new')
    expect(stored.find((entry: { slug: string }) => entry.slug === 'race-copilot-credentials').models.map((model: { id: string }) => model.id)).toEqual(['pi/old', 'pi/new'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
