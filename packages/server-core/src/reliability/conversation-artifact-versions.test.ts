import { test, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localArtifactLinks } from '@craft-agent/shared/utils'
import { messageToStored, storedToMessage } from '@craft-agent/core'
import { ArtifactVersions } from './artifact-versions'
import { ConversationArtifactVersions } from './conversation-artifact-versions'

test('conversation edits retain old bytes, publish stable version identities and deduplicate unchanged content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-versions-'))
  try {
    const file = join(root, '中文 报告.html')
    writeFileSync(file, 'original')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const failures: string[] = []
    const turn = new ConversationArtifactVersions(store, [root], async path => path, () => failures.push('failed'))
    const link = '[报告](<中文 报告.html>)'
    await turn.track(link)
    const first = store.findByPath(file)!
    writeFileSync(file, 'revised') // OfficeCLI/Shell can modify the file without a native Write event.
    const refs = await turn.capture(link, 'session/user-2', '调整报告配色\n保留布局')
    expect(refs).toEqual([{ path: '中文 报告.html', versionId: store.read(first.id).currentVersion, ordinal: 2 }])
    const second = store.read(first.id)
    expect(second.versions[1]).toMatchObject({ sourceRunId: 'session/user-2', summary: '调整报告配色' })
    expect(store.versionBytes(first.id, first.currentVersion).toString()).toBe('original')
    expect(store.versionBytes(first.id, refs[0]!.versionId).toString()).toBe('revised')
    expect(readFileSync(file, 'utf8')).toBe('revised')
    expect(await turn.capture(link, 'session/user-2', '重试')).toEqual(refs)
    expect(store.read(first.id).versions).toHaveLength(2)
    const message = { id: 'answer', role: 'assistant' as const, content: link, timestamp: 1, artifactVersions: refs }
    expect(storedToMessage(JSON.parse(JSON.stringify(messageToStored(message))))).toEqual(message)
    expect(failures).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('new linked files start at v1; denied files and remote citations never become version records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-new-version-'))
  try {
    const file = join(root, 'report.txt'); writeFileSync(file, 'new')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const turn = new ConversationArtifactVersions(store, [root], async path => { if (realpathSync(path) !== realpathSync(file)) throw new Error('denied'); return realpathSync(path) }, () => {})
    const refs = await turn.capture('[文件](report.txt) [网页](https://example.com/report.txt) [无权限](secret.txt)', 'session/user-1', '生成报告')
    expect(refs).toHaveLength(1)
    const record = store.findByPath(file)!
    expect(record.versions).toHaveLength(1)
    expect(record.versions[0]).toMatchObject({ summary: '生成报告', sourceRunId: 'session/user-1', ordinal: 1 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('repeated historical links establish one baseline per turn, while the next turn captures external edits', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-baseline-'))
  try {
    const file = join(root, 'report.txt'); writeFileSync(file, 'original')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const register = store.register.bind(store)
    let registrations = 0
    store.register = (...args) => { registrations++; return register(...args) }
    const turn = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {})
    await turn.track('[file](report.txt)')
    await turn.track('[same file](report.txt)')
    expect(registrations).toBe(1)
    writeFileSync(file, 'external edit')
    const next = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {})
    await next.track('[file](report.txt)')
    const record = store.findByPath(file)!
    expect(registrations).toBe(2)
    expect(record.versions).toHaveLength(2)
    expect(store.versionBytes(record.id, record.currentVersion).toString()).toBe('external edit')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('interleaved conversations publish only their own same-name and mixed-type file versions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-file-isolation-'))
  try {
    const a = join(root, 'session-a'), b = join(root, 'session-b')
    mkdirSync(a); mkdirSync(b)
    const htmlA = join(a, 'report.html'), htmlB = join(b, 'report.html'), textA = join(a, 'report.txt')
    for (const file of [htmlA, htmlB, textA]) writeFileSync(file, 'same initial content')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const failures: string[] = []
    const tracker = (base: string) => new ConversationArtifactVersions(store, [base], async path => realpathSync(path), () => failures.push('failed'))
    const turnA = tracker(a), turnB = tracker(b)
    const linksA = '[HTML](report.html) [Text](report.txt)', linksB = '[HTML](report.html)'
    await Promise.all([turnA.track(linksA), turnB.track(linksB)])
    const originalA = store.findByPath(htmlA)!, originalB = store.findByPath(htmlB)!, originalText = store.findByPath(textA)!
    writeFileSync(htmlA, 'session a revised html'); writeFileSync(htmlB, 'session b revised html')
    const [refsA, refsB] = await Promise.all([turnA.capture(linksA, 'a/user-2', 'edit a'), turnB.capture(linksB, 'b/user-2', 'edit b')])
    expect(refsA.map(ref => ref.path)).toEqual(['report.html', 'report.txt'])
    expect(refsB.map(ref => ref.path)).toEqual(['report.html'])
    expect(refsA[0]!.versionId).not.toBe(refsB[0]!.versionId)
    expect(refsA.map(ref => ref.ordinal)).toEqual([2, 1])
    expect(refsB[0]!.ordinal).toBe(2)
    expect(store.versionBytes(originalA.id, refsA[0]!.versionId).toString()).toBe('session a revised html')
    expect(store.versionBytes(originalB.id, refsB[0]!.versionId).toString()).toBe('session b revised html')
    expect(store.read(originalText.id)).toEqual(originalText)
    expect(() => store.versionBytes(originalA.id, refsB[0]!.versionId)).toThrow('not found')
    expect(failures).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Markdown links preserve exact file identity across encodings, references and Windows paths', () => {
  expect(localArtifactLinks('[报告][r]\n\n[r]: <file:///D:/中文%20目录/report.html>\n\n`[fake](secret.txt)`\n\n[远程](https://example.com/a.html)')).toEqual(['D:/中文 目录/report.html'])
  expect(localArtifactLinks('[a](a.txt) [b](a.txt)\n\n```image-preview\n{"src":"data/a.png"}\n```')).toEqual(['a.txt', 'data/a.png'])
})
