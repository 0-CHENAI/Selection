import * as React from 'react'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import testI18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import en from '../../../../../shared/src/i18n/locales/en.json'
import zh from '../../../../../shared/src/i18n/locales/zh-Hans.json'
import { TodoList } from '../TodoList'
import type { TodoItem } from '../TurnCard'
import { railTocActiveIndex } from '../../ui/rail-toc'

await testI18n.use(initReactI18next).init({
  lng: 'zh-Hans',
  fallbackLng: 'en',
  keySeparator: false,
  resources: {
    en: { translation: en },
    'zh-Hans': { translation: zh },
  },
  interpolation: { escapeValue: false },
})

async function renderList(items: TodoItem[], language: 'zh-Hans' | 'en' = 'zh-Hans') {
  await testI18n.changeLanguage(language)
  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <TodoList todos={items} />
    </I18nextProvider>,
  )
}

function row(html: string, status: string): string {
  return html.split(`data-task-status="${status}"`)[1]?.split('</li>')[0] ?? ''
}

const mixed: TodoItem[] = [
  { id: 'facts', content: '确认事实', status: 'completed' },
  { id: 'sources', content: '核对出处', status: 'interrupted' },
  { id: 'summary', content: '撰写摘要', status: 'in_progress', activeForm: '正在撰写摘要' },
  { id: 'appendix', content: '整理附录', status: 'pending' },
]

describe('task step from status', () => {
  test('highlights the in-progress step, or the last step when everything is done', () => {
    expect(railTocActiveIndex([
      { status: 'completed' },
      { status: 'interrupted' },
      { status: 'in_progress' },
      { status: 'pending' },
    ])).toBe(2)
    expect(railTocActiveIndex([{ status: 'completed' }, { status: 'completed' }])).toBe(1)
    expect(railTocActiveIndex([{ status: 'completed' }, { status: 'interrupted' }, { status: 'pending' }])).toBe(-1)
    expect(railTocActiveIndex([{ status: 'pending' }, { status: 'pending' }])).toBe(-1)
    expect(railTocActiveIndex([])).toBe(-1)
  })
})

describe('read-only task rail', () => {
  test('shows every status in Chinese without a control', async () => {
    const html = await renderList(mixed)
    expect(html).toContain(zh['taskList.title'])
    expect(html).toContain('确认事实')
    expect(html).toContain('正在撰写摘要')
    expect(html).toContain('核对出处')
    expect(html).toContain('整理附录')
    expect(html).toContain(zh['taskList.status.completed'])
    expect(html).toContain(zh['taskList.status.in_progress'])
    expect(html).toContain(zh['taskList.status.pending'])
    expect(html).toContain(zh['taskList.status.interrupted'])
    expect(html).toContain('1 进行中 · 1 待处理 · 1 已完成 · 1 已中断')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('data-task-status="in_progress"')
    expect(html).toContain('data-task-status="interrupted"')
    expect(html).toContain('data-task-status="completed"')
    expect(html).toContain('data-task-status="pending"')
    expect(html).toContain('line-through')
    expect(html).toContain('text-destructive/70')
    expect(html).toContain('text-foreground/50')
    expect(html).toContain('data-readonly="true"')
    expect(html).toContain('data-slot="rail-toc"')
    expect(html.includes('<button')).toBe(false)
    expect(html.includes('hover:')).toBe(false)
    expect(html.includes('aria-expanded')).toBe(false)
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    const current = row(html, 'in_progress')
    expect(current).toContain('aria-current="step"')
    expect(current).toContain('正在撰写摘要')
    expect(current).toContain('font-medium text-foreground')
    expect(row(html, 'interrupted')).not.toContain('aria-current')
    expect(row(html, 'completed')).not.toContain('aria-current')
    expect(row(html, 'pending')).toContain('text-foreground/50')
  })

  test('parks a finished list on the last step and uses the English title', async () => {
    const done: TodoItem[] = mixed.map(item => ({ ...item, status: 'completed' as const, activeForm: undefined }))
    const html = await renderList(done)
    expect(html).toContain(zh['taskList.allCompleted'])
    expect(html).toContain('撰写摘要')
    expect(html).toContain('整理附录')
    expect(html.includes('<button')).toBe(false)
    const rows = html.split('<li ').slice(1)
    const last = rows[rows.length - 1] ?? ''
    expect(last).toContain('aria-current="step"')
    expect(last).toContain('整理附录')
    expect(last).toContain('font-medium text-foreground')
    expect(rows[0]).not.toContain('aria-current')
    expect(await renderList([{ id: 'a', content: 'Confirm', status: 'pending' }], 'en')).toContain(en['taskList.title'])
    expect(await renderList([])).toBe('')
  })

  test('does not mark a current step when nothing is in progress and the list is unfinished', async () => {
    const html = await renderList([
      { id: 'facts', content: '确认事实', status: 'completed' },
      { id: 'sources', content: '核对出处', status: 'interrupted' },
      { id: 'appendix', content: '整理附录', status: 'pending' },
    ])
    expect(html.includes('aria-current')).toBe(false)
    expect(html).toContain('line-through')
    expect(html).toContain('text-foreground/50')
  })

  test('keeps the native rail drawing and drops click, hover, and scroll', () => {
    const source = readFileSync(new URL('../../ui/rail-toc.tsx', import.meta.url), 'utf8')
    const list = readFileSync(new URL('../TodoList.tsx', import.meta.url), 'utf8')
    expect(source).toContain('strokeDasharray="2 5"')
    expect(source).toContain('M12 2 20.5 21 12 17.5 3.5 21z')
    expect(source).toContain('stiffness: 140, damping: 26, mass: 0.6')
    expect(source).toContain('stiffness: 260, damping: 30')
    expect(source).toContain('data-slot="rail-toc-plane"')
    expect(source).toContain('pathLength: filled')
    expect(source).toContain('useReducedMotion')
    expect(source).toContain('reduceMotion ? target : travel')
    expect(source).toContain('reduceMotion ? heading : turn')
    expect(source).toContain('motion-reduce:transition-none')
    expect(source).toContain('[--rail:color-mix(in_oklab,var(--foreground)_45%,var(--background))]')
    expect(source).not.toMatch(/onClick|onMouse|onPointer|onKey|hover:|<button|addEventListener|scroll/)
    expect(list).not.toMatch(/onClick|onMouse|onPointer|onKey|hover:|<button|addEventListener|scroll/)
  })
})
