import * as React from 'react'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DEFAULT_TOOLTIP_Z_CLASS,
  ERROR_TOOLTIP_CONTENT_CLASS,
  NESTED_TOOLTIP_Z_CLASS,
  OverlayLayerProvider,
  tooltipZIndexClass,
  useOverlayLayer,
} from '../overlay-layer'

function OverlayProbe() {
  return tooltipZIndexClass(useOverlayLayer())
}

describe('overlay-layer (#254)', () => {
  it('keeps standalone tooltips on the default tooltip layer', () => {
    expect(tooltipZIndexClass(false)).toBe(DEFAULT_TOOLTIP_Z_CLASS)
    expect(renderToStaticMarkup(<OverlayProbe />)).toBe(DEFAULT_TOOLTIP_Z_CLASS)
  })

  it('elevates tooltips rendered inside a dialog overlay layer', () => {
    expect(tooltipZIndexClass(true)).toBe(NESTED_TOOLTIP_Z_CLASS)
    expect(renderToStaticMarkup(
      <OverlayLayerProvider>
        <OverlayProbe />
      </OverlayLayerProvider>,
    )).toBe(NESTED_TOOLTIP_Z_CLASS)
  })

  it('bounds long error tooltip content with wrap and scroll', () => {
    expect(ERROR_TOOLTIP_CONTENT_CLASS).toContain('max-h-[min(15rem,calc(100vh-2rem))]')
    expect(ERROR_TOOLTIP_CONTENT_CLASS).toContain('max-w-[min(24rem,calc(100vw-1.5rem))]')
    expect(ERROR_TOOLTIP_CONTENT_CLASS).toContain('overflow-y-auto')
    expect(ERROR_TOOLTIP_CONTENT_CLASS).toContain('whitespace-pre-wrap')
    expect(ERROR_TOOLTIP_CONTENT_CLASS).toContain('[overflow-wrap:anywhere]')
  })
})
