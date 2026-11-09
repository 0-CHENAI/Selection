/** Opt-in real SessionManager/Pi validation. Retains the isolated workspace for artifact inspection. */
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionManager, createManagedSession, setSessionPlatform } from '../packages/server-core/src/sessions/SessionManager'
import { createHeadlessPlatform } from '../packages/server-core/src/runtime/platform-headless'
import { getLlmConnections } from '../packages/shared/src/config'

const connections = getLlmConnections().filter(c => c.models?.some(m => (typeof m === 'string' ? m : m.id) === 'Laufry'))
const connection = process.argv[2] ? connections.find(c => c.slug === process.argv[2]) : connections.length === 1 ? connections[0] : undefined
if (!connection) throw new Error('Specify an existing Laufry connection slug as the first argument')
const root = mkdtempSync(join(tmpdir(), 'selection-progress-product-'))
const platform = createHeadlessPlatform()
platform.appRootPath = join(import.meta.dir, '..')
setSessionPlatform(platform)
writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'validation', name: 'Validation', slug: 'validation',
  defaults: { defaultLlmConnection: connection.slug }, progressSupervision: { mode: 'observe', connectionSlug: connection.slug } }))
const manager = new SessionManager()
manager.setEventSink(() => {})
let failures = 0
try {
  for (const kind of ['simple', 'svg']) for (let run = 1; run <= 3; run++) {
    const id = `${kind}-${run}`
    const file = join(root, `${id}.html`)
    const managed = createManagedSession({ id, name: id, model: 'Laufry', llmConnection: connection.slug,
      workingDirectory: root, permissionMode: 'allow-all' },
    { id: 'validation', name: 'Validation', rootPath: root, createdAt: Date.now() }, { messagesLoaded: true })
    // The harness uses an isolated workspace without registering it in the user's global config.
    const sessions = (manager as unknown as { sessions: Map<string, typeof managed> }).sessions
    sessions.set(id, managed)
    const began = Date.now()
    // Test deadline only: never interpreted as evidence of semantic stagnation.
    const timer = setTimeout(() => { void manager.cancelProcessing(id, true) }, 120_000)
    const prompt = kind === 'simple' ? '计算 17×23，并简短给出结果。'
      : `在 ${file} 写入一个可以离线打开的完整 HTML 文件。内容为 SVG 架构图：客户端、API、任务队列、两个 Worker、数据库六个节点，带有清晰标签与连接箭头。所有内容嵌入单文件。写入后用只读工具检查文件包含这六个节点。仅在这个文件上工作，最后给出交付路径。`
    try { await manager.sendMessage(id, prompt) } finally { clearTimeout(timer) }
    await manager.flushSession(id)
    const answers = managed.messages.filter(m => m.answerCommitted)
    const errors = managed.messages.filter(m => m.role === 'error').map(m => m.errorCode)
    const html = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const artifactValid = html.includes('<svg') && ['客户端', 'API', '任务队列', 'Worker', '数据库'].every(label => html.includes(label))
    const taskSucceeded = answers.length === 1 && errors.length === 0 && (kind === 'svg' ? artifactValid : answers[0]!.content.includes('391'))
    if (!taskSucceeded) failures++
    console.log('VALIDATION ' + JSON.stringify({ kind, run, taskSucceeded, elapsedMs: Date.now() - began,
      answerCommitted: answers.length, errors, artifact: kind === 'svg' ? file : undefined,
      artifactValid: kind === 'svg' ? artifactValid : undefined, usage: managed.tokenUsage?.lastTurn, root }))
  }
} finally { manager.cleanup() }
if (failures) process.exitCode = 1
