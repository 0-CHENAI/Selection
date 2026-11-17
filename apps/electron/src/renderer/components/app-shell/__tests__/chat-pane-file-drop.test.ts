import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { ChatPaneDropOverlay } from '../ChatPaneFileDrop'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

describe('chat pane file drop', () => {
  it('wraps the main chat column including the title bar and composer', () => {
    const chatPage = read('../../../pages/ChatPage.tsx')
    const wraps = chatPage.split('<ChatPaneFileDrop>').length - 1
    expect(wraps).toBe(2)
    expect(chatPage).toContain('</ChatPaneFileDrop>')
    const missing = chatPage.slice(
      chatPage.indexOf('sessionNoLongerExists') - 280,
      chatPage.indexOf('sessionNoLongerExists') + 80,
    )
    expect(missing).toContain('chat.sessionNoLongerExists')
    expect(missing).not.toContain('ChatPaneFileDrop')
  })

  it('reuses the composer ingest path instead of a parallel attachment reader', () => {
    const input = read('../input/FreeFormInput.tsx')
    expect(input).toContain('useComposerFileDropSink')
    expect(input).toContain('ingestDroppedFiles')
    expect(input).toContain('droppedFilesFromDataTransfer')
    expect(input).toContain('data-composer-file-drop=""')
    expect(input).toContain('await ingestDroppedFiles(droppedFilesFromDataTransfer(e.dataTransfer))')
    expect(input.match(/readFileAsAttachment/g)?.length).toBeGreaterThan(1)
  })

  it('keeps the existing composer drop zone and only highlights external file drags', () => {
    const input = read('../input/FreeFormInput.tsx')
    const pane = read('../ChatPaneFileDrop.tsx')
    expect(input).toContain('onDrop={handleDrop}')
    expect(input).toContain('hasFileDragType(e.dataTransfer.types)')
    expect(pane).toContain('hasFileDragType(event.dataTransfer.types)')
    expect(pane).toContain('event.target.closest(`[${COMPOSER_FILE_DROP_ATTR}]`)')
    expect(pane).toContain('onDropCapture={handleDropCapture}')
    expect(pane).toContain('onDragEnterCapture={handleDragEnterCapture}')
  })

  it('shows a localized drop hint and clears on drop, leave, escape, or cancel', () => {
    const pane = read('../ChatPaneFileDrop.tsx')
    expect(pane).toContain("t('chat.dropToAttach')")
    expect(pane).toContain('data-testid="chat-pane-file-drop-overlay"')
    expect(pane).toContain('shouldResetFileDragOnLeave')
    expect(pane).toContain("event.key !== 'Escape'")
    expect(pane).toContain("window.addEventListener('dragend', onDragEnd)")
    expect(pane).toContain("window.addEventListener('blur', onBlur)")
    expect(LOCALE_REGISTRY['zh-Hans'].messages['chat.dropToAttach']).toBe('松开光标以放入文件')
    expect(LOCALE_REGISTRY.en.messages['chat.dropToAttach']).toBe('Release to drop files')
    expect(pane).toContain('createPaneDropPlayer')
    expect(pane).toContain('playEnter')
    expect(pane).toContain('playLeave')
    expect(pane).toContain('playAccept')
    expect(pane).toContain('acceptThenLeave')
    expect(pane).toContain('backdrop-blur-[16px]')
    expect(pane).toContain("from '@/components/ui/folder-component'")
    expect(pane).toContain('hovered={folderHovered}')
    expect(pane).toContain('open={folderOpen}')
    expect(pane).toContain('setFolderHovered(true)')
    expect(pane).toContain('setFolderOpen(true)')
    expect(pane).toContain('useFolderThemeColor')
    expect(pane).toContain('MutationObserver')
    expect(pane).toContain("'white' : 'black'")
    expect(pane).toContain('color={folderColor}')
    expect(pane).not.toContain('color="blue"')
    expect(pane).not.toContain('FileUp')
    expect(pane).not.toContain('AnimatePresence')
    expect(pane).not.toContain('border-dashed')
  })

  it('animates blur, staggered hint, reverse leave, and a distinct drop accept', () => {
    const motion = read('../pane-drop-overlay-motion.ts')
    expect(motion).toContain('[0.22, 1, 0.36, 1]')
    expect(motion).toContain('PANE_DROP_HINT_DELAY')
    expect(motion).toContain('control.stop()')
    expect(motion).toContain('acceptThenLeave')
    expect(motion).toContain('hintScale')
    expect(motion).toContain('animate(values.blur')
    expect(motion).toContain('delay: hintDelay')
    const pane = read('../ChatPaneFileDrop.tsx')
    expect(pane).toContain('blur(${value}px)')
    expect(pane).toContain('will-change-[opacity,transform]')
    expect(motion).toContain('PANE_DROP_ACCEPT_HOLD')
  })

  it('keeps Rare UI copyright in the copied Folder source', () => {
    const folder = read('../../ui/folder-component.tsx')
    expect(folder).toContain('Copyright (c) 2026 Swami Malode')
    expect(folder).toContain('https://rareui.com')
    expect(folder).toContain('Commons Clause')
    expect(folder).toContain('hovered?: boolean')
    expect(folder).toContain('open?: boolean')
  })

  it('renders a frosted overlay with a Rare UI folder, hint, and no pointer capture', () => {
    const html = renderToStaticMarkup(ChatPaneDropOverlay({ hint: '松开光标以放入文件' }))
    expect(html).toContain('松开光标以放入文件')
    expect(html).toContain('data-testid="chat-pane-file-drop-overlay"')
    expect(html).toContain('pointer-events-none')
    expect(html).toContain('backdrop-blur-[16px]')
    expect(html).toContain('data-slot="folder"')
    expect(html).toContain('data-folder-color="black"')
    expect(html).not.toContain('#50B1FD')
    expect(html).not.toContain('border-dashed')
    expect(html).toContain('flex-col')
  })

  it('credits Rare UI in the repository README', () => {
    const readme = readFileSync(join(import.meta.dir, '../../../../../../../README.md'), 'utf8')
    expect(readme).toContain('Folder animation from [Rare UI](https://rareui.com)')
  })

  it('installs a window-level guard so Electron cannot navigate to a dropped file', () => {
    const main = read('../../../main.tsx')
    expect(main).toContain('installExternalFileWindowGuard()')
  })
})
