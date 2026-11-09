import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { replayTaskDelivery, type TaskDeliveryReceipt } from './task-delivery-receipt'

test('persisted receipts replay without integration and reject changed content or requests', () => {
  const root = mkdtempSync(join(tmpdir(), 'delivery-replay-'))
  try {
    writeFileSync(join(root, 'a.txt'), 'approved')
    const receipt: TaskDeliveryReceipt = JSON.parse(JSON.stringify({ version: 1, outputs: { file: 'a.txt' },
      hashes: { 'a.txt': createHash('sha256').update('approved').digest('hex') }, checks: ['text'] }))
    const first = replayTaskDelivery(root, { file: 'a.txt' }, receipt)
    expect(replayTaskDelivery(root, { file: 'a.txt' }, receipt)).toEqual(first)
    expect(() => replayTaskDelivery(root, { other: 'a.txt' }, receipt)).toThrow('does not match')
    writeFileSync(join(root, 'a.txt'), 'user edit')
    expect(() => replayTaskDelivery(root, { file: 'a.txt' }, receipt)).toThrow('changed before delivery')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
