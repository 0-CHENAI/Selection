import { afterEach, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyBranchFiles } from './branch-files'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('owns attachments, artifacts and SDK history after the source directory is deleted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'branch-files-'))
  roots.push(root)
  const source = join(root, 'source')
  const branch = join(root, 'branch')
  await mkdir(join(source, 'attachments'), { recursive: true })
  await mkdir(join(source, '.pi-sessions'), { recursive: true })
  await mkdir(join(source, 'data', 'execution-owner'), { recursive: true })
  await mkdir(join(source, 'data', 'execution-checkpoint-lock'), { recursive: true })
  await mkdir(branch)
  await writeFile(join(source, 'attachments', 'image.png'), 'pixels')
  await writeFile(join(source, 'data', 'report.docx'), 'report bytes')
  await writeFile(join(source, 'data', 'execution-notes.txt'), 'user notes')
  await writeFile(join(source, 'data', 'execution-checkpoint.json'), '{"sessionId":"source"}')
  await writeFile(join(source, '.pi-sessions', 'history.jsonl'), JSON.stringify({ id: 'anchor', content: join(source, 'attachments', 'image.png') }))
  await writeFile(join(source, 'session.jsonl'), 'source metadata')
  await writeFile(join(branch, 'session.jsonl'), 'branch metadata')
  const snapshot = await copyBranchFiles(source, branch)
  await rm(source, { recursive: true })
  expect(await readFile(join(branch, 'attachments', 'image.png'), 'utf8')).toBe('pixels')
  expect(await readFile(join(branch, 'data', 'report.docx'), 'utf8')).toBe('report bytes')
  expect(await readFile(join(branch, 'data', 'execution-notes.txt'), 'utf8')).toBe('user notes')
  await expect(readFile(join(branch, 'data', 'execution-checkpoint.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(join(branch, 'data', 'execution-owner'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(join(snapshot, '.pi-sessions', 'history.jsonl'), 'utf8'))).toEqual({ id: 'anchor', content: join(branch, 'attachments', 'image.png') })
  expect(await readFile(join(branch, 'session.jsonl'), 'utf8')).toBe('branch metadata')
})
