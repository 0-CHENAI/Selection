import * as React from 'react'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import testI18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import en from '../../../../../shared/src/i18n/locales/en.json'
import zh from '../../../../../shared/src/i18n/locales/zh-Hans.json'
import { TodoList, taskRailDepths } from '../TodoList'
import type { TodoItem } from '../TurnCard'
import { railSolidTween, railTocActiveIndex } from '../../ui/rail-toc'

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

  test('crossfades the rail only when a mounted list becomes complete', () => {
    const edge = { mounted: true, previousComplete: false, allComplete: true, reduceMotion: false as boolean | null }
    expect(railSolidTween(edge)).toBe(true)
    expect(railSolidTween({ ...edge, reduceMotion: null })).toBe(true)
    expect(railSolidTween({ ...edge, reduceMotion: true })).toBe(false)
    expect(railSolidTween({ ...edge, mounted: false })).toBe(false)
    expect(railSolidTween({ ...edge, previousComplete: true })).toBe(false)
    expect(railSolidTween({ ...edge, allComplete: false })).toBe(false)
    expect(railSolidTween({
      mounted: true,
      previousComplete: true,
      allComplete: false,
      reduceMotion: false,
    })).toBe(false)
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
    expect(html).toContain('data-rail-complete="false"')
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
    expect(html).toContain('data-rail-complete="true"')
    expect(html).toContain('data-rail-solid-motion="instant"')
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
    expect(html).toContain('data-rail-complete="false"')
    expect(html.includes('aria-current')).toBe(false)
    expect(html).toContain('line-through')
    expect(html).toContain('text-foreground/50')
  })

  test('bends about one later step in four and keeps earlier nodes still', async () => {
    const depths = taskRailDepths(mixed)
    expect(depths[0]).toBe(0)
    for (let index = 1; index < depths.length; index++) {
      expect(Math.abs((depths[index] ?? 0) - (depths[index - 1] ?? 0))).toBeLessThanOrEqual(1)
      expect(depths[index]).toBeGreaterThanOrEqual(0)
      expect(depths[index]).toBeLessThanOrEqual(2)
    }
    const finished = mixed.map(item => ({ ...item, status: 'completed' as const, activeForm: '忽略' }))
    expect(taskRailDepths(finished)).toEqual(depths)
    const extra: TodoItem = { id: 'extra', content: '补充说明', status: 'pending' }
    expect(taskRailDepths([...mixed, extra]).slice(0, mixed.length)).toEqual(depths)
    expect(taskRailDepths(mixed.map(({ id, ...item }) => item))[0]).toBe(0)

    // At either edge the only feasible step is back toward the middle.
    let climbed = false
    let returnedFromTop = false
    let returnedToZero = false
    let sawConsecutive = false
    for (let n = 0; n < 400; n++) {
      const probed = taskRailDepths(
        ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, content: id })),
        `edge-${n}`,
      )
      for (let index = 1; index < probed.length; index++) {
        const previous = probed[index - 1] ?? 0
        const current = probed[index] ?? 0
        expect(current).toBeGreaterThanOrEqual(0)
        expect(current).toBeLessThanOrEqual(2)
        expect(Math.abs(current - previous)).toBeLessThanOrEqual(1)
        if (previous === 0 && current === 1) climbed = true
        if (previous === 2 && current === 1) returnedFromTop = true
        if (previous === 1 && current === 0) returnedToZero = true
        if (index > 1 && current !== previous && previous !== (probed[index - 2] ?? 0)) sawConsecutive = true
      }
    }
    expect(climbed).toBe(true)
    expect(returnedFromTop).toBe(true)
    expect(returnedToZero).toBe(true)
    expect(sawConsecutive).toBe(true)

    const many = Array.from({ length: 96 }, (_, index) => ({
      id: `step-${index}-${(index * 17).toString(36)}`,
      content: `步骤 ${index}`,
    }))
    const manyDepths = taskRailDepths(many)
    let bends = 0
    let consecutive = 0
    let previousBent = false
    for (let index = 1; index < manyDepths.length; index++) {
      const bent = manyDepths[index] !== manyDepths[index - 1]
      if (bent) {
        bends += 1
        if (previousBent) consecutive += 1
      }
      previousBent = bent
      expect(Math.abs((manyDepths[index] ?? 0) - (manyDepths[index - 1] ?? 0))).toBeLessThanOrEqual(1)
    }
    const rate = bends / (manyDepths.length - 1)
    expect(rate).toBeGreaterThan(0.12)
    expect(rate).toBeLessThan(0.4)
    expect(consecutive).toBeGreaterThan(0)

    const numbered = Array.from({ length: 6 }, (_, index) => ({
      id: String(index + 1),
      content: `任务 ${index + 1}`,
    }))
    const shapes = new Set<string>()
    let straight = 0
    for (let n = 0; n < 100; n++) {
      const seed = `list-${n}`
      const depthsForSeed = taskRailDepths(numbered, seed)
      expect(taskRailDepths(numbered, seed)).toEqual(depthsForSeed)
      expect(taskRailDepths(numbered.map(item => ({ ...item, content: `${item.content} 改` })), seed)).toEqual(depthsForSeed)
      expect(taskRailDepths(numbered.slice(0, 4), seed)).toEqual(depthsForSeed.slice(0, 4))
      expect(taskRailDepths([...numbered, { id: '7', content: '补充' }], seed).slice(0, 6)).toEqual(depthsForSeed)
      shapes.add(depthsForSeed.join(','))
      if (depthsForSeed.every(depth => depth === 0)) straight += 1
      expect(depthsForSeed[0]).toBe(0)
      for (let index = 1; index < depthsForSeed.length; index++) {
        expect(Math.abs((depthsForSeed[index] ?? 0) - (depthsForSeed[index - 1] ?? 0))).toBeLessThanOrEqual(1)
        expect(depthsForSeed[index]).toBeGreaterThanOrEqual(0)
        expect(depthsForSeed[index]).toBeLessThanOrEqual(2)
      }
    }
    expect(shapes.size).toBeGreaterThanOrEqual(15)
    expect(straight).toBe(0)
    expect(taskRailDepths(numbered, 'alpha')).not.toEqual(taskRailDepths(numbered, 'beta'))

    const html = await renderList(mixed)
    const rows = html.split('<li ').slice(1)
    expect(rows.map(entry => entry.match(/data-task-depth="(\d+)"/)?.[1])).toEqual(depths.map(String))
    const padding = [19, 33, 47]
    rows.forEach((entry, index) => {
      expect(entry).toContain(`padding-left:${padding[depths[index] ?? 0]}px`)
    })
  })

  test('keeps the native rail drawing and drops click, hover, and scroll', () => {
    const source = readFileSync(new URL('../../ui/rail-toc.tsx', import.meta.url), 'utf8')
    const list = readFileSync(new URL('../TodoList.tsx', import.meta.url), 'utf8')
    expect(source).toContain('from.x === to.x')
    expect(source).toContain('(to.y - from.y) * 0.5')
    expect(source).toContain('fill-transparent')
    expect(source).toContain('r={3.25}')
    expect(source).toContain('stroke-foreground/30')
    expect(source).toContain('indent = 14')
    expect(source).toContain('paddingLeft: RAIL_X + (item.depth ?? 0) * indent + LABEL_GAP')
    expect(source).toContain('strokeWidth="1.25"')
    expect(source).toContain('strokeDasharray="2 5"')
    expect(source).toContain('items.every((item) => item.status === "completed")')
    expect(source).toContain('data-rail-solid=""')
    expect(source).toContain('className="stroke-foreground/25"')
    expect(source).toContain('className="stroke-success"')
    expect(source).toContain('opacity={dashOpacity.get()}')
    expect(source).toContain('opacity={solidOpacity.get()}')
    expect(source).toContain('const RAIL_FADE_S = 0.25')
    expect(source).toContain('duration: RAIL_FADE_S')
    expect(source).toContain('allComplete ? "text-success" : "text-foreground"')
    expect(source).toContain('duration-[250ms]')
    expect(source).toContain('transition-[stroke]')
    expect(source).not.toContain('allComplete ? "stroke-success"')
    expect(source).not.toMatch(/strokeDasharray=\{/)
    expect(source).not.toContain('fill-success')
    expect(source).not.toContain('stroke-[5px]')
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
