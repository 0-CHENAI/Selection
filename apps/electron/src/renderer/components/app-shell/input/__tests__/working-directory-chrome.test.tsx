import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let FreeFormInputContextBadge: typeof import('../FreeFormInputContextBadge').FreeFormInputContextBadge
let ChatWorkingDirectoryControl: typeof import('../ChatWorkingDirectoryControl').ChatWorkingDirectoryControl
let ProjectWorkingDirectoryMark: typeof import('../ProjectWorkingDirectoryMark').ProjectWorkingDirectoryMark
let TooltipProvider: typeof import('@craft-agent/ui').TooltipProvider
let ModalProvider: typeof import('@/context/ModalContext').ModalProvider

beforeAll(async () => {
  ;({ FreeFormInputContextBadge } = await import('../FreeFormInputContextBadge'))
  ;({ ChatWorkingDirectoryControl } = await import('../ChatWorkingDirectoryControl'))
  ;({ ProjectWorkingDirectoryMark } = await import('../ProjectWorkingDirectoryMark'))
  ;({ TooltipProvider } = await import('@craft-agent/ui'))
  ;({ ModalProvider } = await import('@/context/ModalContext'))
})

describe('ordinary chat folder actions', () => {
  function control(directory?: string, root?: string, disabled = false) {
    return renderToStaticMarkup(<TooltipProvider><ModalProvider>
      <ChatWorkingDirectoryControl workingDirectory={directory} sessionFolderPath={root} disabled={disabled} onWorkingDirectoryChange={() => {}} />
    </ModalProvider></TooltipProvider>)
  }

  it('shows one directly actionable picker for an empty or opted-out draft and a session root', () => {
    for (const [directory, root] of [[undefined, undefined], ['none', undefined], ['/session', '/session']]) {
      const html = control(directory, root)
      expect(html.match(/<button /g)).toHaveLength(1)
      expect(html).not.toContain('working-directory-control-clear')
      expect(html).not.toContain('aria-haspopup="menu"')
    }
  })

  it('renders independent named buttons and isolates the long folder label for masking', () => {
    const html = control('/work/long-folder-name')
    expect(html.match(/<button /g)).toHaveLength(2)
    expect(html).toContain('aria-label="chat.clearWorkingDirectory"')
    expect(html).toContain('working-directory-control-label')
    expect(html).toContain('border-0 bg-transparent')
    expect(html).toContain('long-folder-name')
  })

  it('disables both actions during processing', () => {
    expect(control('/work/chosen', undefined, true).match(/disabled=""/g)).toHaveLength(2)
  })

  it('keeps the project mark read-only with no cancellation action', () => {
    const html = renderToStaticMarkup(<TooltipProvider><ProjectWorkingDirectoryMark workingDirectory="/project/fixed" /></TooltipProvider>)
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('working-directory-control-clear')
  })
})

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
