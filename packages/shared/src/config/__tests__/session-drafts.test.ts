import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function makeConfigDir(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-drafts-'))
}

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { getSessionDraft, setSessionDraft, deleteSessionDraft, getAllSessionDrafts } from '${STORAGE_MODULE_PATH}'; ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim()
}

describe('session draft storage', () => {
  it('failed writes preserve all existing drafts instead of truncating their storage', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('original', { text: '原草稿' })")
    const draftsPath = join(configDir, 'drafts.json')
    const original = readFileSync(draftsPath, 'utf8')
    mkdirSync(draftsPath + '.tmp')
    expect(() => runEval(configDir, "setSessionDraft('recovery', { text: '文'.repeat(100000) })")).toThrow('subprocess failed')
    expect(readFileSync(draftsPath, 'utf8')).toBe(original)
    expect(JSON.parse(runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")))
      .toEqual({ original: { text: '原草稿' } })
  })
  it('returns null for an unknown session', () => {
    const configDir = makeConfigDir()
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('missing')))")
    expect(output).toBe('null')
  })

  it('round-trips a text-only draft', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: 'hello world' })")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({ text: 'hello world' })
  })

  it('round-trips a draft with attachment refs', () => {
    const configDir = makeConfigDir()
    runEval(configDir,
      "setSessionDraft('s1', { text: 'caption', attachments: [{ path: '/tmp/a.png', name: 'a.png' }, { path: '/tmp/b.pdf', name: 'Report.pdf' }] })"
    )
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: 'caption',
      attachments: [
        { path: '/tmp/a.png', name: 'a.png' },
        { path: '/tmp/b.pdf', name: 'Report.pdf' },
      ],
    })
  })

  it('round-trips an attachments-only draft (empty text)', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: '', attachments: [{ path: '/tmp/a.png', name: 'a.png' }] })")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: '',
      attachments: [{ path: '/tmp/a.png', name: 'a.png' }],
    })
  })

  it('removes the entry when draft is fully empty', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: 'typed' })")
    runEval(configDir, "setSessionDraft('s1', { text: '' })")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(output).toBe('null')
  })

  it('strips extra FileAttachment fields when persisting path-only attachments', () => {
    const configDir = makeConfigDir()
    // Pass a FileAttachment-shaped object (includes base64/size/etc.); persistence
    // should reduce it to just path + name when no `content` subfield is present.
    runEval(configDir,
      "setSessionDraft('s1', { text: '', attachments: [{ path: '/tmp/a.png', name: 'a.png', base64: 'AAAA', size: 4, type: 'image', mimeType: 'image/png' }] })"
    )
    const draftsPath = join(configDir, 'drafts.json')
    const raw = JSON.parse(readFileSync(draftsPath, 'utf-8'))
    expect(raw.drafts.s1.attachments).toEqual([{ path: '/tmp/a.png', name: 'a.png' }])
  })

  it('round-trips a draft with a content-backed attachment (paste / web-drag path)', () => {
    const configDir = makeConfigDir()
    runEval(configDir,
      "setSessionDraft('s1', { text: 'note', attachments: [{ path: 'pasted-image-1.png', name: 'pasted-image-1.png', content: { type: 'image', mimeType: 'image/png', size: 4, base64: 'AAAA', thumbnailBase64: 'BBBB' } }] })"
    )
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: 'note',
      attachments: [{
        path: 'pasted-image-1.png',
        name: 'pasted-image-1.png',
        content: { type: 'image', mimeType: 'image/png', size: 4, base64: 'AAAA', thumbnailBase64: 'BBBB' },
      }],
    })
  })

  it('round-trips a text-content attachment without base64', () => {
    const configDir = makeConfigDir()
    runEval(configDir,
      "setSessionDraft('s1', { text: '', attachments: [{ path: 'pasted.txt', name: 'pasted.txt', content: { type: 'text', mimeType: 'text/plain', size: 5, text: 'hello' } }] })"
    )
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(JSON.parse(output)).toEqual({
      text: '',
      attachments: [{
        path: 'pasted.txt',
        name: 'pasted.txt',
        content: { type: 'text', mimeType: 'text/plain', size: 5, text: 'hello' },
      }],
    })
  })

  it('rejects on load: ref with malformed content (wrong type field)', () => {
    const configDir = makeConfigDir()
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        s1: {
          text: '',
          attachments: [{ path: 'x.png', name: 'x.png', content: { type: 'bogus', mimeType: 'image/png', size: 1 } }],
        },
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    expect(JSON.parse(output)).toEqual({})
  })

  it('rejects on load: 0.8.11-shape ref (synthetic filename path, no content)', () => {
    const configDir = makeConfigDir()
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        s1: {
          text: 'note',
          attachments: [{ path: 'image.png', name: 'image.png' }],
        },
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    // Entire draft is dropped (attachment validator fails → ref fails → draft fails)
    expect(JSON.parse(output)).toEqual({})
  })

  it('discards legacy string-shaped drafts on load', () => {
    const configDir = makeConfigDir()
    // Simulate a pre-upgrade drafts.json where values are strings.
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        old1: 'unmigrated text',
        old2: 'another one',
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    expect(JSON.parse(output)).toEqual({})
  })

  it('keeps valid SessionDraft entries and drops invalid siblings on load', () => {
    const configDir = makeConfigDir()
    const draftsPath = join(configDir, 'drafts.json')
    writeFileSync(draftsPath, JSON.stringify({
      drafts: {
        valid: { text: 'stay' },
        legacy: 'drop',
        mangled: { text: 42 },
      },
      updatedAt: 0,
    }), 'utf-8')
    const output = runEval(configDir, "console.log(JSON.stringify(getAllSessionDrafts()))")
    expect(JSON.parse(output)).toEqual({ valid: { text: 'stay' } })
  })

  it('deleteSessionDraft removes the entry', () => {
    const configDir = makeConfigDir()
    runEval(configDir, "setSessionDraft('s1', { text: 'hi' })")
    runEval(configDir, "deleteSessionDraft('s1')")
    const output = runEval(configDir, "console.log(JSON.stringify(getSessionDraft('s1')))")
    expect(output).toBe('null')
  })
})

it('preserves oversized recovery text and Windows cross-drive/UNC attachment refs across reload', () => {
  const configDir = makeConfigDir()
  const draft = { text: '# 原始输入\r\n' + '文'.repeat(100_000), attachments: [
    { path: 'E:\\项目\\源 文件.txt', name: '源 文件.txt' }, { path: '\\\\host\\共享\\share.txt', name: 'share.txt' },
  ] }
  // Linux limits each command argument; exercise large draft storage via a file.
  const input = join(configDir, 'large-draft.json')
  writeFileSync(input, JSON.stringify(draft))
  runEval(configDir, `setSessionDraft('recovery', await Bun.file(${JSON.stringify(input)}).json())`)
  expect(JSON.parse(runEval(configDir, "console.log(JSON.stringify(getSessionDraft('recovery')))"))).toEqual(draft)
})
