import { expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

it('keeps OAuth model catalogs provider-managed across settings saves and setup', () => {
  const root = mkdtempSync(join(tmpdir(), 'oauth-model-settings-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'ws', name: 'ws', slug: 'ws', createdAt: 1, updatedAt: 1 }))
    const configPath = join(root, 'config.json')
    const makeConnection = (slug: string, authType: string, piAuthProvider: string) => ({
      slug, name: slug, providerType: 'pi', authType, piAuthProvider,
      models: ['pi/old', 'pi/new'], defaultModel: 'pi/old',
      modelSelectionMode: 'automaticallySyncedFromProvider', createdAt: 1,
    })
    const connections = [makeConnection('kimi', 'oauth', 'kimi-coding'), makeConnection('api', 'api_key', 'openai')]
    writeFileSync(configPath, JSON.stringify({
      workspaces: [{ id: 'ws', name: 'ws', rootPath: workspace, createdAt: 1 }],
      activeWorkspaceId: 'ws', activeSessionId: null, defaultLlmConnection: 'kimi', llmConnections: connections,
    }))
    const handlerUrl = pathToFileURL(join(import.meta.dir, 'llm-connections.ts')).href
    const serviceUrl = pathToFileURL(join(import.meta.dir, '../../model-fetchers/index.ts')).href
    const registryUrl = pathToFileURL(join(import.meta.dir, '../../model-fetchers/registry.ts')).href
    const run = Bun.spawnSync([process.execPath, '--eval', `
      import { registerLlmConnectionsHandlers } from ${JSON.stringify(handlerUrl)};
      import { initModelRefreshService } from ${JSON.stringify(serviceUrl)};
      import { MODEL_FETCHERS } from ${JSON.stringify(registryUrl)};
      import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
      MODEL_FETCHERS.pi = { refreshIntervalMs: 0, fetchModels: async connection => {
        if (connection.slug === 'github-copilot' || connection.slug === 'direct-copilot') throw new Error('offline');
        return { models: [
          { id: 'pi/old', name: 'Old', shortName: 'Old', description: '', provider: 'pi', contextWindow: 100000 },
          { id: 'pi/new', name: 'New', shortName: 'New', description: '', provider: 'pi', contextWindow: 100000 }
        ] };
      } };
      const service = initModelRefreshService(async () => ({}));
      const handlers = new Map();
      registerLlmConnectionsHandlers({ handle: (name, fn) => handlers.set(name, fn) }, {
        sessionManager: { refreshConnectionRuntime: async () => {}, reinitializeAuth: async () => {} },
        platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
      });
      const save = handlers.get(RPC_CHANNELS.llmConnections.SAVE);
      const stale = ${JSON.stringify(connections[0])};
      stale.models = ['pi/old']; stale.modelSelectionMode = 'userDefined3Tier'; stale.defaultModel = 'pi/new';
      const saved = await save({}, stale);
      if (!saved.success) throw new Error('OAuth SAVE failed: ' + saved.error);
      stale.defaultModel = 'pi/removed';
      const staleSaved = await save({}, stale);
      if (!staleSaved.success) throw new Error('Stale OAuth SAVE failed: ' + staleSaved.error);
      const setup = await handlers.get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)({}, {
        slug: 'kimi', models: ['pi/old'], defaultModel: 'pi/removed', modelSelectionMode: 'userDefined3Tier', updateOnly: true,
      });
      if (!setup.success) throw new Error('OAuth SETUP failed: ' + setup.error);
      const created = await handlers.get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)({}, {
        slug: 'kimi-code', models: ['pi/old'], modelSelectionMode: 'userDefined3Tier',
      });
      if (!created.success) throw new Error('OAuth creation failed: ' + created.error);
      const copilot = await handlers.get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)({}, {
        slug: 'github-copilot', piAuthProvider: 'github-copilot',
      });
      if (!copilot.success) throw new Error('Copilot creation failed: ' + copilot.error);
      const directCopilot = await save({}, { ...${JSON.stringify(connections[0])}, slug: 'direct-copilot',
        piAuthProvider: 'github-copilot', models: ['pi/disallowed'], defaultModel: 'pi/disallowed', modelSelectionMode: 'userDefined3Tier' });
      if (!directCopilot.success) throw new Error('Direct OAuth SAVE failed: ' + directCopilot.error);
      const api = ${JSON.stringify(connections[1])};
      api.models = ['pi/old']; api.modelSelectionMode = 'userDefined3Tier';
      const apiSaved = await save({}, api);
      if (!apiSaved.success) throw new Error('API SAVE failed: ' + apiSaved.error);
      service.stopAll();
    `], { env: { ...process.env, CRAFT_CONFIG_DIR: root }, stdout: 'pipe', stderr: 'pipe' })
    if (run.exitCode !== 0) throw new Error(`handler subprocess failed:\n${run.stderr.toString()}`)
    const stored = JSON.parse(readFileSync(configPath, 'utf8')).llmConnections
    const oauth = stored.find((item: { slug: string }) => item.slug === 'kimi')
    expect(oauth.models.map((model: { id: string }) => model.id)).toEqual(['pi/old', 'pi/new'])
    expect(oauth.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    expect(oauth.defaultModel).toBe('pi/new')
    const created = stored.find((item: { slug: string }) => item.slug === 'kimi-code')
    expect(created.models.map((model: { id: string }) => model.id)).toEqual(['pi/old', 'pi/new'])
    expect(created.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    const copilot = stored.find((item: { slug: string }) => item.slug === 'github-copilot')
    expect(copilot.models).toEqual([])
    expect(copilot.defaultModel).toBe('')
    const directCopilot = stored.find((item: { slug: string }) => item.slug === 'direct-copilot')
    expect(directCopilot.models).toEqual([])
    expect(directCopilot.defaultModel).toBe('')
    expect(directCopilot.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    const api = stored.find((item: { slug: string }) => item.slug === 'api')
    expect(api.models).toEqual(['pi/old'])
    expect(api.modelSelectionMode).toBe('userDefined3Tier')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
