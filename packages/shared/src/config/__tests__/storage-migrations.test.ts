import { describe, expect, it } from 'bun:test'
import {
  inferModelSelectionMode,
  isPreviousFullCatalogSnapshot,
  shouldMigratePiOpenAiProvider,
  shouldRepairPiApiKeyCodexProvider,
  shouldRestoreOpenAiCodexCatalogSync,
} from '../storage'

describe('shouldMigratePiOpenAiProvider', () => {
  it('migrates legacy Pi OAuth OpenAI connections to openai-codex', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'oauth',
    })).toBe(true)
  })

  it('does not migrate Pi API key OpenAI connections', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'api_key',
    })).toBe(false)
  })

  it('does not migrate Pi custom endpoint connections', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'oauth',
      baseUrl: 'https://custom.gateway.example/v1',
    })).toBe(false)
  })

  it('does not migrate already-correct openai-codex connections', () => {
    expect(shouldMigratePiOpenAiProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'oauth',
    })).toBe(false)
  })
})

describe('shouldRepairPiApiKeyCodexProvider', () => {
  it('repairs Pi API key connections that were incorrectly set to openai-codex', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'api_key',
    })).toBe(true)
  })

  it('repairs Pi API key with endpoint connections that were incorrectly set to openai-codex', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'api_key_with_endpoint',
    })).toBe(true)
  })

  it('does not repair OAuth openai-codex connections', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai-codex',
      authType: 'oauth',
    })).toBe(false)
  })

  it('does not repair non-OpenAI-Codex providers', () => {
    expect(shouldRepairPiApiKeyCodexProvider({
      providerType: 'pi',
      piAuthProvider: 'openai',
      authType: 'api_key',
    })).toBe(false)
  })
})

describe('inferModelSelectionMode', () => {
  it('infers automaticallySyncedFromProvider when model list equals provider defaults', () => {
    const providerDefaults = ['pi/zai-best', 'pi/zai-balanced', 'pi/zai-fast']
    const mode = inferModelSelectionMode({ models: [...providerDefaults] }, providerDefaults)
    expect(mode).toBe('automaticallySyncedFromProvider')
  })

  it('infers userDefined3Tier when model list is a custom subset', () => {
    const providerDefaults = ['pi/zai-best', 'pi/zai-balanced', 'pi/zai-fast', 'pi/zai-extra']
    const mode = inferModelSelectionMode({ models: ['pi/zai-best', 'pi/zai-fast', 'pi/zai-extra'] }, providerDefaults)
    expect(mode).toBe('userDefined3Tier')
  })

  it('infers automaticallySyncedFromProvider for empty model lists', () => {
    const providerDefaults = ['pi/zai-best', 'pi/zai-balanced', 'pi/zai-fast']
    const mode = inferModelSelectionMode({ models: [] }, providerDefaults)
    expect(mode).toBe('automaticallySyncedFromProvider')
  })

  it('keeps a previous full-catalog snapshot automatic when only a few ids were added', () => {
    const providerDefaults = [
      'pi/gpt-6.1-sol',
      'pi/gpt-6-sol',
      'pi/gpt-6-luna',
      'pi/gpt-6-astra',
      'pi/gpt-5.6-sol',
      'pi/gpt-5.6-terra',
      'pi/gpt-5.6-luna',
      'pi/gpt-5.5',
      'pi/gpt-5.3-codex-spark',
    ]
    const staleSnapshot = providerDefaults.filter(id => id !== 'pi/gpt-6.1-sol')
    expect(isPreviousFullCatalogSnapshot(staleSnapshot, providerDefaults)).toBe(true)
    expect(inferModelSelectionMode({ models: staleSnapshot }, providerDefaults))
      .toBe('automaticallySyncedFromProvider')
  })

  it('treats an unprefixed full catalog as automatic', () => {
    const providerDefaults = ['pi/gpt-6.1-sol', 'pi/gpt-6-sol', 'pi/gpt-5.5', 'pi/gpt-5.6-sol']
    const unprefixed = providerDefaults.map(id => id.slice('pi/'.length))
    expect(inferModelSelectionMode({ models: unprefixed }, providerDefaults))
      .toBe('automaticallySyncedFromProvider')
  })

  it('keeps a long list with an unknown id as user-defined', () => {
    const providerDefaults = ['pi/a', 'pi/b', 'pi/c', 'pi/d', 'pi/e']
    const mode = inferModelSelectionMode({
      models: ['pi/a', 'pi/b', 'pi/c', 'pi/d', 'pi/not-a-catalog-model'],
    }, providerDefaults)
    expect(mode).toBe('userDefined3Tier')
    expect(isPreviousFullCatalogSnapshot(
      ['pi/a', 'pi/b', 'pi/c', 'pi/d', 'pi/not-a-catalog-model'],
      providerDefaults,
    )).toBe(false)
  })

  it('does not treat a small subset of a large catalog as a stale full sync', () => {
    const providerDefaults = ['pi/a', 'pi/b', 'pi/c', 'pi/d', 'pi/e', 'pi/f', 'pi/g']
    const custom = ['pi/a', 'pi/c', 'pi/e', 'pi/g']
    expect(isPreviousFullCatalogSnapshot(custom, providerDefaults)).toBe(false)
    expect(inferModelSelectionMode({ models: custom }, providerDefaults)).toBe('userDefined3Tier')
  })

  it('treats a long list missing at most two catalog ids as a stale full sync', () => {
    const providerDefaults = ['pi/a', 'pi/b', 'pi/c', 'pi/d', 'pi/e', 'pi/f']
    const missingTwo = ['pi/a', 'pi/b', 'pi/c', 'pi/d']
    expect(isPreviousFullCatalogSnapshot(missingTwo, providerDefaults)).toBe(true)
    expect(inferModelSelectionMode({ models: missingTwo }, providerDefaults))
      .toBe('automaticallySyncedFromProvider')
  })
})

describe('shouldRestoreOpenAiCodexCatalogSync', () => {
  const catalog = [
    'pi/gpt-6.1-sol',
    'pi/gpt-6-sol',
    'pi/gpt-6-luna',
    'pi/gpt-6-astra',
    'pi/gpt-5.6-sol',
    'pi/gpt-5.6-terra',
    'pi/gpt-5.6-luna',
    'pi/gpt-5.5',
    'pi/gpt-5.3-codex-spark',
  ]

  it('restores a Codex connection whose user-defined list is a stale full catalog', () => {
    expect(shouldRestoreOpenAiCodexCatalogSync({
      piAuthProvider: 'openai-codex',
      modelSelectionMode: 'userDefined3Tier',
      models: catalog.filter(id => id !== 'pi/gpt-6.1-sol'),
    }, catalog)).toBe(true)
  })

  it('leaves a genuine three-tier Codex list alone', () => {
    expect(shouldRestoreOpenAiCodexCatalogSync({
      piAuthProvider: 'openai-codex',
      modelSelectionMode: 'userDefined3Tier',
      models: ['pi/gpt-5.5', 'pi/gpt-5.6-sol', 'pi/gpt-5.6-luna'],
    }, catalog)).toBe(false)
  })

  it('does not restore other providers or automatic connections', () => {
    const stale = catalog.filter(id => id !== 'pi/gpt-6.1-sol')
    expect(shouldRestoreOpenAiCodexCatalogSync({
      piAuthProvider: 'openai',
      modelSelectionMode: 'userDefined3Tier',
      models: stale,
    }, catalog)).toBe(false)
    expect(shouldRestoreOpenAiCodexCatalogSync({
      piAuthProvider: 'openai-codex',
      modelSelectionMode: 'automaticallySyncedFromProvider',
      models: stale,
    }, catalog)).toBe(false)
  })
})
