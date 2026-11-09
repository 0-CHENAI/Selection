import { describe, it, expect } from 'bun:test'
import type { SessionMeta } from '@/atoms/sessions'
import {
  ancestorIds,
  buildSessionFamilies,
  flattenFamilies,
  listAncestorIds,
  listParentId,
  nestedAttentionOf,
  unreadProjectIds,
  visibleRowAttention,
  type SessionFamily,
} from '../session-tree'

function session(id: string, opts: Partial<SessionMeta> = {}): SessionMeta {
  return { id, workspaceId: 'ws-1', lastMessageAt: 0, createdAt: 0, ...opts }
}

/** Each family as `id@depth` strings, in display order */
function shape(families: SessionFamily[]): string[][] {
  return families.map(family => family.members.map(m => `${m.item.id}@${m.depth}`))
}

describe('listParentId', () => {
  it('prefers the spawn/task parent over the branch source', () => {
    expect(listParentId({ parentSessionId: 'p', branchFromSessionId: 'b' })).toBe('p')
    expect(listParentId({ branchFromSessionId: 'b' })).toBe('b')
    expect(listParentId({})).toBeUndefined()
  })
})

describe('buildSessionFamilies', () => {
  it('nests children and branches under a parent in the list', () => {
    const families = buildSessionFamilies([
      session('child', { parentSessionId: 'parent', createdAt: 2 }),
      session('parent', { createdAt: 1 }),
      session('branch', { branchFromSessionId: 'parent', createdAt: 3 }),
      session('plain'),
    ])

    expect(shape(families)).toEqual([['parent@0', 'child@1', 'branch@1'], ['plain@0']])
    expect(families[0].members[0].descendantCount).toBe(2)
  })

  it('keeps a session top-level when its parent is not in the list (orphan rule)', () => {
    const families = buildSessionFamilies([
      session('child', { parentSessionId: 'archived-parent' }),
      session('branch', { branchFromSessionId: 'deleted-source' }),
    ])

    expect(shape(families)).toEqual([['child@0'], ['branch@0']])
  })

  it('uses the spawn/task parent even when it is missing and the branch source is listed', () => {
    const families = buildSessionFamilies([
      session('source'),
      session('both', { parentSessionId: 'missing', branchFromSessionId: 'source' }),
    ])

    expect(shape(families)).toEqual([['source@0'], ['both@0']])
  })

  it('nests at any depth: a branch of a subtask, a branch of a branch', () => {
    const families = buildSessionFamilies([
      session('task'),
      session('step', { parentSessionId: 'task', createdAt: 1 }),
      session('step-branch', { branchFromSessionId: 'step', createdAt: 2 }),
      session('branch-of-branch', { branchFromSessionId: 'step-branch', createdAt: 3 }),
      session('step-2', { parentSessionId: 'task', createdAt: 4 }),
    ])

    expect(shape(families)).toEqual([['task@0', 'step@1', 'step-branch@2', 'branch-of-branch@3', 'step-2@1']])
    expect(families[0].members.map(m => m.descendantCount)).toEqual([4, 2, 1, 0, 0])
  })

  it('orders children by creation, not by activity', () => {
    const families = buildSessionFamilies([
      session('newest-activity', { parentSessionId: 'parent', createdAt: 3, lastMessageAt: 30 }),
      session('parent', { lastMessageAt: 10 }),
      session('first-created', { parentSessionId: 'parent', createdAt: 1, lastMessageAt: 5 }),
      session('second-created', { parentSessionId: 'parent', createdAt: 2, lastMessageAt: 20 }),
    ])

    expect(shape(families)).toEqual([['parent@0', 'first-created@1', 'second-created@1', 'newest-activity@1']])
  })

  it('orders families by their first member in the list', () => {
    const families = buildSessionFamilies([
      session('child-of-old', { parentSessionId: 'old', lastMessageAt: 30 }),
      session('recent', { lastMessageAt: 20 }),
      session('old', { lastMessageAt: 10 }),
    ])

    expect(shape(families)).toEqual([['old@0', 'child-of-old@1'], ['recent@0']])
  })

  it('breaks a loop of parents where the walk from its newest member meets it again', () => {
    const families = buildSessionFamilies([
      session('a', { parentSessionId: 'b' }),
      session('b', { parentSessionId: 'c' }),
      session('c', { parentSessionId: 'a' }),
      session('self', { parentSessionId: 'self' }),
    ])

    // a → b → c → a: the walk from a meets a again at c, so c becomes the root.
    expect(shape(families)).toEqual([['c@0', 'b@1', 'a@2'], ['self@0']])
  })

  it('places a family by its newest activity and any unread member, never changing the members', () => {
    const parent = session('parent', { lastMessageAt: 10, hasUnread: false })
    const child = session('child', { parentSessionId: 'parent', lastMessageAt: 50, hasUnread: true })
    const [family] = buildSessionFamilies([child, parent])

    expect(family.view).toMatchObject({ id: 'parent', lastMessageAt: 50, hasUnread: true })
    expect(family.members[0].item).toBe(parent)
    expect(parent.lastMessageAt).toBe(10)
  })

  it('uses the root itself as the view when the family adds nothing', () => {
    const solo = session('solo', { lastMessageAt: 10 })
    const parent = session('parent', { lastMessageAt: 50, hasUnread: true })
    const [soloFamily, family] = buildSessionFamilies([
      solo,
      parent,
      session('child', { parentSessionId: 'parent', lastMessageAt: 20 }),
    ])

    expect(soloFamily.view).toBe(solo)
    expect(family.view).toBe(parent)
  })
})

describe('flattenFamilies', () => {
  const families = buildSessionFamilies([
    session('root'),
    session('a', { parentSessionId: 'root', createdAt: 1 }),
    session('a1', { parentSessionId: 'a', createdAt: 2 }),
    session('b', { parentSessionId: 'root', createdAt: 3 }),
    session('other'),
  ])

  it('shows every member when nothing is collapsed, placed by the family view', () => {
    const rows = flattenFamilies(families, new Set())

    expect(rows.map(r => r.item.id)).toEqual(['root', 'a', 'a1', 'b', 'other'])
    expect(rows.map(r => r.groupItem.id)).toEqual(['root', 'root', 'root', 'root', 'other'])
    expect(rows.every(r => !r.collapsed)).toBe(true)
  })

  it('hides the members under a collapsed row', () => {
    expect(flattenFamilies(families, new Set(['a'])).map(r => `${r.item.id}${r.collapsed ? '+' : ''}`))
      .toEqual(['root', 'a+', 'b', 'other'])
    expect(flattenFamilies(families, new Set(['root'])).map(r => `${r.item.id}${r.collapsed ? '+' : ''}`))
      .toEqual(['root+', 'other'])
  })

  it('ignores a collapsed id that has nothing under it', () => {
    const rows = flattenFamilies(families, new Set(['other', 'a1']))

    expect(rows.map(r => r.item.id)).toEqual(['root', 'a', 'a1', 'b', 'other'])
    expect(rows.some(r => r.collapsed)).toBe(false)
  })

  it('gives each row its parent and the tree lines of the levels above it', () => {
    const rows = flattenFamilies(families, new Set())

    expect(rows.map(r => r.parent?.id)).toEqual([undefined, 'root', 'a', 'root', undefined])
    // root's line turns into a and runs on to b, passing a1; a's line turns into a1 and ends there
    expect(rows.map(r => r.guides.join(' '))).toEqual(['', 'branch', 'pass last', 'last', ''])
  })

  it('ends a line at its last child, under a collapsed row too', () => {
    const [family] = buildSessionFamilies([
      session('r'),
      session('x', { parentSessionId: 'r', createdAt: 1 }),
      session('x1', { parentSessionId: 'x', createdAt: 2 }),
      session('x2', { parentSessionId: 'x', createdAt: 3 }),
      session('y', { parentSessionId: 'r', createdAt: 4 }),
      session('y1', { parentSessionId: 'y', createdAt: 5 }),
    ])

    // y is r's last child, so r's line ends at y and doesn't pass y1
    expect(flattenFamilies([family], new Set()).map(r => `${r.item.id}:${r.guides.join(' ')}`))
      .toEqual(['r:', 'x:branch', 'x1:pass branch', 'x2:pass last', 'y:last', 'y1:none last'])
    expect(flattenFamilies([family], new Set(['x'])).map(r => `${r.item.id}:${r.guides.join(' ')}`))
      .toEqual(['r:', 'x:branch', 'y:last', 'y1:none last'])
  })
})

describe('ancestorIds', () => {
  const families = buildSessionFamilies([
    session('root'),
    session('a', { parentSessionId: 'root', createdAt: 1 }),
    session('a1', { parentSessionId: 'a', createdAt: 2 }),
    session('b', { parentSessionId: 'root', createdAt: 3 }),
  ])

  it('lists the sessions a session is nested under, nearest first', () => {
    expect(ancestorIds(families, 'a1')).toEqual(['a', 'root'])
    expect(ancestorIds(families, 'b')).toEqual(['root'])
    expect(ancestorIds(families, 'root')).toEqual([])
  })

  it('tells a session missing from the families apart from a root', () => {
    expect(ancestorIds(families, 'unknown')).toBeUndefined()
  })
})

describe('listAncestorIds', () => {
  it('walks spawn/task parents then branch sources, and stops at a missing parent', () => {
    const byId = new Map([
      ['child', session('child', { parentSessionId: 'step' })],
      ['step', session('step', { parentSessionId: 'task' })],
      ['task', session('task')],
      ['branch', session('branch', { branchFromSessionId: 'child' })],
    ])

    expect(listAncestorIds(byId.get('branch')!, byId)).toEqual(['child', 'step', 'task'])
    expect(listAncestorIds(session('orphan', { parentSessionId: 'gone' }), byId)).toEqual(['gone'])
    expect(listAncestorIds(session('root'), byId)).toEqual([])
  })

  it('breaks a parent loop', () => {
    const byId = new Map([
      ['a', session('a', { parentSessionId: 'b' })],
      ['b', session('b', { parentSessionId: 'a' })],
    ])
    expect(listAncestorIds(byId.get('a')!, byId)).toEqual(['b', 'a'])
  })
})

describe('nestedAttentionOf / flattenFamilies nested', () => {
  it('aggregates unread, processing and newest activity of descendants', () => {
    const [family] = buildSessionFamilies([
      session('root', { lastMessageAt: 10 }),
      session('a', { parentSessionId: 'root', createdAt: 1, lastMessageAt: 20, isProcessing: true }),
      session('a1', { parentSessionId: 'a', createdAt: 2, lastMessageAt: 50, hasUnread: true, lastMessageRole: 'assistant' }),
      session('b', { parentSessionId: 'root', createdAt: 3, lastMessageAt: 15, lastMessageRole: 'error' }),
    ])

    expect(nestedAttentionOf(family.members, 0)).toMatchObject({
      hasUnread: true, isProcessing: true, lastMessageAt: 50, lastMessageRole: 'assistant',
    })
    expect(nestedAttentionOf(family.members, 1)).toMatchObject({
      hasUnread: true, isProcessing: false, lastMessageAt: 50,
    })
    expect(nestedAttentionOf(family.members, 3)).toMatchObject({ hasUnread: false, isProcessing: false, lastMessageAt: 0 })
  })

  it('keeps nested signals on a collapsed parent whose children are hidden', () => {
    const [family] = buildSessionFamilies([
      session('root'),
      session('child', { parentSessionId: 'root', hasUnread: true, isProcessing: true, lastMessageAt: 9 }),
    ])
    const [row] = flattenFamilies([family], new Set(['root']))

    expect(row).toMatchObject({ item: { id: 'root' }, collapsed: true, descendantCount: 1 })
    expect(row.nested).toEqual({
      hasUnread: true, isProcessing: true, lastMessageAt: 9, lastMessageRole: undefined,
    })
  })

  it('attaches nested signals on an expanded parent too', () => {
    const [family] = buildSessionFamilies([
      session('root'),
      session('child', { parentSessionId: 'root', hasUnread: true, lastMessageAt: 4 }),
    ])
    const [row] = flattenFamilies([family], new Set())
    expect(row.collapsed).toBe(false)
    expect(row.nested).toMatchObject({ hasUnread: true, lastMessageAt: 4 })
  })
})

describe('visibleRowAttention', () => {
  const parent = session('parent', { lastMessageAt: 10, lastMessageRole: 'user' })
  const nested = { hasUnread: true, isProcessing: true, lastMessageAt: 40, lastMessageRole: 'error' as const }

  it('always surfaces nested unread, even while the family is expanded', () => {
    expect(visibleRowAttention(parent, nested, false)).toMatchObject({
      hasUnread: true, isProcessing: false, lastMessageAt: 10, lastMessageRole: 'user',
    })
  })

  it('overlays nested working/failed/activity onto a collapsed parent', () => {
    expect(visibleRowAttention(parent, nested, true)).toEqual({
      hasUnread: true, isProcessing: true, lastMessageAt: 40, lastMessageRole: 'error',
    })
  })

  it('leaves a row with no nested sessions unchanged', () => {
    const unread = session('solo', { hasUnread: true, lastMessageAt: 3 })
    expect(visibleRowAttention(unread, undefined, true)).toEqual({
      hasUnread: true, isProcessing: false, lastMessageAt: 3, lastMessageRole: undefined,
    })
  })
})

describe('unreadProjectIds', () => {
  it('collects project ids of active unread sessions, including nested children', () => {
    expect(unreadProjectIds([
      session('parent', { projectId: 'p1' }),
      session('child', { parentSessionId: 'parent', projectId: 'p1', hasUnread: true }),
      session('other', { projectId: 'p2', hasUnread: true, isArchived: true }),
      session('hidden', { projectId: 'p3', hasUnread: true, hidden: true }),
      session('plain', { hasUnread: true }),
    ])).toEqual(new Set(['p1']))
  })
})
