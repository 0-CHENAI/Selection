import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { draftComposerAtomFamily, prepareNextDraft, resolveDraftSources } from '../work-mode'

test('new ordinary drafts ignore enabled sources and late workspace hydration', () => {
  const store = createStore()
  const draft = draftComposerAtomFamily('ordinary')
  expect(resolveDraftSources(store.get(draft), undefined, ['enabled'])).toEqual([])
  expect(resolveDraftSources(store.get(draft), undefined, ['workspace-default'])).toEqual([])
  store.set(draft, state => ({ ...state, sourceSlugs: ['chosen'], sourcesChosen: true }))
  expect(resolveDraftSources(store.get(draft), undefined, ['workspace-default'])).toEqual(['chosen'])
  expect(resolveDraftSources(store.get(draft), 'project', ['workspace-default'])).toEqual(['chosen'])
})

test('consuming a draft clears its context choices, preserving model options and other drafts', () => {
  const store = createStore()
  const a = draftComposerAtomFamily('a')
  const b = draftComposerAtomFamily('b')
  store.set(a, state => ({ ...state, initialized: true, hydrated: true, model: 'chosen-model', connection: 'chosen-connection',
    workingDirectory: '/chosen', thinkingSelection: 'high', swarmEnabled: true,
    sourceSlugs: ['database'], sourcesChosen: true }))
  const submitted = store.get(a)
  store.set(a, state => prepareNextDraft(state))
  expect(store.get(a)).toMatchObject({ sourceSlugs: [], sourcesChosen: false,
    initialized: true, hydrated: true,
    model: 'chosen-model', connection: 'chosen-connection', workingDirectory: undefined,
    thinkingSelection: 'high', swarmEnabled: true })
  expect(submitted.sourceSlugs).toEqual(['database'])
  expect(submitted.workingDirectory).toBe('/chosen')
  expect(store.get(b).sourceSlugs).toEqual([])
  expect(resolveDraftSources(store.get(a), undefined, ['default-after-refresh'])).toEqual([])
  expect(resolveDraftSources(store.get(b), 'project', ['project-default'])).toEqual(['project-default'])
  expect(prepareNextDraft(submitted, 'project').sourceSlugs).toEqual(['database'])
  expect(prepareNextDraft(submitted, 'project').workingDirectory).toBe('/chosen')
})
