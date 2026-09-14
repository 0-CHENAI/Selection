import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
  THOUGHT_CANVAS_EDITOR_CLASS,
  THOUGHT_CANVAS_EDITOR_TEST_ID,
  THOUGHT_CANVAS_NARROW_EDITOR_MIN_PX,
  THOUGHT_CANVAS_SPLIT_CLASS,
  THOUGHT_CANVAS_SPLIT_TEST_ID,
  THOUGHT_CANVAS_STAGE_CLASS,
  THOUGHT_CANVAS_STAGE_TEST_ID,
  THOUGHT_CANVAS_TOOLBAR_CLASS,
  THOUGHT_CANVAS_TOOLBAR_TEST_ID,
} from '../thought-canvas-layout'

const canvas = readFileSync(join(import.meta.dir, '../ThoughtCanvas.tsx'), 'utf8')

describe('ThoughtCanvas narrow layout contract', () => {
  it('uses the shared split/stage/editor classes and test ids', () => {
    expect(canvas).toContain('THOUGHT_CANVAS_SPLIT_TEST_ID')
    expect(canvas).toContain('THOUGHT_CANVAS_STAGE_TEST_ID')
    expect(canvas).toContain('THOUGHT_CANVAS_EDITOR_TEST_ID')
    expect(canvas).toContain('THOUGHT_CANVAS_SPLIT_CLASS')
    expect(canvas).toContain('THOUGHT_CANVAS_STAGE_CLASS')
    expect(canvas).toContain('THOUGHT_CANVAS_EDITOR_CLASS')
    expect(canvas).toContain('THOUGHT_CANVAS_TOOLBAR_TEST_ID')
    expect(canvas).toContain('THOUGHT_CANVAS_TOOLBAR_CLASS')
    expect(THOUGHT_CANVAS_TOOLBAR_TEST_ID).toBe('thought-canvas-toolbar')
    expect(THOUGHT_CANVAS_SPLIT_TEST_ID).toBe('thought-canvas-split')
    expect(THOUGHT_CANVAS_STAGE_TEST_ID).toBe('thought-canvas-stage')
    expect(THOUGHT_CANVAS_EDITOR_TEST_ID).toBe('thought-canvas-editor')
  })

  it('keeps the stacked pane scrollable and gives the editor a usable min height', () => {
    expect(THOUGHT_CANVAS_SPLIT_CLASS).toContain('overflow-y-auto')
    expect(THOUGHT_CANVAS_SPLIT_CLASS).toContain('content-start')
    expect(THOUGHT_CANVAS_STAGE_CLASS).toContain('h-64')
    expect(THOUGHT_CANVAS_STAGE_CLASS).not.toContain('min-h-72')
    expect(THOUGHT_CANVAS_EDITOR_CLASS).toContain('min-h-80')
    expect(THOUGHT_CANVAS_NARROW_EDITOR_MIN_PX).toBe(320)
    expect(THOUGHT_CANVAS_TOOLBAR_CLASS).toContain('shrink-0')
    expect(THOUGHT_CANVAS_TOOLBAR_CLASS).not.toContain('flex-wrap')
    expect(canvas).toContain("t('common.more')")
    expect(canvas).not.toContain('flex flex-wrap items-center gap-2')
  })
})
