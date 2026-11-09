import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EntityList } from '../entity-list'

describe('EntityList width constraints', () => {
  it('keeps its layout constraints when container attributes include a class name', () => {
    const markup = renderToStaticMarkup(
      <EntityList
        items={[{ id: 'skill-1' }]}
        getKey={(item) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
        containerProps={{
          className: 'consumer-class',
          role: 'listbox',
          'data-list-role': 'skills',
        }}
      />,
    )

    expect(markup).toContain('consumer-class')
    expect(markup).toContain('overflow-x-hidden')
    expect(markup).toContain('data-list-role="skills"')
    expect(markup).toContain('role="listbox"')
  })

  it('applies the same width boundary to the empty state', () => {
    const markup = renderToStaticMarkup(
      <EntityList
        items={[]}
        getKey={(item: { id: string }) => item.id}
        renderItem={(item) => <div>{item.id}</div>}
        emptyState={<div>No skills</div>}
      />,
    )

    expect(markup).toContain('min-w-0')
    expect(markup).toContain('max-w-full')
    expect(markup).toContain('overflow-x-hidden')
  })
})
