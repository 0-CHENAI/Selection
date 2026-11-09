import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { SecureStorageBackend } from '../backends/secure-storage.ts'
import type { CredentialId, StoredCredential } from '../types.ts'

function llmKey(slug: string): CredentialId {
  return { type: 'llm_api_key', connectionSlug: slug }
}

function stored(value: string): StoredCredential {
  return { value }
}

function isolatedBackend(): { backend: SecureStorageBackend; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'selection-cred-'))
  const filePath = join(dir, 'credentials.enc')
  return { backend: new SecureStorageBackend(filePath), filePath }
}

describe('SecureStorageBackend LLM key persistence', () => {
  it('keeps the first connection key after a second key is written', async () => {
    const { backend } = isolatedBackend()
    await backend.set(llmKey('conn-a'), stored('key-a'))
    await backend.set(llmKey('conn-b'), stored('key-b'))

    expect((await backend.get(llmKey('conn-a')))?.value).toBe('key-a')
    expect((await backend.get(llmKey('conn-b')))?.value).toBe('key-b')
  })

  it('merges concurrent writes instead of last-write-wins on a stale snapshot', async () => {
    const { backend } = isolatedBackend()
    await backend.set(llmKey('conn-a'), stored('key-a'))

    await Promise.all([
      backend.set(llmKey('conn-b'), stored('key-b')),
      backend.set(llmKey('conn-c'), stored('key-c')),
    ])

    expect((await backend.get(llmKey('conn-a')))?.value).toBe('key-a')
    expect((await backend.get(llmKey('conn-b')))?.value).toBe('key-b')
    expect((await backend.get(llmKey('conn-c')))?.value).toBe('key-c')
  })

  it('reloads from disk after cache clear so a later write does not drop earlier keys', async () => {
    const { backend } = isolatedBackend()
    await backend.set(llmKey('conn-a'), stored('key-a'))
    backend.clearCache()
    await backend.set(llmKey('conn-b'), stored('key-b'))

    expect((await backend.get(llmKey('conn-a')))?.value).toBe('key-a')
  })

  it('deletes one key without removing siblings', async () => {
    const { backend } = isolatedBackend()
    await backend.set(llmKey('conn-a'), stored('key-a'))
    await backend.set(llmKey('__test-1'), stored('temp'))
    await backend.delete(llmKey('__test-1'))

    expect((await backend.get(llmKey('conn-a')))?.value).toBe('key-a')
    expect(await backend.get(llmKey('__test-1'))).toBeNull()
  })

  it('refuses to replace an unreadable existing file with a single-key store', async () => {
    const { backend, filePath } = isolatedBackend()
    await backend.set(llmKey('conn-a'), stored('key-a'))
    writeFileSync(filePath, Buffer.alloc(10))
    backend.clearCache()

    await expect(backend.set(llmKey('conn-b'), stored('key-b'))).rejects.toThrow(/refusing to overwrite/)
  })
})
