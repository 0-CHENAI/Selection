import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FreeFormInputContextBadge } from '../FreeFormInputContextBadge'

function badge(selectionChrome?: boolean) {
  return renderToStaticMarkup(
    <FreeFormInputContextBadge
      icon={<span data-icon="folder" />}
      label="forkreduce"
      isExpanded={false}
      hasSelection
      selectionChrome={selectionChrome}
    />,
  )
}

describe('working directory badge stays borderless when a folder is selected', () => {
  it('drops the filled chip and keeps the truncated name with a hover wash', () => {
    const html = badge(false)
    expect(html).toContain('forkreduce')
    expect(html).toContain('data-icon="folder"')
    expect(html).toContain('hover:bg-foreground/5')
    expect(html).not.toContain('bg-background')
    expect(html).not.toContain('border-foreground/5')
    expect(html).not.toContain('mx-0.5')
  })

  it('keeps the filled chip for other collapsed selections', () => {
    const html = badge(undefined)
    expect(html).toContain('forkreduce')
    expect(html).toContain('bg-background')
    expect(html).toContain('border-foreground/5')
    expect(html).toContain('mx-0.5')
    expect(html).not.toContain('hover:bg-foreground/5')
  })
})
