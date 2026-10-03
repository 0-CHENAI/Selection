import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { draftComposerAtomFamily, workModeViewAtom } from '../atoms/work-mode'
import { draftSessionOptionsId } from './draft-session'
import { executionChildrenByRoot, isUnownedExecution, isWorkModeRoot, sessionWorkModeView } from './work-mode-navigation'
import type { SessionMeta } from '../atoms/sessions'

test('only roots appear as peers; hidden execution children keep their real root', () => {
  const sessions: SessionMeta[] = [
    { id: 'norm', workspaceId: 'w', workMode: 'NORM' },
    { id: 'pro', workspaceId: 'w', workMode: 'PRO', executionRootSessionId: 'pro' },
    { id: 'worker', workspaceId: 'w', workMode: 'PRO', parentSessionId: 'pro', executionRootSessionId: 'pro', hidden: true, hasUnread: true, isProcessing: true },
    { id: 'reviewer', workspaceId: 'w', workMode: 'PRO', parentSessionId: 'worker', executionRootSessionId: 'pro', orchestrationRole: 'reviewer' },
    { id: 'unowned-node', workspaceId: 'w', workMode: 'NORM', taskNodeId: 'a', executionRootSessionId: 'unowned-node', workModeNeedsReview: true },
    { id: 'orphan', workspaceId: 'w', parentSessionId: 'missing', workModeNeedsReview: true },
  ]
  expect(sessions.filter(session => isWorkModeRoot(session, 'NORM')).map(s => s.id)).toEqual(['norm'])
  expect(sessions.filter(session => isWorkModeRoot(session, 'PRO')).map(s => s.id)).toEqual(['pro'])
  expect(executionChildrenByRoot(sessions).get('pro')?.map(s => s.id)).toEqual(['worker', 'reviewer'])
  const byId = new Map(sessions.map(session => [session.id, session]))
  expect(sessions.filter(session => isUnownedExecution(session, byId)).map(s => s.id)).toEqual(['unowned-node', 'orphan'])
  expect(sessionWorkModeView(byId.get('reviewer'), byId)).toBe('PRO')
})

test('switching the view preserves independent composer choices and never changes actors', () => {
  const store = createStore()
  const norm = draftComposerAtomFamily(draftSessionOptionsId('w', undefined, 'NORM'))
  const pro = draftComposerAtomFamily(draftSessionOptionsId('w', undefined, 'PRO'))
  store.set(norm, { initialized: true, hydrated: true, model: 'original-model', sourceSlugs: ['files'], workingDirectory: '/project', swarmEnabled: false })
  store.set(pro, { initialized: true, hydrated: true, model: 'original-model', sourceSlugs: ['search'], swarmEnabled: false })
  store.set(workModeViewAtom, 'PRO'); store.set(workModeViewAtom, 'NORM')
  expect(store.get(norm)).toMatchObject({ model: 'original-model', sourceSlugs: ['files'], workingDirectory: '/project' })
  expect(store.get(pro)).toMatchObject({ model: 'original-model', sourceSlugs: ['search'], swarmEnabled: false })
})
