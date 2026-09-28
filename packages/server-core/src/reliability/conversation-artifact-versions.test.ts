import { test, expect } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localArtifactLinks, localArtifactPath } from '@craft-agent/shared/utils'
import { messageToStored, storedToMessage, type Message } from '@craft-agent/core'
import { ArtifactVersions } from './artifact-versions'
import { artifactVersionTitle, ConversationArtifactVersions, withDeliveredArtifactReferences, withHistoricalAnswerTitles } from './conversation-artifact-versions'

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
    const answer = `已调整报告配色并保留布局。\n\n${link}`
    const refs = await turn.capture(answer, 'session/user-2')
    expect(refs).toEqual([{ path: '中文 报告.html', versionId: store.read(first.id).currentVersion, ordinal: 2, change: 'modified' }])
    const second = store.read(first.id)
    expect(second.versions[1]).toMatchObject({ sourceRunId: 'session/user-2', summary: '已调整报告配色并保留布局。', summaryOrigin: 'assistant' })
    expect(store.versionBytes(first.id, first.currentVersion).toString()).toBe('original')
    expect(store.versionBytes(first.id, refs[0]!.versionId).toString()).toBe('revised')
    expect(readFileSync(file, 'utf8')).toBe('revised')
    expect(await turn.capture(answer, 'session/user-2')).toEqual(refs)
    expect(store.read(first.id).versions).toHaveLength(2)
    const message = { id: 'answer', role: 'assistant' as const, content: link, timestamp: 1, artifactVersions: refs }
    expect(storedToMessage(JSON.parse(JSON.stringify(messageToStored(message))))).toEqual(message)
    expect(failures).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('new linked files start at v1; denied files and remote citations never become version records', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-new-version-'))
  try {
    const file = join(root, 'report.txt')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const turn = new ConversationArtifactVersions(store, [root], async path => { if (realpathSync(path) !== realpathSync(file)) throw new Error('denied'); return realpathSync(path) }, () => {})
    writeFileSync(file, 'new')
    const refs = await turn.capture('已生成模型对比报告。\n\n[文件](report.txt) [网页](https://example.com/report.txt) [无权限](secret.txt)', 'session/user-1')
    expect(refs).toEqual([expect.objectContaining({ path: 'report.txt', ordinal: 1, change: 'created' })])
    const record = store.findByPath(file)!
    expect(record.versions).toHaveLength(1)
    expect(record.versions[0]).toMatchObject({ summary: '已生成模型对比报告。', summaryOrigin: 'assistant', sourceRunId: 'session/user-1', ordinal: 1 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a file created at the turn boundary survives small filesystem timestamp skew', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-clock-skew-'))
  try {
    const file = join(root, 'report.txt')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    writeFileSync(file, 'new')
    // Use the filesystem's reported timestamp so this checks the 1 ms boundary
    // even when the Windows runner clock and file metadata have different precision.
    const turn = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {}, statSync(file).birthtimeMs + 1)
    expect((await turn.capture('[报告](report.txt)', 'session/user-1')).map(ref => ref.change)).toEqual(['created'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('only changed or new files receive answer artifact references', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-delivered-only-'))
  try {
    const original = join(root, 'original.docx')
    const changed = join(root, 'changed.docx')
    const created = join(root, 'created.docx')
    const untrackedOld = join(root, 'reference.docx')
    for (const file of [original, changed, untrackedOld]) writeFileSync(file, 'before')
    await Bun.sleep(5)
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const turn = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {})
    await turn.track('[原文](original.docx) [待修改](changed.docx)')
    writeFileSync(changed, 'after')
    writeFileSync(created, 'new')
    const refs = await turn.capture('[新报告](created.docx) [原文](original.docx) [改稿](changed.docx) [参考](reference.docx)', 'session/user-2')
    expect(refs.map(ref => ref.path)).toEqual(['changed.docx', 'created.docx'])
    expect(refs.map(ref => ref.change)).toEqual(['modified', 'created'])
    expect(store.findByPath(original)!.versions).toHaveLength(1)
    expect(store.findByPath(untrackedOld)).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('historical answers hide unchanged file references without rewriting stored messages', () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-historical-deliveries-'))
  try {
    const oldPath = join(root, 'original.docx')
    const newPath = join(root, 'revised.docx')
    writeFileSync(oldPath, 'old'); writeFileSync(newPath, 'new')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const oldVersion = store.register(oldPath, 'session/user-1').versions[0]!
    const newVersion = store.register(newPath, 'session/user-2').versions[0]!
    const messages: Message[] = [
      { id: 'user-2', role: 'user', content: 'revise', timestamp: 1 },
      { id: 'answer-2', role: 'assistant', content: '[新版](revised.docx) [原版](original.docx)', timestamp: 2,
        artifactVersions: [
          { path: 'revised.docx', versionId: newVersion.id, ordinal: 1 },
          { path: 'original.docx', versionId: oldVersion.id, ordinal: 1 },
        ] },
    ]
    const shown = withDeliveredArtifactReferences(messages, store.versionSourceRunIds([oldVersion.id, newVersion.id]))
    expect(shown[1]!.artifactVersions?.map(ref => ref.path)).toEqual(['revised.docx'])
    expect(messages[1]!.artifactVersions).toHaveLength(2)
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
    const [refsA, refsB] = await Promise.all([turnA.capture(linksA, 'a/user-2'), turnB.capture(linksB, 'b/user-2')])
    expect(refsA.map(ref => ref.path)).toEqual(['report.html'])
    expect(refsB.map(ref => ref.path)).toEqual(['report.html'])
    expect(refsA[0]!.versionId).not.toBe(refsB[0]!.versionId)
    expect(refsA.map(ref => ref.ordinal)).toEqual([2])
    expect(refsB[0]!.ordinal).toBe(2)
    expect(store.versionBytes(originalA.id, refsA[0]!.versionId).toString()).toBe('session a revised html')
    expect(store.versionBytes(originalB.id, refsB[0]!.versionId).toString()).toBe('session b revised html')
    expect(store.read(originalText.id)).toEqual(originalText)
    expect(() => store.versionBytes(originalA.id, refsB[0]!.versionId)).toThrow('not found')
    expect(failures).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('version titles come from delivered prose and skip headings, file-only lines and code', () => {
  expect(artifactVersionTitle('## 交付结果\n\n[报告](report.docx)\n\n已修复目录分页和表格布局。\n\n```\nignored\n```'))
    .toBe('已修复目录分页和表格布局。')
  expect(artifactVersionTitle('[报告](report.docx)')).toBeUndefined()
  expect(artifactVersionTitle('已完成报告调整。另有说明。')).toBe('已完成报告调整。')
})

test('an explicit AI change title wins over the answer opening and old prompts are replaced only for display', async () => {
  const root = mkdtempSync(join(tmpdir(), 'artifact-ai-title-'))
  try {
    const file = join(root, 'report.docx')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const tracker = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {})
    writeFileSync(file, 'first')
    await tracker.capture('已交付报告。\n\n[报告](report.docx)', 'session/user-1', '修复目录分页并统一表格格式')
    const record = store.findByPath(file)!
    expect(record.versions[0]).toMatchObject({ summary: '修复目录分页并统一表格格式', summaryOrigin: 'assistant' })
    const legacy = { ...record, versions: [{ ...record.versions[0]!, summary: '请帮我修改报告', summaryOrigin: undefined }] }
    const shown = withHistoricalAnswerTitles(legacy, () => '已修复目录分页和表格布局。\n\n[报告](report.docx)')
    expect(shown.versions[0]).toMatchObject({ summary: '已修复目录分页和表格布局。', summaryOrigin: 'assistant' })
    expect(legacy.versions[0]!.summary).toBe('请帮我修改报告')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a helper script in the session data folder is not a result file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-scratch-'))
  try {
    const scratch = join(root, 'sessions', '260928-young-geyser', 'data')
    mkdirSync(scratch, { recursive: true })
    const script = join(scratch, 'build_content.py')
    const report = join(root, '领导版.docx')
    writeFileSync(script, 'print("build")')
    writeFileSync(report, 'report')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const turn = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {}, Date.now() - 60_000)
    const refs = await turn.capture('已交付。\n\n[领导版](领导版.docx) [脚本](sessions/260928-young-geyser/data/build_content.py)', 'session/user-1')
    expect(refs.map(ref => ref.path)).toEqual(['领导版.docx'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('citing or opening an unchanged file does not publish a deliverable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-cite-only-'))
  try {
    const file = join(root, 'report.docx')
    writeFileSync(file, 'already published')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const first = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {})
    await first.capture('已交付领导版报告。\n\n[报告](report.docx)', 'session/user-1')
    await Bun.sleep(20)
    const cited = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {}, Date.now())
    await cited.track('[报告](report.docx)')
    expect(await cited.capture('要我把这一节并进[上一份领导版报告](report.docx)，说一声就行。', 'session/user-2')).toEqual([])
    expect(store.findByPath(file)!.versions).toHaveLength(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an older untracked file that is only linked is not registered', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-old-citation-'))
  try {
    const file = join(root, 'report.docx')
    writeFileSync(file, 'old')
    await Bun.sleep(20)
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const turn = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {}, Date.now())
    expect(await turn.capture('[旧稿](report.docx)', 'session/user-2')).toEqual([])
    expect(store.findByPath(file)).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('deleting a tracked file publishes a restorable deletion, and restoring publishes that recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-delete-restore-'))
  try {
    const file = join(root, 'report.docx')
    writeFileSync(file, 'original')
    const store = new ArtifactVersions(join(root, 'versions'), 'host', 'workspace')
    const created = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {}, Date.now() - 60_000)
    await created.capture('已交付。\n\n[报告](report.docx)', 'session/user-1')
    const record = store.findByPath(file)!
    const removed = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {})
    await removed.track('[报告](report.docx)')
    unlinkSync(file)
    const deleted = await removed.capture('旧稿已删除。', 'session/user-2')
    expect(deleted).toEqual([{ path: record.path, versionId: record.versions[0]!.id, ordinal: 1, change: 'deleted' }])
    writeFileSync(file, 'original')
    const restoredTurn = new ConversationArtifactVersions(store, [root], async path => realpathSync(path), () => {})
    await restoredTurn.track('[报告](report.docx)')
    const current = store.findByPath(file)!
    store.restore(current.id, current.currentVersion, record.versions[0]!.id, 'session/user-3')
    const restored = await restoredTurn.capture('已恢复上一版。', 'session/user-3')
    expect(restored.map(ref => ref.change)).toEqual(['restored'])
    expect(store.findByPath(file)!.versions.at(-1)?.restoredFrom).toBe(record.versions[0]!.id)
    const shown = withDeliveredArtifactReferences([
      { id: 'user-2', role: 'user', content: 'delete', timestamp: 1 },
      { id: 'answer-2', role: 'assistant', content: '旧稿已删除。', timestamp: 2, artifactVersions: deleted },
    ], store.versionSourceRunIds(deleted.map(ref => ref.versionId)))
    expect(shown[1]!.artifactVersions).toEqual(deleted)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Markdown links preserve exact file identity across encodings, references and Windows paths', () => {
  expect(localArtifactLinks('[报告][r]\n\n[r]: <file:///D:/中文%20目录/report.html>\n\n`[fake](secret.txt)`\n\n[远程](https://example.com/a.html)')).toEqual(['D:/中文 目录/report.html'])
  expect(localArtifactLinks(String.raw`[报告](file:///C:\Users\me\Desktop\report.docx)`)).toEqual(['C:/Users/me/Desktop/report.docx'])
  expect(localArtifactLinks('[a](a.txt) [b](a.txt)\n\n```image-preview\n{"src":"data/a.png"}\n```')).toEqual(['a.txt', 'data/a.png'])
})

test('explicit result paths normalize Windows drives, backslashes and file URLs', () => {
  expect(localArtifactPath('C:\\Users\\me\\报告.html')).toBe('C:\\Users\\me\\报告.html')
  expect(localArtifactPath('file:///C:\\Users\\me\\报告%20终版.html')).toBe('C:/Users/me/报告 终版.html')
  expect(localArtifactPath('file://D:/selection/报告.html')).toBe('D:/selection/报告.html')
  expect(localArtifactPath('file:///C:/Users/me/%E4%B8%AD%E6%96%87%20%E6%8A%A5%E5%91%8A%20(1).docx'))
    .toBe('C:/Users/me/中文 报告 (1).docx')
  expect(localArtifactPath('\\\\server\\share\\报告.html')).toBe('\\\\server\\share\\报告.html')
  expect(localArtifactPath('https://example.com/report.html')).toBeUndefined()
})

test('featured results resolve only existing authorized files and deduplicate them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-featured-'))
  try {
    const file = join(root, 'report.html')
    writeFileSync(file, '<h1>Report</h1>')
    const turn = new ConversationArtifactVersions(new ArtifactVersions(join(root, 'versions'), 'host', 'workspace'),
      [root], async path => realpathSync(path), () => {})
    expect(await turn.featured(['report.html', file])).toEqual([realpathSync(file)])
    await expect(turn.featured(['missing.html'])).rejects.toThrow('missing or unavailable')
    await expect(turn.featured(['https://example.com/report.html'])).rejects.toThrow('not a local path')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a selected Chinese result is versioned even without a Markdown file link', async () => {
  const root = mkdtempSync(join(tmpdir(), 'conversation-featured-version-'))
  try {
    const file = join(root, '中文 报告 (1).html')
    const turn = new ConversationArtifactVersions(new ArtifactVersions(join(root, 'versions'), 'host', 'workspace'),
      [root], async path => realpathSync(path), () => {}, Date.now() - 1000)
    writeFileSync(file, '<h1>Report</h1>')
    const featured = await turn.featured(['中文 报告 (1).html'])
    expect((await turn.capture('报告已完成。', 'session/user-1', undefined, featured)))
      .toMatchObject([{ path: realpathSync(file), ordinal: 1, change: 'created' }])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
