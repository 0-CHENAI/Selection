import * as React from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import i18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import en from '../../../../../shared/src/i18n/locales/en.json'
import { TooltipProvider } from '../../tooltip'
import type { ActivityItem, TurnCardProps } from '../TurnCard'
import type { StoredSession } from '@craft-agent/core'

// Match the asset handling used by the existing TurnCard server-render tests.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }))
mock.module('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {} }, Document: () => null, Page: () => null }))

let TurnCard: typeof import('../TurnCard').TurnCard
let SessionViewer: typeof import('../SessionViewer').SessionViewer
let renderer: ReactTestRenderer
const hostGlobals = ['window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
const previousGlobals = hostGlobals.map(key => Object.getOwnPropertyDescriptor(globalThis, key))
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', keySeparator: false, resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  })
  TurnCard = (await import('../TurnCard')).TurnCard
  SessionViewer = (await import('../SessionViewer')).SessionViewer
  // Test renderer has no DOM; passive UI timers still use window's timer API.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ getPropertyValue: () => '' }) })
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16) })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: clearTimeout })
})
afterEach(() => { if (renderer) act(() => renderer.unmount()) })
afterAll(() => hostGlobals.forEach((key, index) => {
  const previous = previousGlobals[index]
  if (previous) Object.defineProperty(globalThis, key, previous)
  else Reflect.deleteProperty(globalThis, key)
}))

const thinking: ActivityItem = { id: 'reasoning-1', type: 'thinking', status: 'running', timestamp: 1, content: 'Reasoning retained in the process.' }
const tool: ActivityItem = { id: 'read', type: 'tool', toolName: 'Read', status: 'running', timestamp: 2 }
const doneThinking: ActivityItem = { ...thinking, status: 'completed' }
const doneTool: ActivityItem = { ...tool, status: 'completed' }
const stages: Partial<TurnCardProps>[] = [
  { activities: [] },
  { activities: [thinking] },
  { activities: [{ ...thinking, content: `${thinking.content} More tokens.` }] },
  { activities: [doneThinking, tool] },
  { activities: [doneThinking, doneTool, { id: 'note', type: 'intermediate', status: 'running', timestamp: 3, content: 'Another process step.' }] },
  { activities: [doneThinking, doneTool], response: { text: 'Final answer stays visible.', isStreaming: true } },
  { activities: [doneThinking, doneTool], isComplete: true, isStreaming: false, response: { text: 'Final answer stays visible.', isStreaming: false } },
]

function card(props: Partial<TurnCardProps>) {
  return <I18nextProvider i18n={i18n}><TooltipProvider>
    <TurnCard {...base} {...props} />
  </TooltipProvider></I18nextProvider>
}
const base: TurnCardProps = {
  sessionId: 'normal-session', turnId: 'turn-1', activities: [thinking], isStreaming: true, isComplete: false,
  annotationInteractionMode: 'tooltip-only', renderActionsMenu: () => null,
}
function render(props: Partial<TurnCardProps>) { act(() => { renderer = create(card(props)) }) }
function update(props: Partial<TurnCardProps>) { act(() => renderer.update(card(props))) }
function header() { return renderer.root.findAll(node => node.type === 'button' && typeof node.props['aria-expanded'] === 'boolean')[0]! }
function expectFold(open: boolean) {
  expect(header().props['aria-expanded']).toBe(open)
  expect(renderer.root.findAll(node => node.type === 'div' && node.props.style?.gridTemplateRows === (open ? '1fr' : '0fr') && node.props['aria-hidden'] === !open).length).toBeGreaterThan(0)
}
function click() { act(() => header().props.onClick()) }

describe('process folds only follow user input', () => {
  it('stays collapsed on mount, generation, thinking tokens, tools, new steps and final delivery', () => {
    render(stages[0]!)
    expect(renderer.root.findAll(node => node.props['aria-expanded'] === true)).toHaveLength(0)
    for (const stage of stages.slice(1)) { update(stage); expectFold(false) }
    const answer = renderer.root.findByProps({ 'data-search-root': 'response' })
    expect(JSON.stringify(renderer.toJSON())).toContain('Final answer stays visible.')
    let parent = answer.parent
    while (parent) { expect(parent.props['aria-hidden']).not.toBe(true); parent = parent.parent }
    expect(JSON.stringify(renderer.toJSON())).toContain(thinking.content)
  })

  it.each(['cancelled', 'error'] as const)('preserves a manual choice through streaming and %s', outcome => {
    render({ activities: [thinking] })
    expectFold(false)
    click(); expectFold(true)
    for (const stage of stages.slice(2)) { update(stage); expectFold(true) }
    click(); expectFold(false)
    update({ activities: [thinking, { ...tool, status: 'error', error: outcome }], isComplete: true, isStreaming: false })
    expectFold(false)
    update({ activities: [{ ...thinking, content: 'Late process update' }, doneTool] })
    expectFold(false)
    click(); expectFold(true)
    update({ activities: [doneThinking, { ...tool, status: 'error', error: outcome }], isComplete: true, isStreaming: false })
    expectFold(true)
  })

  it('never emits a controlled expansion callback for lifecycle changes', () => {
    const onChange = mock(() => {})
    const controlled = (props: Partial<TurnCardProps>) => card({ ...props, isExpanded: false, onExpandedChange: onChange })
    act(() => { renderer = create(controlled(stages[1]!)) })
    for (const stage of stages) act(() => renderer.update(controlled(stage)))
    expect(onChange).not.toHaveBeenCalled()
    click()
    expect(onChange.mock.calls).toEqual([[true]])
  })

  it('isolates new messages and sessions even when the component and activity IDs are reused', () => {
    render({})
    click(); expectFold(true)
    update({ turnId: 'turn-2' }); expectFold(false)
    click(); expectFold(true)
    update({ sessionId: 'project-session', turnId: 'turn-2' }); expectFold(false)
    update({ sessionId: 'project-session', turnId: 'turn-2', isComplete: true, isStreaming: false, activities: [doneThinking] })
    expectFold(false)
    act(() => renderer.unmount())
    render({ isComplete: true, isStreaming: false, activities: [doneThinking, doneTool] })
    expectFold(false)
  })

  it('loads historical process folds closed and isolates reused message IDs in the viewer', () => {
    const session: StoredSession = {
      id: 'normal', workspaceId: 'workspace', createdAt: 1, lastUsedAt: 2,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
      messages: [
        { id: 'user', type: 'user', content: 'Check this.', timestamp: 1 },
        { id: 'thought', type: 'assistant', content: thinking.content!, timestamp: 2, turnId: 'shared-turn', streamKind: 'thinking', isIntermediate: true },
        { id: 'tool', type: 'tool', content: 'File read.', timestamp: 2.5, toolName: 'Read', toolUseId: 'read-file', toolStatus: 'completed', toolPurpose: 'work' },
        { id: 'answer', type: 'assistant', content: 'Historical final answer.', timestamp: 3, turnId: 'shared-turn', phase: 'final' },
      ],
    }
    const viewer = (value: StoredSession) => <I18nextProvider i18n={i18n}><TooltipProvider><SessionViewer session={value} /></TooltipProvider></I18nextProvider>
    act(() => { renderer = create(viewer(session)) })
    expectFold(false)
    click(); expectFold(true)
    act(() => renderer.update(viewer({ ...session, id: 'project' })))
    expectFold(false)
    expect(JSON.stringify(renderer.toJSON())).toContain('Historical final answer.')
  })
})
