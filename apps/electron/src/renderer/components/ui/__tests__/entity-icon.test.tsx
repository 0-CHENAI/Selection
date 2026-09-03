import * as React from 'react'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DatabaseZap } from 'lucide-react'

import { EntityIcon } from '../entity-icon'

describe('EntityIcon chromeless rendering', () => {
  it('removes container chrome while preserving emoji sizing', () => {
    const html = renderToStaticMarkup(
      <EntityIcon
        icon={{ kind: 'emoji', value: '🧠', colorable: false }}
        size="sm"
        fallbackIcon={DatabaseZap}
        chromeless
      />,
    )

    expect(html).toContain('h-4 w-4')
    expect(html).toContain('text-[11px]')
    expect(html).not.toContain('ring-1')
    expect(html).not.toContain('bg-muted')
    expect(html).not.toContain('rounded-[4px]')
  })

  it('removes container chrome from custom images while preserving dimensions', () => {
    const html = renderToStaticMarkup(
      <EntityIcon
        icon={{ kind: 'file', value: 'https://example.com/icon.png', colorable: false }}
        size="sm"
        fallbackIcon={DatabaseZap}
        chromeless
      />,
    )

    expect(html).toContain('h-4 w-4')
    expect(html).not.toContain('ring-1')
    expect(html).not.toContain('bg-muted')
    expect(html).not.toContain('rounded-[4px]')
  })

  it('removes container chrome from the default MCP icon while preserving dimensions', () => {
    const html = renderToStaticMarkup(
      <EntityIcon
        icon={{ kind: 'fallback', colorable: false }}
        size="sm"
        fallbackIcon={DatabaseZap}
        chromeless
      />,
    )

    expect(html).toContain('h-4 w-4')
    expect(html).not.toContain('ring-1')
    expect(html).not.toContain('bg-muted')
    expect(html).not.toContain('rounded-[4px]')
  })
})

describe('EntityIcon bare rendering', () => {
  it('removes container chrome from custom raster images', () => {
    const html = renderToStaticMarkup(
      <EntityIcon
        icon={{ kind: 'file', value: 'https://example.com/icon.png', colorable: false }}
        size="sm"
        fallbackIcon={DatabaseZap}
        bare
      />,
    )

    expect(html).toContain('h-4 w-4')
    expect(html).not.toContain('ring-1')
    expect(html).not.toContain('bg-muted')
    expect(html).not.toContain('rounded-[4px]')
  })
})
