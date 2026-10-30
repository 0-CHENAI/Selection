#!/usr/bin/env bun
/** Real model trace capture. This deliberately does not call a text match a passing route. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { getSessionPath } from '@craft-agent/shared/sessions'
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions'
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime'
import { exportDeck, loadDeckFile } from '../apps/electron/resources/skills/ppt-design/engine/index'

const repo = resolve(import.meta.dir, '..')
const workspace = getWorkspaces()[0]
const connection = getLlmConnections().find(item => item.slug === getDefaultLlmConnection())
assert(workspace && connection, 'A configured workspace and default model connection are required')
const cases = {
  title: '只把第2页标题改为“理解关键用户时刻”，其他文字、布局和整套风格保持原样。',
  layout: '只调整第2、4页版式：第2页改为上方主张、下方三个并列要点；第4页改为四列旅程对比。保留原内容、其余页面和当前整套配色字体。',
  restyle: '整套换成蓝色专业商务风格，允许重新选择风格。保留所有页面的事实、数据与叙事顺序。',
} as const
const key = process.argv[2] as keyof typeof cases
assert(key in cases, 'Usage: bun scripts/selection-3.2-office-routing-live.ts title|layout|restyle')
const dir = mkdtempSync(join(tmpdir(), `selection-3.2-route-${key}-`))
setBundledAssetsRoot(join(repo, 'apps/electron'))
setSessionPlatform(createHeadlessPlatform())
const manager = new SessionManager()
manager.setEventSink(() => {})
try {
  await manager.reinitializeAuth()
  const session = await manager.createSession(workspace.id, { workMode: 'PRO', hidden: true, permissionMode: 'allow-all', name: `#689 Office ${key} 验收`, model: connection.defaultModel, llmConnection: connection.slug, workingDirectory: dir })
  const data = join(getSessionPath(workspace.rootPath, session.id), 'data')
  mkdirSync(data, { recursive: true })
  const source = join(repo, 'apps/electron/resources/skills/ppt-design/styles/examples/imported/dsh-monochrome/deck.json')
  const project = join(data, 'deck.json')
  copyFileSync(source, project)
  const deck = loadDeckFile(project).deck!
  const output = join(dir, '演示稿.pptx')
  assert.equal((await exportDeck(deck, output)).status, 'ok')
  writeFileSync(join(data, 'ppt-output.json'), JSON.stringify({ path: output }))
  writeFileSync(join(data, 'plan.md'), '既有12页演示稿。当前设计为 dsh-monochrome；沿用 deck.json 中的主题。此轮是已有交付的跟进修改。')
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const before = { deck, projectSha256: hash(project), pptxSha256: hash(output) }
  writeFileSync(join(dir, 'before.json'), JSON.stringify(before, null, 2))
  console.log(JSON.stringify({ sessionId: session.id, outputDirectory: dir, model: connection.defaultModel, case: key }))
  await manager.sendMessage(session.id, `请修改已交付的 ${output}。${cases[key]} 这是本地验收素材，不要联网、创建任务或委派其他代理；只操作当前工作目录与当前会话的数据目录。`, undefined, undefined, { ppt: { templateId: 'dsh-monochrome' } })
  const result = await manager.getSession(session.id)
  const record = { case: key, sessionId: session.id, model: connection.defaultModel, connection: connection.slug, before, after: { deck: JSON.parse(readFileSync(project, 'utf8')), projectSha256: hash(project), pptxSha256: hash(output) }, messages: result?.messages, finalText: manager.getSessionFinalText(session.id), verdict: 'pending tool-trace, OOXML and native image review' }
  writeFileSync(join(dir, 'trace.json'), JSON.stringify(record, null, 2))
  console.log(JSON.stringify({ trace: join(dir, 'trace.json'), verdict: record.verdict }))
  assert(manager.sessionUsedTools(session.id), 'No tools ran; inspect trace for runtime/model failure')
  assert(record.finalText?.trim(), 'No final response; inspect terminal events before accepting the run')
} finally { await manager.flushAllSessions(); manager.cleanup() }
