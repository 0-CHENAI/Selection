import { expect, it } from 'bun:test'
import { mergeArtifactSupplements, type ArtifactSupplement } from '../artifact-supplements'
import type { ResponseArtifact } from '../response-artifacts'

const docx: ResponseArtifact = { path: '/work/附录.docx', name: '附录.docx', extension: 'docx', change: 'created' }
const pptx: ResponseArtifact = { path: '/work/项目介绍.pptx', name: '项目介绍.pptx', extension: 'pptx', change: 'created' }

function supplement(extra: Partial<ArtifactSupplement> = {}): ArtifactSupplement {
  return {
    path: '/work/项目介绍.pptx',
    name: '项目介绍.pptx',
    extension: 'pptx',
    applyAnchors: ['msg-1'],
    pendingAnchors: ['msg-1'],
    meta: '生成中',
    ...extra,
  }
}

it('pins a supplemented file ahead of the other deliverables', () => {
  const rows = mergeArtifactSupplements([docx, pptx], [supplement({ pendingAnchors: [] })], ['msg-1'], 'settled')
  expect(rows.map(row => row.artifact.name)).toEqual(['项目介绍.pptx', '附录.docx'])
  expect(rows[0]?.supplement?.meta).toBe('生成中')
  expect(rows[0]?.synthetic).toBe(false)
  expect(rows).toHaveLength(2)
})

it('shows only the live row before the shelf settles, and does not list the same file twice', () => {
  const pending = mergeArtifactSupplements([docx, pptx], [supplement()], ['msg-1'], 'pending')
  expect(pending.map(row => row.artifact.name)).toEqual(['项目介绍.pptx'])
  const injected = mergeArtifactSupplements([docx], [supplement()], ['msg-1'], 'pending')
  expect(injected.map(row => [row.artifact.name, row.synthetic])).toEqual([['项目介绍.pptx', true]])
})

it('ignores a supplement aimed at another reply', () => {
  expect(mergeArtifactSupplements([pptx], [supplement()], ['other'], 'settled').map(row => row.supplement)).toEqual([undefined])
  expect(mergeArtifactSupplements([], [supplement()], ['other'], 'pending')).toEqual([])
})
