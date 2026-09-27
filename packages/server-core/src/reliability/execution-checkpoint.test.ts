import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executionTaskIdentity, claimExecutionCheckpoint, readExecutionCheckpoint, writeExecutionCheckpoint, recoveryBlocker, toolRecoveryClass, type ExecutionCheckpoint } from './execution-checkpoint'
const checkpoint: ExecutionCheckpoint = { version: 1, sessionId: 's', userMessageId: 'u', generation: 1, sdkSessionId: 'sdk', sdkStateHash: 'snapshot', transcriptTailId: 't', status: 'running', pendingTools: {}, completedTools: [], updatedAt: 1 }
const current = { sessionId: 's', generation: 1, userMessageId: 'u', sdkSessionId: 'sdk', sdkStateHash: 'snapshot', transcriptTailId: 't', cancelled: false, orchestrated: false, permissionMode: 'safe' }
test('only a matching safe checkpoint can resume', () => {
  expect(recoveryBlocker(checkpoint, current)).toBeUndefined()
  for (const permissionMode of ['ask', 'allow-all']) expect(recoveryBlocker(checkpoint, { ...current, permissionMode })).toBeUndefined()
  const taskIdentity = executionTaskIdentity({ taskSlug: 'task', taskRunId: 'run', taskNodeId: 'node' })
  expect(executionTaskIdentity({})).toBeUndefined()
  expect(recoveryBlocker({ ...checkpoint, taskIdentity }, { ...current, taskIdentity })).toBeUndefined()
  expect(recoveryBlocker({ ...checkpoint, taskIdentity }, { ...current, taskIdentity: { ...taskIdentity, taskRunId: 'new' } })).toBe('turn-changed')
  expect(recoveryBlocker({ ...checkpoint, compactionMessageId: 'compaction' }, { ...current, compactionMessageId: 'other' })).toBe('transcript-mismatch')
  for (const patch of [{ generation: 2 }, { generation: 0 }, { cancelled: true }, { orchestrated: true }, { userMessageId: 'new' }, { sdkSessionId: 'other' }, { sdkStateHash: 'changed' }, { sdkStateHash: undefined }, { transcriptTailId: 'other' }, { permissionMode: undefined }, { permissionMode: 'unknown' }]) expect(recoveryBlocker(checkpoint, { ...current, ...patch })).toBeDefined()
  for (const status of ['claimed', 'cancelled', 'completed', 'blocked'] as const) expect(recoveryBlocker({ ...checkpoint, status }, current)).toBeDefined()
  expect(recoveryBlocker({ ...checkpoint, pendingTools: { a: { name: 'bash', recovery: 'unknown' } } }, current)).toBe('unknown-tool-result')
  expect(toolRecoveryClass('mcp__external__read')).toBe('unknown')
  for (const name of ['Find', 'find', 'Ls', 'ls']) {
    expect(recoveryBlocker({ ...checkpoint, pendingTools: { call: { name, recovery: 'read-only' } } }, current)).toBeUndefined()
    expect(recoveryBlocker({ ...checkpoint, pendingTools: { call: { name, recovery: 'unknown' } } }, current)).toBe('unknown-tool-result')
  }
  expect(toolRecoveryClass('mcp__external__Find')).toBe('unknown')
})
test('checkpoint publication survives reload; unknown and damaged records never become fresh runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-'))
  try {
    expect(readExecutionCheckpoint(root).kind).toBe('missing')
    writeExecutionCheckpoint(root, checkpoint)
    expect(readExecutionCheckpoint(root)).toEqual({ kind: 'ok', checkpoint })
    writeFileSync(join(root, 'data', 'execution-checkpoint.json'), '{"version":2}')
    expect(readExecutionCheckpoint(root).kind).toBe('unsupported')
    writeFileSync(join(root, 'data', 'execution-checkpoint.json'), '{')
    expect(readExecutionCheckpoint(root).kind).toBe('corrupt')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('SDK fingerprint detects changed bytes even when the session ID is unchanged', async () => {
  const { mkdirSync } = await import('node:fs')
  const { sdkStateHash } = await import('./execution-checkpoint')
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-sdk-'))
  try {
    const dir = join(root, '.pi-sessions'); mkdirSync(dir)
    const file = join(dir, 'timestamp_sdk.jsonl'); writeFileSync(file, 'original branch')
    const first = sdkStateHash(root, 'sdk')
    writeFileSync(file, 'different branch')
    expect(sdkStateHash(root, 'sdk')).not.toBe(first)
    writeFileSync(join(dir, 'duplicate_sdk.jsonl'), 'other')
    expect(sdkStateHash(root, 'sdk')).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('recovery rechecks current tool policy instead of trusting saved classification', () => {
  for (const name of ['bash', 'mcp__external__read', 'read_file', 'READ']) {
    expect(recoveryBlocker({ ...checkpoint, pendingTools: { call: { name, recovery: 'read-only' } } }, current)).toBe('unknown-tool-result')
  }
  expect(recoveryBlocker({ ...checkpoint, pendingTools: { call: { name: 'read', recovery: 'read-only' } } }, current)).toBeUndefined()
  expect(recoveryBlocker({ ...checkpoint, pendingTools: { call: { name: 'read', recovery: 'unknown' } } }, current)).toBe('unknown-tool-result')
})


test('recovery claim rejects stale disk state and can only be published once', () => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-claim-'))
  try {
    expect(() => claimExecutionCheckpoint(root, checkpoint)).toThrow('changed')
    writeExecutionCheckpoint(root, checkpoint)
    expect(() => claimExecutionCheckpoint(root, { ...checkpoint, generation: 2 })).toThrow('changed')
    const claimed = claimExecutionCheckpoint(root, checkpoint)
    expect(claimed.status).toBe('claimed')
    expect(readExecutionCheckpoint(root)).toEqual({ kind: 'ok', checkpoint: claimed })
    expect(() => claimExecutionCheckpoint(root, checkpoint)).toThrow('changed')
    expect(checkpoint.status).toBe('running')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('competing processes cannot both claim the same execution checkpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-process-'))
  try {
    writeExecutionCheckpoint(root, checkpoint)
    const module = new URL('./execution-checkpoint.ts', import.meta.url).pathname
    const script = `import { claimExecutionCheckpoint } from ${JSON.stringify(module)};
      try { claimExecutionCheckpoint(${JSON.stringify(root)}, ${JSON.stringify(checkpoint)}); process.exit(0) }
      catch { process.exit(2) }`
    const children = [0, 1].map(() => Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' }))
    const codes = await Promise.all(children.map(child => child.exited))
    expect(codes.every(code => code === 0 || code === 2)).toBe(true)
    expect(codes.filter(code => code === 0).length).toBeLessThanOrEqual(1)
    // Contenders may both back off; a subsequent explicit attempt can then win.
    if (!codes.includes(0)) claimExecutionCheckpoint(root, checkpoint)
    const saved = readExecutionCheckpoint(root)
    expect(saved.kind === 'ok' && saved.checkpoint.status).toBe('claimed')
    expect(() => claimExecutionCheckpoint(root, checkpoint)).toThrow('changed')
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('late checkpoint publications cannot resurrect an execution or replace a newer epoch', () => {
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-fence-'))
  try {
    writeExecutionCheckpoint(root, checkpoint)
    claimExecutionCheckpoint(root, checkpoint)
    expect(() => writeExecutionCheckpoint(root, checkpoint)).toThrow('active state')
    const next = { ...checkpoint, generation: 2 }
    writeExecutionCheckpoint(root, next)
    expect(() => writeExecutionCheckpoint(root, { ...checkpoint, status: 'cancelled' })).toThrow('Stale')
    expect(() => writeExecutionCheckpoint(root, { ...next, userMessageId: 'other' })).toThrow('Stale')
    writeExecutionCheckpoint(root, { ...next, status: 'cancelled' })
    expect(() => writeExecutionCheckpoint(root, next)).toThrow('Cancelled')
    expect(() => writeExecutionCheckpoint(root, { ...next, status: 'claimed' })).toThrow('Cancelled')
    expect(() => writeExecutionCheckpoint(root, { ...next, status: 'completed' })).toThrow('Cancelled')
    const saved = readExecutionCheckpoint(root)
    expect(saved.kind === 'ok' && saved.checkpoint.status).toBe('cancelled')
    expect(saved.kind === 'ok' && saved.checkpoint.generation).toBe(2)
    writeFileSync(join(root, 'data', 'execution-checkpoint.json'), '{"version":2}')
    expect(() => writeExecutionCheckpoint(root, { ...next, generation: 3 })).toThrow('inspection')
    expect(readExecutionCheckpoint(root).kind).toBe('unsupported')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('SDK recovery accepts only chained complete results of pending calls appended to the original prefix', async () => {
  const { mkdirSync } = await import('node:fs')
  const { sdkStateSnapshot, recoverySdkSnapshot } = await import('./execution-checkpoint')
  const root = mkdtempSync(join(tmpdir(), 'checkpoint-sdk-extension-'))
  try {
    mkdirSync(join(root, '.pi-sessions'))
    const file = join(root, '.pi-sessions', 'timestamp_sdk.jsonl')
    const prefix = '{"type":"session","id":"sdk"}\n{"type":"message","id":"call","parentId":null,"message":{"role":"assistant"}}\n'
    writeFileSync(file, prefix)
    const initial = sdkStateSnapshot(root, 'sdk')!
    const c = { ...checkpoint, sdkStateHash: initial.hash, sdkStateSize: initial.size,
      sdkTurnAnchor: 'call',
      pendingTools: { read: { name: 'Read', recovery: 'read-only' as const } } }
    const result = { type: 'message', id: 'result', parentId: 'call', message: { role: 'toolResult', toolCallId: 'read' } }
    writeFileSync(file, prefix + JSON.stringify(result) + '\n')
    expect(recoverySdkSnapshot(root, c)?.hash).toBe(sdkStateSnapshot(root, 'sdk')?.hash)
    expect(recoverySdkSnapshot(root, { ...c, sdkTurnAnchor: 'missing' })).toBeUndefined()
    expect(recoverySdkSnapshot(root, { ...c, sdkStateSize: undefined })).toBeUndefined()
    for (const entry of [ { ...result, parentId: null }, { ...result, id: 'call' },
      { ...result, message: { role: 'assistant' } }, { ...result, message: { role: 'toolResult', toolCallId: 'unknown' } } ]) {
      writeFileSync(file, prefix + JSON.stringify(entry) + '\n')
      expect(recoverySdkSnapshot(root, c)).toBeUndefined()
    }
    writeFileSync(file, prefix + JSON.stringify(result))
    expect(recoverySdkSnapshot(root, c)).toBeUndefined()
    writeFileSync(file, prefix + JSON.stringify(result) + '\n' + JSON.stringify({ ...result, id: 'duplicate', parentId: 'result' }) + '\n')
    expect(recoverySdkSnapshot(root, c)).toBeUndefined()
    writeFileSync(file, prefix.replace('assistant', 'user') + JSON.stringify(result) + '\n')
    expect(recoverySdkSnapshot(root, c)).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('only exact runtime recovery tool rows may reconcile a saved transcript tail', async () => {
  const { recoveryTranscriptMatches } = await import('./execution-checkpoint')
  const { INTERRUPTED_READ_RESULT } = await import('../../../shared/src/agent/backend/pi/file-operation-receipts')
  const c = { ...checkpoint, answerRunId: 'run', transcriptTailId: 'u', pendingTools: { read: { name: 'Read', recovery: 'read-only' as const } } }
  const user = { id: 'u', role: 'user' as const, content: 'task', timestamp: 1 }
  const recovered = { id: 'result', role: 'tool' as const, content: '', timestamp: 2, toolUseId: 'read', toolName: 'Read',
    answerRunId: 'run', toolStatus: 'error' as const, isError: true, toolResult: INTERRUPTED_READ_RESULT }
  expect(recoveryTranscriptMatches('/unused', c, [user, recovered])).toBe(true)
  for (const patch of [{ role: 'assistant' as const }, { answerRunId: 'other' }, { toolResult: 'real output' },
    { content: 'new content' }, { toolUseId: 'unknown' }, { isError: false }]) {
    expect(recoveryTranscriptMatches('/unused', c, [user, { ...recovered, ...patch }])).toBe(false)
  }
  expect(recoveryTranscriptMatches('/unused', c, [user, recovered, { ...recovered, id: 'duplicate' }])).toBe(false)
  expect(recoveryTranscriptMatches('/unused', c, [recovered])).toBe(false)
})
