import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveArtifact, type TaskNode } from '@craft-agent/shared/tasks'
import { invalidArtifactInput, captureArtifactInputs, invalidFrozenArtifactInput } from './artifact-input-validation'

test('changed upstream files block consumers while unrelated and optional inputs remain valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-input-'))
  try {
    writeFileSync(join(root, 'result.txt'), 'original')
    const receipt = resolveArtifact(root, undefined, 'result.txt')
    if (!receipt.ok) throw new Error(receipt.error)
    const nodes = [{ id: 'source', kind: 'session', outputs: [{ name: 'file', kind: 'artifact' }] }] as TaskNode[]
    const outputs = { source: { text: '', params: { file: receipt.artifact } } }
    expect(invalidArtifactInput(root, new Set(['source']), nodes, outputs)).toBeUndefined()
    writeFileSync(join(root, 'result.txt'), 'externally changed')
    expect(invalidArtifactInput(root, new Set(['source']), nodes, outputs)).toContain('source.file')
    expect(invalidArtifactInput(root, new Set(['other']), nodes, outputs)).toBeUndefined()
    nodes[0]!.outputs![0]!.required = false
    expect(invalidArtifactInput(root, new Set(['source']), nodes, { source: { text: '' } })).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('verified downstream versions supersede earlier receipts but parallel producers cannot', () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-input-version-'))
  try {
    const file = join(root, 'result.txt')
    writeFileSync(file, 'old')
    const old = resolveArtifact(root, undefined, 'result.txt')
    writeFileSync(file, 'new')
    const latest = resolveArtifact(root, undefined, 'result.txt')
    if (!old.ok || !latest.ok) throw new Error('missing fixture')
    const nodes = ['a', 'b'].map(id => ({ id, kind: 'session', outputs: [{ name: 'file', kind: 'artifact' }] })) as TaskNode[]
    const outputs = {
      a: { text: '', params: { file: old.artifact } },
      b: { text: '', params: { file: latest.artifact } },
    }
    const dependencies = new Set(['a', 'b'])
    expect(invalidArtifactInput(root, dependencies, nodes, outputs, new Map([['b', new Set(['a'])]]))).toBeUndefined()
    const frozen = captureArtifactInputs(dependencies, nodes, outputs, root, new Map([['b', new Set(['a'])]]))
    expect(invalidFrozenArtifactInput(root, frozen)).toBeUndefined()
    expect(Object.keys(frozen)).toEqual(['b'])
    expect(invalidArtifactInput(root, dependencies, [...nodes].reverse(), outputs)).toContain('a.file')
    writeFileSync(file, 'external edit')
    expect(invalidArtifactInput(root, dependencies, nodes, outputs, new Map([['b', new Set(['a'])]]))).toContain('b.file')
    nodes.length = 0
    expect(invalidFrozenArtifactInput(root, frozen)).toContain('b.file')
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('input snapshots retain receipt identity without prose or mutable output references', () => {
  const nodes = [{ id: 'a', outputs: [{ name: 'file', kind: 'artifact' }] }] as TaskNode[]
  const receipt = { path: 'file.txt', hash: 'hash', size: 3, secret: 'private' }
  const outputs = { a: { text: 'private answer', params: { file: receipt, unrelated: 'private' } } }
  const snapshot = captureArtifactInputs(new Set(['a']), nodes, outputs)
  receipt.hash = 'changed'
  expect(snapshot).toEqual({ a: { text: '', params: { file: { path: 'file.txt', hash: 'hash', size: 3 } } } })
})

test('map aggregate inputs validate every declared artifact in instance items', () => {
  const root = mkdtempSync(join(tmpdir(), 'map-inputs-'))
  try {
    writeFileSync(join(root, 'one.txt'), 'one'); writeFileSync(join(root, 'two.txt'), 'two')
    const one = resolveArtifact(root, undefined, 'one.txt'), two = resolveArtifact(root, undefined, 'two.txt')
    if (!one.ok || !two.ok) throw new Error('fixture')
    const nodes = [{ id: 'map', kind: 'map', outputs: [{ name: 'file', kind: 'artifact' }] }] as TaskNode[]
    const outputs = { map: { text: 'summary', params: { items: [{ file: one.artifact }, { file: two.artifact }] } } }
    const frozen = captureArtifactInputs(new Set(['map']), nodes, outputs, root)
    expect(invalidFrozenArtifactInput(root, frozen)).toBeUndefined()
    expect(Object.keys(frozen.map!.params!)).toEqual(['file[0]', 'file[1]'])
    writeFileSync(join(root, 'two.txt'), 'changed')
    expect(invalidFrozenArtifactInput(root, frozen)).toContain('file[1]')
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('missing required producer output remains an invalid frozen receipt', () => {
  const nodes = [{ id: 'source', kind: 'session', outputs: [{ name: 'file', kind: 'artifact' }] }] as TaskNode[]
  expect(invalidArtifactInput('.', new Set(['source']), nodes, {})).toContain('source.file')
  const frozen = captureArtifactInputs(new Set(['source']), nodes, {})
  expect(frozen.source?.params?.file).toBeNull()
  expect(invalidFrozenArtifactInput('.', frozen)).toContain('source.file')
})

test('damaged persisted snapshots fail validation instead of skipping receipts or throwing', () => {
  for (const snapshot of [null, [], 'bad', { source: null }, { source: { text: '' } },
    { source: { text: '', params: [] } }, { source: { text: '', params: {} } }]) {
    expect(invalidFrozenArtifactInput('.', snapshot as never)).toContain('Invalid artifact input snapshot')
  }
  expect(invalidFrozenArtifactInput('.', {})).toBeUndefined()
})

test('discovered runtime receipts are frozen dependency inputs even without model declarations', () => {
  const root = mkdtempSync(join(tmpdir(), 'discovered-input-'))
  try {
    writeFileSync(join(root, 'a.txt'), 'base')
    const result = resolveArtifact(root, undefined, 'a.txt')
    if (!result.ok) throw new Error('fixture')
    const nodes = [{ id: 'a', kind: 'session' }] as TaskNode[]
    const outputs = { a: { text: 'answer', integratedArtifacts: { file: result.artifact } } }
    const snapshot = captureArtifactInputs(new Set(['a']), nodes, outputs, root)
    expect(snapshot.a?.params?.file).toEqual({ path: result.artifact.path, hash: result.artifact.hash, size: result.artifact.size })
    writeFileSync(join(root, 'a.txt'), 'external')
    expect(invalidFrozenArtifactInput(root, snapshot)).toContain('a.file')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
