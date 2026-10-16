import * as React from 'react'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import testI18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import en from '../../../../../shared/src/i18n/locales/en.json'
import zh from '../../../../../shared/src/i18n/locales/zh-Hans.json'
import { TaskRail, type TaskRailItem } from '../TaskRail'
import {
  OPEN_NODE_RADIUS,
  RAIL_NODE_HOLE,
  RAIL_TRAVEL_SPRING,
  RAIL_TURN_SPRING,
  REACHED_NODE_RADIUS,
  buildRailPath,
  isRailNodeReached,
  lengthAtY,
  railLabelPadding,
  railTargetIndex,
  tangentAngle,
} from '../task-rail'

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

async function renderRail(items: TaskRailItem[], language: 'zh-Hans' | 'en' = 'zh-Hans') {
  await testI18n.changeLanguage(language)
  return renderToStaticMarkup(
    <I18nextProvider i18n={testI18n}>
      <TaskRail items={items} />
    </I18nextProvider>,
  )
}

const mixed: TaskRailItem[] = [
  { id: 'facts', content: '确认事实', status: 'completed' },
  { id: 'sources', content: '核对出处', status: 'interrupted', depth: 1 },
  { id: 'summary', content: '撰写摘要', status: 'in_progress', activeForm: '正在撰写摘要' },
  { id: 'appendix', content: '整理附录', status: 'pending', depth: 2 },
]

describe('rail geometry', () => {
  test('starts at the top of the first node and bends only when depth changes', () => {
    expect(buildRailPath([{ x: 5, y: 16 }, { x: 5, y: 48 }])).toBe('M 5 0 L 5 16 L 5 48')
    expect(buildRailPath([{ x: 5, y: 20 }, { x: 19, y: 60 }])).toBe('M 5 0 L 5 20 L 5 32 L 19 48 L 19 60')
    expect(buildRailPath([])).toBe('')
    expect(buildRailPath([{ x: 5, y: 16 }, { x: 19, y: 48 }, { x: 19, y: 80 }])).toBe(
      'M 5 0 L 5 16 L 5 25.6 L 19 38.4 L 19 48 L 19 80',
    )
  })

  test('uses straight M/L commands and the specified node sizes', () => {
    const path = buildRailPath([{ x: 5, y: 20 }, { x: 19, y: 60 }])
    expect(path).not.toMatch(/[CQAS]/)
    expect(RAIL_NODE_HOLE).toBe(4)
    expect(REACHED_NODE_RADIUS).toBe(3)
    expect(OPEN_NODE_RADIUS).toBe(3.25)
    expect(RAIL_TRAVEL_SPRING).toEqual({ stiffness: 140, damping: 26, mass: 0.6 })
    expect(RAIL_TURN_SPRING).toEqual({ stiffness: 260, damping: 30 })
    expect(railLabelPadding(0)).toBe(19)
    expect(railLabelPadding(2)).toBe(47)
  })

  test('finds a monotonic node length and points the plane along the tangent', () => {
    const sloped = {
      getTotalLength: () => 100,
      getPointAtLength: (length: number) => ({ x: length / 10, y: length * 0.4 }),
    }
    expect(lengthAtY(sloped, 20)).toBeCloseTo(50, 1)
    const downward = {
      getTotalLength: () => 100,
      getPointAtLength: (length: number) => ({ x: 5, y: length }),
    }
    expect(tangentAngle(downward, 40)).toBeCloseTo(180, 5)
    const rightward = {
      getTotalLength: () => 100,
      getPointAtLength: (length: number) => ({ x: length, y: 10 }),
    }
    expect(tangentAngle(rightward, 40)).toBeCloseTo(90, 5)
  })

  test('parks the plane on the current step', () => {
    expect(railTargetIndex(['completed', 'interrupted', 'in_progress', 'pending'])).toBe(2)
    expect(railTargetIndex(['completed', 'completed'])).toBe(1)
    expect(railTargetIndex(['completed', 'interrupted', 'pending'])).toBe(1)
    expect(railTargetIndex(['pending', 'pending'])).toBe(0)
    expect(railTargetIndex([])).toBe(-1)
    expect(isRailNodeReached('completed')).toBe(true)
    expect(isRailNodeReached('in_progress')).toBe(true)
    expect(isRailNodeReached('pending')).toBe(false)
    expect(isRailNodeReached('interrupted')).toBe(false)
  })
})

describe('read-only task rail', () => {
  test('shows every status in Chinese without a control', async () => {
    const html = await renderRail(mixed)
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
    expect(html).toContain('line-through')
    expect(html).toContain('text-destructive')
    expect(html).toContain('font-medium text-foreground')
    expect(html).toContain('text-foreground/50')
    expect(html).toContain('padding-left:19px')
    expect(html).toContain('padding-left:33px')
    expect(html).toContain('padding-left:47px')
    expect(html).toContain('data-readonly="true"')
    expect(html.includes('<button')).toBe(false)
    expect(html.includes('hover:')).toBe(false)
    expect(html.includes('aria-expanded')).toBe(false)
  })

  test('keeps a finished list open and uses the English title', async () => {
    const done: TaskRailItem[] = mixed.map(item => ({ ...item, status: 'completed' as const, activeForm: undefined }))
    const html = await renderRail(done)
    expect(html).toContain(zh['taskList.allCompleted'])
    expect(html).toContain('撰写摘要')
    expect(html).toContain('整理附录')
    expect(html.includes('<button')).toBe(false)
    expect(await renderRail([{ id: 'a', content: 'Confirm', status: 'pending' }], 'en')).toContain(en['taskList.title'])
    expect(await renderRail([])).toBe('')
  })

  test('does not listen for clicks, hover, or scroll', () => {
    const source = readFileSync(new URL('../TaskRail.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/onClick|onMouse|onPointer|onKey|hover:|<button|addEventListener|scroll/)
  })
})
