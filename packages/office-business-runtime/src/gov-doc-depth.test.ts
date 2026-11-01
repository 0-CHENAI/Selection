import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

const root = join(import.meta.dir, '../../../apps/electron/resources/skills/office-business/business-skills/gov-doc-writing')

function files(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...files(path))
    else if (name.endsWith('.md')) found.push(path)
  }
  return found
}

test('gov-doc covers the capability points without copying dsh text', () => {
  const bodies = files(root).map(path => readFileSync(path, 'utf8'))
  const all = bodies.join('\n')
  for (const needle of [
    '六个参数',
    '单位性质',
    '你看着写',
    '事实索取',
    '述职',
    '简报',
    '对照检查',
    '讲话稿',
    '六维',
    '权重',
    'S1',
    'S6',
    '脱敏',
    '公开',
    'GB/T 15834',
    'GB/T 15835',
    '文种速判',
  ]) {
    expect(all.includes(needle), needle).toBe(true)
  }
  for (const banned of ['排雷闸门', '金句库', 'v202_20260901', '01_主册', '三个深化', '专家团作业']) {
    expect(all.includes(banned), banned).toBe(false)
  }
})
