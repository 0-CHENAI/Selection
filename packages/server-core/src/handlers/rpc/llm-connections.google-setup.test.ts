import { expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

it('preserves live sync on auto-synced Google key edits, keeps manual selections, and refreshes on provider switch', () => {
  const root = mkdtempSync(join(tmpdir(), 'google-setup-key-edit-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'config.json'), JSON.stringify({ id: 'ws', name: 'ws', slug: 'ws', createdAt: 1, updatedAt: 1 }))
    const configPath = join(root, 'config.json')
    const connections = [
      {
        slug: 'google-auto',
        name: 'Google AI Studio',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'google',
        models: [
          {
            id: 'pi/gemini-3.5-pro',
            name: 'Gemini 3.5 Pro',
            shortName: '3.5 Pro',
            description: '',
            provider: 'pi',
            contextWindow: 1_048_576,
            imageSupport: 'off',
            supportsImages: false,
            thinkingSource: 'explicit',
            thinkingMode: 'unsupported',
          },
        ],
        defaultModel: 'pi/gemini-3.5-pro',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        createdAt: 1,
      },
      {
        slug: 'google-manual',
        name: 'Google Manual',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'google',
        models: [
          {
            id: 'pi/gemini-3.5-pro',
            name: 'Gemini 3.5 Pro',
            shortName: '3.5 Pro',
            description: '',
            provider: 'pi',
            contextWindow: 1_048_576,
          },
        ],
        defaultModel: 'pi/gemini-3.5-pro',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: 1,
      },
      {
        slug: 'google-offline-edit',
        name: 'Google Offline Edit',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'google',
        models: [
          {
            id: 'pi/gemini-4-neon',
            name: 'Gemini 4 Neon',
            shortName: '4 Neon',
            description: '',
            provider: 'pi',
            contextWindow: 1_048_576,
            imageSupport: 'off',
            supportsImages: false,
          },
        ],
        defaultModel: 'pi/gemini-4-neon',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        createdAt: 1,
      },
      {
        slug: 'switched-to-google',
        name: 'OpenAI',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openai',
        models: [
          {
            id: 'pi/gpt-5',
            name: 'GPT-5',
            shortName: 'GPT-5',
            description: '',
            provider: 'pi',
            contextWindow: 400_000,
          },
        ],
        defaultModel: 'pi/gpt-5',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: 1,
      },
    ]
    writeFileSync(configPath, JSON.stringify({
      workspaces: [{ id: 'ws', name: 'ws', rootPath: workspace, createdAt: 1 }],
      activeWorkspaceId: 'ws',
      activeSessionId: null,
      defaultLlmConnection: 'google-auto',
      llmConnections: connections,
    }))

    const handlerUrl = pathToFileURL(join(import.meta.dir, 'llm-connections.ts')).href
    const serviceUrl = pathToFileURL(join(import.meta.dir, '../../model-fetchers/index.ts')).href
    const registryUrl = pathToFileURL(join(import.meta.dir, '../../model-fetchers/registry.ts')).href
    const run = Bun.spawnSync([process.execPath, '--eval', `
      import { registerLlmConnectionsHandlers } from ${JSON.stringify(handlerUrl)};
      import { initModelRefreshService } from ${JSON.stringify(serviceUrl)};
      import { MODEL_FETCHERS } from ${JSON.stringify(registryUrl)};
      import { registerPiModelResolver } from '@craft-agent/shared/config';
      import { getCredentialManager } from '@craft-agent/shared/credentials';
      import { RPC_CHANNELS } from '@craft-agent/shared/protocol';

      registerPiModelResolver(provider => provider === 'google' ? [
        { id: 'pi/gemini-4-argon', name: 'Gemini 4 Argon', shortName: '4 Argon', description: '', provider: 'pi', contextWindow: 1048576 },
      ] : []);

      const fetchedWithKeys = {};
      MODEL_FETCHERS.pi = {
        refreshIntervalMs: 0,
        fetchModels: async (connection, credentials) => {
          fetchedWithKeys[connection.slug] = credentials.apiKey ?? null;
          if (connection.slug === 'google-offline-edit') {
            throw new Error('network timeout');
          }
          if (credentials.apiKey === 'AIza-new-key-with-neon') {
            return {
              models: [
                { id: 'pi/gemini-4-neon', name: 'Gemini 4 Neon', shortName: '4 Neon', description: '', provider: 'pi', contextWindow: 1048576 },
                { id: 'pi/gemini-3.5-pro', name: 'Gemini 3.5 Pro', shortName: '3.5 Pro', description: '', provider: 'pi', contextWindow: 1048576 },
              ],
            };
          }
          return {
            models: [
              { id: 'pi/gemini-4-argon', name: 'Gemini 4 Argon', shortName: '4 Argon', description: '', provider: 'pi', contextWindow: 1048576 },
            ],
          };
        },
      };

      const service = initModelRefreshService(async (slug) => ({
        apiKey: (await getCredentialManager().getLlmApiKey(slug)) ?? undefined,
      }));
      const handlers = new Map();
      registerLlmConnectionsHandlers({ handle: (name, fn) => handlers.set(name, fn) }, {
        sessionManager: { refreshConnectionRuntime: async () => {}, reinitializeAuth: async () => {} },
        platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
      });

      const setup = handlers.get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION);

      // 1. Auto-synced Google connection edited with a new API key (credential-only edit: no models/mode sent).
      const autoRes = await setup({}, {
        slug: 'google-auto',
        credential: 'AIza-new-key-with-neon',
        piAuthProvider: 'google',
        updateOnly: true,
      });
      if (!autoRes.success) throw new Error('google-auto setup failed: ' + autoRes.error);

      // 2. Manual (userDefined3Tier) Google connection edited with a new API key.
      const manualRes = await setup({}, {
        slug: 'google-manual',
        credential: 'AIza-new-key-with-neon',
        piAuthProvider: 'google',
        updateOnly: true,
      });
      if (!manualRes.success) throw new Error('google-manual setup failed: ' + manualRes.error);

      // 3. Auto-synced Google connection edited with a new key while discovery fails.
      const offlineRes = await setup({}, {
        slug: 'google-offline-edit',
        credential: 'AIza-offline-key',
        piAuthProvider: 'google',
        updateOnly: true,
      });
      if (!offlineRes.success) throw new Error('google-offline-edit setup failed: ' + offlineRes.error);

      // 4. Existing OpenAI connection switched to Google AI Studio.
      const switchRes = await setup({}, {
        slug: 'switched-to-google',
        credential: 'AIza-new-key-with-neon',
        piAuthProvider: 'google',
        updateOnly: true,
      });
      if (!switchRes.success) throw new Error('switched-to-google setup failed: ' + switchRes.error);

      require('node:fs').writeFileSync(${JSON.stringify(join(root, 'result.json'))}, JSON.stringify({ fetchedWithKeys }));
      service.stopAll();
    `], { env: { ...process.env, CRAFT_CONFIG_DIR: root }, stdout: 'pipe', stderr: 'pipe' })
    if (run.exitCode !== 0) throw new Error(`handler subprocess failed:\n${run.stderr.toString()}`)

    const { fetchedWithKeys } = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'))
    expect(fetchedWithKeys['google-auto']).toBe('AIza-new-key-with-neon')
    expect(fetchedWithKeys['google-manual']).toBeUndefined()
    expect(fetchedWithKeys['google-offline-edit']).toBe('AIza-offline-key')
    expect(fetchedWithKeys['switched-to-google']).toBe('AIza-new-key-with-neon')

    const stored = JSON.parse(readFileSync(configPath, 'utf8')).llmConnections

    const googleAuto = stored.find((item: { slug: string }) => item.slug === 'google-auto')
    expect(googleAuto.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    expect(googleAuto.models.map((m: { id: string }) => m.id)).toEqual(['pi/gemini-4-neon', 'pi/gemini-3.5-pro'])
    expect(googleAuto.defaultModel).toBe('pi/gemini-3.5-pro')
    expect(googleAuto.models[1]).toMatchObject({
      id: 'pi/gemini-3.5-pro',
      imageSupport: 'off',
      supportsImages: false,
      thinkingSource: 'explicit',
      thinkingMode: 'unsupported',
    })

    const googleManual = stored.find((item: { slug: string }) => item.slug === 'google-manual')
    expect(googleManual.modelSelectionMode).toBe('userDefined3Tier')
    expect(googleManual.models.map((m: { id: string }) => m.id)).toEqual(['pi/gemini-3.5-pro'])
    expect(googleManual.defaultModel).toBe('pi/gemini-3.5-pro')

    const googleOffline = stored.find((item: { slug: string }) => item.slug === 'google-offline-edit')
    expect(googleOffline.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    expect(googleOffline.defaultModel).toBe('pi/gemini-4-neon')
    expect(googleOffline.models).toEqual([
      expect.objectContaining({
        id: 'pi/gemini-4-neon',
        imageSupport: 'off',
        supportsImages: false,
      }),
    ])

    const switched = stored.find((item: { slug: string }) => item.slug === 'switched-to-google')
    expect(switched.piAuthProvider).toBe('google')
    expect(switched.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    expect(switched.models.map((m: { id: string }) => m.id)).toEqual(['pi/gemini-4-neon', 'pi/gemini-3.5-pro'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
