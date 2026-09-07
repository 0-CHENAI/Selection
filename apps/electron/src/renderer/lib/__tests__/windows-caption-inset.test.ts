import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveWindowsCaptionInsetStyle,
  WINDOWS_CAPTION_INSET_PADDING,
} from '../windows-caption-inset'

describe('Windows caption inset (#260)', () => {
  it('reserves the overlay caption-button strip only on Windows desktop', () => {
    expect(resolveWindowsCaptionInsetStyle(false, false)).toBeUndefined()
    expect(resolveWindowsCaptionInsetStyle(true, true)).toBeUndefined()
    expect(resolveWindowsCaptionInsetStyle(true, false)).toEqual({
      paddingRight: WINDOWS_CAPTION_INSET_PADDING,
    })
    expect(WINDOWS_CAPTION_INSET_PADDING).toContain('titlebar-area-x')
    expect(WINDOWS_CAPTION_INSET_PADDING).toContain('titlebar-area-width')
  })

  it('applies the inset on the fused top bar and workspace-creation header', () => {
    const topBar = readFileSync(join(import.meta.dir, '../../components/app-shell/TopBar.tsx'), 'utf8')
    const workspace = readFileSync(
      join(import.meta.dir, '../../components/workspace/WorkspaceCreationScreen.tsx'),
      'utf8',
    )
    expect(topBar).toContain('windowsCaptionInsetStyle')
    expect(topBar).toContain('titlebar-drag-region')
    expect(topBar).toContain('titlebar-no-drag')
    expect(workspace).toContain('windowsCaptionInsetStyle')
  })
})
