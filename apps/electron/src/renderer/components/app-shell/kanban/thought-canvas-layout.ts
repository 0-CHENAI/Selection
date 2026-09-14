/** Layout contract for ThoughtCanvas split view. Keep preview / measurement in sync. */
export const THOUGHT_CANVAS_SPLIT_TEST_ID = 'thought-canvas-split'
export const THOUGHT_CANVAS_STAGE_TEST_ID = 'thought-canvas-stage'
export const THOUGHT_CANVAS_EDITOR_TEST_ID = 'thought-canvas-editor'

/** Narrow stacked pane: scroll the split instead of letting min-h-72 crush the editor. */
export const THOUGHT_CANVAS_SPLIT_CLASS =
  'grid min-h-0 flex-1 grid-cols-1 content-start gap-2 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:grid-rows-[minmax(0,1fr)] lg:content-stretch lg:overflow-hidden'

export const THOUGHT_CANVAS_STAGE_CLASS =
  'relative h-64 w-full shrink-0 overflow-hidden rounded-lg border bg-background lg:h-auto lg:min-h-0'

export const THOUGHT_CANVAS_EDITOR_CLASS =
  'flex min-h-80 w-full shrink-0 flex-col gap-3 overflow-auto rounded-lg border bg-card p-3 lg:min-h-0'

export const THOUGHT_CANVAS_TOOLBAR_TEST_ID = 'thought-canvas-toolbar'
export const THOUGHT_CANVAS_TOOLBAR_CLASS =
  'flex h-8 shrink-0 items-center gap-1 overflow-hidden'

/** Pre-fix classes that collapsed the aside to ~24px at 800×700. */
export const THOUGHT_CANVAS_SPLIT_CLASS_LEGACY =
  'grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]'
export const THOUGHT_CANVAS_STAGE_CLASS_LEGACY =
  'relative min-h-72 overflow-hidden rounded-lg border bg-background'
export const THOUGHT_CANVAS_EDITOR_CLASS_LEGACY =
  'flex min-h-0 flex-col gap-3 overflow-auto rounded-lg border bg-card p-3'

export const THOUGHT_CANVAS_NARROW_STAGE_PX = 256
export const THOUGHT_CANVAS_NARROW_EDITOR_MIN_PX = 320
