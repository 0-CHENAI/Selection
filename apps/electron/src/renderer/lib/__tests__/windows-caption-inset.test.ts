import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolveWindowsCaptionEdgeStyle,
  resolveWindowsCaptionInsetStyle,
  WINDOWS_CAPTION_INSET_PADDING,
} from '../windows-caption-inset'

describe('Windows caption inset (#260, #356, #359)', () => {
  it('reserves the overlay caption-button strip only on Windows desktop', () => {
    expect(resolveWindowsCaptionInsetStyle(false, false)).toBeUndefined()
    expect(resolveWindowsCaptionInsetStyle(true, true)).toBeUndefined()
    expect(resolveWindowsCaptionInsetStyle(true, false)).toEqual({
      paddingRight: WINDOWS_CAPTION_INSET_PADDING,
    })
    expect(resolveWindowsCaptionEdgeStyle(true, false)).toEqual({
      right: WINDOWS_CAPTION_INSET_PADDING,
    })
    expect(resolveWindowsCaptionEdgeStyle(true, true)).toBeUndefined()
    expect(WINDOWS_CAPTION_INSET_PADDING).toContain('titlebar-area-x')
    expect(WINDOWS_CAPTION_INSET_PADDING).toContain('titlebar-area-width')
  })

  it('applies the inset on the fused top bar and workspace-creation header', () => {
    const topBar = readFileSync(join(import.meta.dir, '../../components/app-shell/TopBar.tsx'), 'utf8')
    const workspace = readFileSync(
      join(import.meta.dir, '../../components/workspace/WorkspaceCreationScreen.tsx'),
      'utf8',
    )
    expect(topBar).toContain('windowsCaptionEdgeStyle')
    expect(topBar).toContain('titlebar-drag-region')
    expect(topBar).toContain('titlebar-no-drag')
    expect(workspace).toContain('windowsCaptionInsetStyle')
  })

  it('feeds the same inset into overlay preview headers (#356)', () => {
    const app = readFileSync(join(import.meta.dir, '../../App.tsx'), 'utf8')
    expect(app).toContain('windowsCaptionInsetStyle')
    expect(app).toContain('windowsCaptionInsetPadding')
  })

  it('keeps fullscreen close and onboarding drag regions off the caption strip (#359)', () => {
    const onboarding = readFileSync(
      join(import.meta.dir, '../../components/onboarding/OnboardingWizard.tsx'),
      'utf8',
    )
    const reauth = readFileSync(
      join(import.meta.dir, '../../components/onboarding/ReauthScreen.tsx'),
      'utf8',
    )
    const picker = readFileSync(
      join(import.meta.dir, '../../components/workspace/WorkspacePicker.tsx'),
      'utf8',
    )
    const aiSettings = readFileSync(
      join(import.meta.dir, '../../pages/settings/AiSettingsPage.tsx'),
      'utf8',
    )
    expect(onboarding).toContain('windowsCaptionEdgeStyle')
    expect(reauth).toContain('windowsCaptionEdgeStyle')
    expect(picker).toContain('windowsCaptionEdgeStyle')
    expect(aiSettings).toContain('windowsCaptionEdgeStyle')
  })

  it('drops Windows toasts below the caption buttons', () => {
    const toaster = readFileSync(join(import.meta.dir, '../../components/ui/sonner.tsx'), 'utf8')
    expect(toaster).toContain("offset={props.offset ?? (isWindows && !isWebUI ? { top: '96px', right: '16px' } : undefined)}")
  })
})

