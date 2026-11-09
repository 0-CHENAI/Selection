import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergePreviewHeaderStyle } from '../PreviewHeader'

describe('preview header Windows caption inset (#356)', () => {
  it('reserves the overlay caption strip without replacing caller styles', () => {
    expect(mergePreviewHeaderStyle(48, undefined)).toEqual({ height: 48 })
    expect(mergePreviewHeaderStyle(48, '138px')).toEqual({
      height: 48,
      paddingRight: '138px',
    })
    const callerStyle = { paddingRight: '12px', zIndex: 'var(--z-local, 10)' }
    expect(mergePreviewHeaderStyle(48, '138px', callerStyle)).toEqual({
      height: 48,
      ...callerStyle,
    })
  })

  it('reads the platform inset in PreviewHeader used by image preview', () => {
    const header = readFileSync(join(import.meta.dir, '../PreviewHeader.tsx'), 'utf8')
    const imagePreview = readFileSync(
      join(import.meta.dir, '../../overlay/ImagePreviewOverlay.tsx'),
      'utf8',
    )
    const overlayHeader = readFileSync(
      join(import.meta.dir, '../../overlay/FullscreenOverlayBaseHeader.tsx'),
      'utf8',
    )
    expect(header).toContain('windowsCaptionInsetPadding')
    expect(header).toContain('mergePreviewHeaderStyle')
    expect(overlayHeader).toContain('PreviewHeader')
    expect(imagePreview).toContain('PreviewOverlay')
  })
})
