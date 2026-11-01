import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

const root = join(import.meta.dir, '..')
const decks: Record<string, string> = {
  'dsh-blue-professional': '02be7e16233892404a1b97696a60cd03c7f8be77ffbe18b98c9def9bc847a934',
  'dsh-broadside': '8c2fb6c9b9d62bf591c597b389b873c7e02f83d8bd26ba0468047f1a1cce7a28',
  'dsh-cartesian': '665f9a90ace9738bb5f3a2e72434eed8ff22aaf1b663d75cf8088daac0e328db',
  'dsh-course-workshop': 'be686dcfca64e4be4250a9a6cbc167c68df61b97ddab6d0d62f8718aaa56e67b',
  'dsh-editorial-forest': '96a97b116ba5f3cc8f9c4344b6e1c204edb8ff5fd5165dbb935e46308c6dd257',
  'dsh-editorial-notebook': '837cd3f54b442586d47e07da53a64070af6a1ed2bc105759b505bd08a7fcdc33',
  'dsh-engineering-blueprint': 'ab79c6f953b1a314b9a2b9a4fbf656dcde9b01cf2aefe86e0ccb6e4d2f527feb',
  'dsh-monochrome': '04f04eeb33f6a167baf68061661e648056e1379dc450d74eaafe905279fa8f0f',
  'dsh-neo-grid-bold': 'e5ba99ff5123777bec577c6d55cbab92865188b2ab63e71a46679cd5ad19bedb',
  'dsh-playful': 'f77098c36d0116c884e9429994925d0969e06dff9478ed6515c2447736473fe4',
  'dsh-sakura-chroma': '8bd3439bd3e175ae5179690e6313bd6c1bf8822c40ac2bf138efd994af1a12df',
  'dsh-signal': '2f863fe5e6622185f014c2c567f7365c07ac3816568a8985e290575405dc10b8',
  'dsh-soft-editorial': 'c3c501370a31eb77537227bd2264b49163254c786777cfe091abaa346aab2857',
  'modular-logistics-system': 'd63b1b89cd3baa8303e93df65b5ccda8690274dfb0a41befe498cac01aa0bd13',
  'nordic-operating-report': '88e58be335e657078c33c0d74f389e1dcdd8589ad7d9e39e7fe6b1ccb8fd5955',
  'swiss-signal-grid': '51a91717bad4bac2adf126d3171a0142a3a686cd3acb72908012d15ab09af3aa',
}

test('shipped style decks stay byte-for-byte and image slots live in the sample extension', () => {
  expect(Object.keys(decks)).toHaveLength(16)
  for (const [id, hash] of Object.entries(decks)) {
    const bytes = readFileSync(join(root, 'styles', id, 'deck.json'))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash)
    expect(bytes.toString('utf8')).not.toContain('"imageSlots"')
  }
  const extension = JSON.parse(readFileSync(join(root, 'styles', 'image-slots.extension.json'), 'utf8')) as { kind: string; example: { schema: string } }
  expect(extension.kind).toBe('sample-extension')
  expect(extension.example.schema).toBe('dsh.template-images/v1')
  const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
  expect(skill).not.toContain('还没做')
  expect(skill).toContain('ppt_template_create_project')
  expect(skill).toContain('office_render')
  const composition = readFileSync(join(root, 'references', 'composition.md'), 'utf8')
  expect(composition).not.toContain('检查器不再仅因相邻同名 layout 拒绝导出')
  expect(composition).toContain('layout_repetition')
})
