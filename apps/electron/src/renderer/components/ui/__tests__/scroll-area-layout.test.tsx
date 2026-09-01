import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ScrollArea } from '../scroll-area'

describe('ScrollArea constrained content width', () => {
  it('overrides the Radix intrinsic table wrapper for vertical-only lists', () => {
    const markup = renderToStaticMarkup(
      <ScrollArea constrainContentWidth>
        <div>Long list content</div>
      </ScrollArea>,
    )

    expect(markup).toContain('!block')
    expect(markup).toContain('!w-full')
    expect(markup).toContain('!min-w-0')
    expect(markup).not.toContain('constrainContentWidth')
  })

  it('leaves other scroll areas on the Radix default layout', () => {
    const markup = renderToStaticMarkup(
      <ScrollArea>
        <div>Scrollable content</div>
      </ScrollArea>,
    )

    expect(markup).not.toContain('!block')
    expect(markup).not.toContain('!w-full')
    expect(markup).not.toContain('!min-w-0')
  })
})
