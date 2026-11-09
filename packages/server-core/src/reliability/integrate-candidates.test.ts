import { createHash } from 'node:crypto'
import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { integrateCandidates } from './integrate-candidates'
function fixture() { const root = mkdtempSync(join(tmpdir(), 'candidate-gate-')); const project = join(root, 'project'); mkdirSync(project); writeFileSync(join(project, 'a'), 'base'); return { root, project } }
test('validation failure and permissions revoked during validation leave the project untouched', async () => {
  const f = fixture()
  const options = { root: f.project, storage: join(f.root, 'store'), files: [{path:'a',base:Buffer.from('base'),candidate:Buffer.from('new')}], ensureAuthorized: () => {} }
  try {
    expect(await integrateCandidates({ ...options, validate: async () => ({ passed: false, checks: ['test failed'] }) })).toEqual({ status:'validation-failed',checks:['test failed'] })
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('base')
    let authorized = true
    await expect(integrateCandidates({ ...options, ensureAuthorized: () => { if (!authorized) throw new Error('cancelled') }, validate: async () => { authorized = false; return {passed:true,checks:[]} } })).rejects.toThrow('cancelled')
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('base')
  } finally { rmSync(f.root,{recursive:true,force:true}) }
})
test('external edits made while validation runs survive application', async () => {
  const f = fixture()
  try {
    await expect(integrateCandidates({root:f.project,storage:join(f.root,'store'),files:[{path:'a',base:Buffer.from('base'),candidate:Buffer.from('new')}],ensureAuthorized:()=>{},validate:async()=>{writeFileSync(join(f.project,'a'),'user');return {passed:true,checks:['valid']} }})).rejects.toThrow('changed outside')
    expect(readFileSync(join(f.project,'a'),'utf8')).toBe('user')
  } finally {rmSync(f.root,{recursive:true,force:true})}
})
test('a validator cannot mutate the bytes that will be integrated', async () => {
  const f = fixture()
  try {
    const result = await integrateCandidates({root:f.project,storage:join(f.root,'store'),files:[{path:'a',base:Buffer.from('base'),candidate:Buffer.from('new')}],ensureAuthorized:()=>{},validate:async files=>{files[0]!.content!.fill(0);return {passed:true,checks:['validated']} }})
    expect(result.status).toBe('integrated');expect(readFileSync(join(f.project,'a'),'utf8')).toBe('new')
  } finally {rmSync(f.root,{recursive:true,force:true})}
})
test('unchanged output cannot report validated after an external edit during validation', async () => {
  const f = fixture()
  try {
    await expect(integrateCandidates({root:f.project,storage:join(f.root,'store'),files:[{path:'a',base:Buffer.from('base'),candidate:Buffer.from('base')}],ensureAuthorized:()=>{},validate:async()=>{writeFileSync(join(f.project,'a'),'external');return {passed:true,checks:['validated']} }})).rejects.toThrow('changed outside')
    expect(readFileSync(join(f.project,'a'),'utf8')).toBe('external')
  } finally {rmSync(f.root,{recursive:true,force:true})}
})

test('receipts retain validated hashes after application and include unchanged files', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.project, 'unchanged'), 'kept')
    const result = await integrateCandidates({ root: f.project, storage: join(f.root, 'store'),
      files: [{ path: 'a', base: Buffer.from('base'), candidate: Buffer.from('new') },
        { path: 'unchanged', base: Buffer.from('kept'), candidate: Buffer.from('kept') }],
      ensureAuthorized: () => {}, validate: async () => ({ passed: true, checks: [] }) })
    if (result.status !== 'integrated') throw new Error('Expected integration')
    writeFileSync(join(f.project, 'a'), 'external')
    expect(result.hashes).toEqual({ a: createHash('sha256').update('new').digest('hex'),
      unchanged: createHash('sha256').update('kept').digest('hex') })
    expect(result.hashes.a).not.toBe(createHash('sha256').update(readFileSync(join(f.project, 'a'))).digest('hex'))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('failure to persist prepared delivery prevents every project replacement', async () => {
  const f = fixture()
  try {
    let prepared = false
    await expect(integrateCandidates({ root: f.project, storage: join(f.root, 'store'),
      files: [{ path: 'a', base: Buffer.from('base'), candidate: Buffer.from('new') }],
      ensureAuthorized: () => {}, validate: async () => ({ passed: true, checks: ['verified'] }),
      onPrepared: receipt => {
        prepared = true
        expect(receipt.hashes.a).toBe(createHash('sha256').update('new').digest('hex'))
        expect(receipt.checks).toEqual(['verified'])
        expect(receipt.transactionId).toBeTruthy()
        throw new Error('disk unavailable')
      },
    })).rejects.toThrow('disk unavailable')
    expect(prepared).toBe(true)
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('base')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('upstream input changes during validation prevent application but own updates remain allowed', async () => {
  const f = fixture()
  try {
    const input = join(f.project, 'input')
    writeFileSync(input, 'original')
    const options = {
      root: f.project, storage: join(f.root, 'store'),
      files: [{ path: 'a', base: Buffer.from('base'), candidate: Buffer.from('new') }],
      ensureAuthorized: () => {},
      verifyInputs: () => { if (readFileSync(input, 'utf8') !== 'original') throw new Error('Upstream input changed') },
    }
    await expect(integrateCandidates({ ...options, validate: async () => {
      writeFileSync(input, 'changed'); return { passed: true, checks: [] }
    } })).rejects.toThrow('Upstream input changed')
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('base')
    writeFileSync(input, 'original')
    const result = await integrateCandidates({ ...options,
      verifyInputs: () => { expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('base') },
      validate: async () => ({ passed: true, checks: [] }),
    })
    expect(result.status).toBe('integrated')
    expect(readFileSync(join(f.project, 'a'), 'utf8')).toBe('new')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
