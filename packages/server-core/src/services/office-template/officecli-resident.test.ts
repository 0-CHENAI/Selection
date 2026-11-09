import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { flushOfficecliResident } from './service.ts'

describe('OfficeCLI 常驻进程落盘', () => {
  test.skipIf(process.platform === 'win32')('重算前先 close，且不再新起常驻进程', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-resident-'))
    try {
      const log = join(dir, 'calls.log')
      const fake = join(dir, 'officecli')
      writeFileSync(fake, `#!/bin/sh\necho "$OFFICECLI_NO_AUTO_RESIDENT $@" >> "${log}"\n`)
      chmodSync(fake, 0o755)
      flushOfficecliResident(fake, '/w/book.xlsx')
      flushOfficecliResident(undefined, '/w/book.xlsx')
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['1 close /w/book.xlsx'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
