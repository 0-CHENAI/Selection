import { afterEach, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { replaceSessionFile } from '../replace-session-file'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

it('retries Windows locks while keeping the previous transcript readable', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'session-replace-'))
  roots.push(root)
  const temporary = join(root, 'session.tmp'), committed = join(root, 'session.jsonl')
  await fs.writeFile(temporary, 'new history')
  await fs.writeFile(committed, 'old history')
  const rename = fs.rename
  let attempts = 0
  const locked = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    expect(await fs.readFile(committed, 'utf8')).toBe('old history')
    if (attempts++ < 3) throw Object.assign(new Error('sharing violation'), { code: ['EPERM', 'EACCES', 'EBUSY'][attempts - 1] })
    return rename(from, to)
  })
  try {
    await replaceSessionFile(temporary, committed, 'win32')
    expect(attempts).toBe(4)
    expect(await fs.readFile(committed, 'utf8')).toBe('new history')
  } finally { locked.mockRestore() }
})

it('bounds Windows retries and does not hide a persistent lock', async () => {
  const failure = Object.assign(new Error('locked'), { code: 'EPERM' })
  const locked = spyOn(fs, 'rename').mockRejectedValue(failure)
  try {
    await expect(replaceSessionFile('temporary', 'committed', 'win32')).rejects.toBe(failure)
    expect(locked).toHaveBeenCalledTimes(6)
  } finally { locked.mockRestore() }
})

it('does not retry other errors or non-Windows permission failures', async () => {
  const failure = Object.assign(new Error('missing file'), { code: 'ENOENT' })
  const rename = spyOn(fs, 'rename').mockRejectedValue(failure)
  try {
    await expect(replaceSessionFile('temporary', 'committed', 'win32')).rejects.toBe(failure)
    expect(rename).toHaveBeenCalledTimes(1)
    rename.mockClear().mockRejectedValue(Object.assign(new Error('permission'), { code: 'EPERM' }))
    await expect(replaceSessionFile('temporary', 'committed', 'darwin')).rejects.toThrow('permission')
    expect(rename).toHaveBeenCalledTimes(1)
  } finally { rename.mockRestore() }
})
