import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { actions } from '../../../actions/definitions'
import {
  immersiveDisplayWidths,
  immersiveTogglePressed,
  isConversationSurface,
  nextImmersiveToggle,
  readImmersivePreference,
  shouldApplyImmersiveLayout,
} from '../immersive-mode'
import type { NavigationState } from '../../../../shared/types'

function read(relative: string): string {
  return readFileSync(join(import.meta.dir, relative), 'utf8')
}

const sessionNav = { navigator: 'sessions', filter: { kind: 'allSessions' }, details: null } as NavigationState
const boardNav = { ...sessionNav, viewMode: 'board' } as NavigationState
const settingsNav = { navigator: 'settings', subpage: 'app' } as NavigationState

describe('immersive mode layout', () => {
  it('collapses only a conversation, and leaves settings, board, compact, and multi-select alone', () => {
    const base = { enabled: true, isConversation: true, isCompact: false, isMultiSelect: false }
    expect(shouldApplyImmersiveLayout(base)).toBe(true)
    expect(shouldApplyImmersiveLayout({ ...base, enabled: false })).toBe(false)
    expect(shouldApplyImmersiveLayout({ ...base, isConversation: false })).toBe(false)
    expect(shouldApplyImmersiveLayout({ ...base, isCompact: true })).toBe(false)
    expect(shouldApplyImmersiveLayout({ ...base, isMultiSelect: true })).toBe(false)
    expect(isConversationSurface(sessionNav)).toBe(true)
    expect(isConversationSurface({ navigator: 'sessions', filter: { kind: 'allSessions' }, details: { type: 'session', sessionId: 's1' } })).toBe(true)
    expect(isConversationSurface(boardNav)).toBe(false)
    expect(isConversationSurface(settingsNav)).toBe(false)
    expect(isConversationSurface(null)).toBe(false)
  })

  it('hides columns without rewriting the stored widths', () => {
    const stored = { sidebar: 220, navigator: 300 }
    expect(immersiveDisplayWidths(stored, true)).toEqual({ sidebar: 0, navigator: 0 })
    expect(stored).toEqual({ sidebar: 220, navigator: 300 })
    expect(immersiveDisplayWidths(stored, false)).toBe(stored)
  })

  it('fills the window with the conversation card and keeps the reading column inside it', () => {
    const panel = read('../PanelSlot.tsx')
    const stack = read('../PanelStackContainer.tsx')
    const chat = read('../ChatDisplay.tsx')
    const input = read('../input/ChatInputZone.tsx')
    const layout = read('../../../../../../../packages/ui/src/lib/layout.ts')
    const mode = read('../immersive-mode.ts')
    expect(mode).not.toContain('960')
    expect(panel).not.toContain('data-immersive-cap')
    expect(panel).not.toContain('max-w-[960px]')
    expect(panel).toContain('flexGrow: 1')
    expect(panel).toContain('minWidth: 0')
    expect(stack).toContain('className="flex h-full w-full"')
    expect(stack).not.toContain('w-full justify-center')
    expect(layout).toContain("maxWidth: 'max-w-[840px]'")
    expect(layout).toContain('composerColumn:')
    expect(chat).toContain('CHAT_LAYOUT.maxWidth')
    expect(chat).toContain('mx-auto min-w-0')
    expect(input).toContain('CHAT_CLASSES.composerColumn')
  })

  it('pushes side and trailing panels with one spring, and skips it while dragging or reducing motion', () => {
    const stack = read('../PanelStackContainer.tsx')
    const office = read('../OfficePreviewPanel.tsx')
    const sources = read('../../../../../../../packages/ui/src/components/chat/ResponseSourcesLayout.tsx')
    const motion = read('../../../../../../../packages/ui/src/lib/panel-motion.ts')
    expect(motion).toContain('export function panelPushTransition')
    expect(stack).toContain('useReducedMotion')
    expect(stack).toContain('panelPushTransition(reduceMotion)')
    expect(stack).toContain('isResizing || isCompact')
    expect(stack).toContain('duration: 0')
    expect(office).toContain('panelPushTransition(reduceMotion)')
    expect(office).toContain('var(--office-panel-open, 0)')
    expect(office).toContain('marginLeft: PANEL_GAP')
    expect(office).toContain('right-0')
    expect(office).not.toContain("'--office-panel-open': open ? 1 : 0, opacity")
    expect(sources).toContain('animate(openFraction')
    expect(sources).toContain('pixelWidth.set(sourceColumnWidth(panelWidth))')
    expect(sources).toContain('marginLeft: SOURCE_PANEL_GAP_PX')
    expect(sources).toContain('right-0')
    expect(sources).toContain('useReducedMotion')
    expect(sources).not.toContain('animate={{ width:')
  })

  it('treats ⌘+. and ⌘/Ctrl+B as one switch and folds the old focus flag in', () => {
    expect(readImmersivePreference({ immersive: false, legacyFocus: false })).toBe(false)
    expect(readImmersivePreference({ immersive: true, legacyFocus: false })).toBe(true)
    expect(readImmersivePreference({ immersive: false, legacyFocus: true })).toBe(true)
    expect(nextImmersiveToggle({ immersive: false, launchHidden: false })).toEqual({ immersive: true, launchHidden: false })
    expect(nextImmersiveToggle({ immersive: true, launchHidden: false })).toEqual({ immersive: false, launchHidden: false })
    expect(nextImmersiveToggle({ immersive: false, launchHidden: true })).toEqual({ immersive: false, launchHidden: false })
    expect(immersiveTogglePressed({ immersive: false, launchHidden: true })).toBe(true)
    expect(immersiveTogglePressed({ immersive: true, launchHidden: false })).toBe(true)
    expect(immersiveTogglePressed({ immersive: false, launchHidden: false })).toBe(false)
  })

  it('reuses ⌘/Ctrl+B and ⌘+. and does not exit on Escape', () => {
    expect(actions['view.toggleSidebar'].defaultHotkey).toBe('mod+b')
    expect(actions['view.toggleSidebar'].label).toBe('Immersive Mode')
    expect(actions['view.toggleSidebar'].description).toMatch(/left navigation/i)
    expect(actions['view.toggleSidebar'].description).not.toMatch(/only the conversation/i)
    expect(actions['view.toggleFocusMode'].defaultHotkey).toBe('mod+.')
    expect(actions['view.toggleFocusMode'].label).toBe('Immersive Mode')
    expect(actions['chat.stopProcessing'].defaultHotkey).toBe('escape')

    const appShell = read('../AppShell.tsx')
    const toggleStart = appShell.indexOf('const handleToggleImmersiveMode')
    const toggle = appShell.slice(toggleStart, appShell.indexOf('}, [isImmersiveMode, isSidebarAndNavigatorHidden])', toggleStart))
    expect(toggle).toContain('nextImmersiveToggle')
    expect(toggle).not.toMatch(/escape|Escape/)
    expect(toggle).not.toContain('setSidebarWidth')
    expect(toggle).not.toContain('setSessionListWidth')
    expect(appShell).toContain("useAction('view.toggleSidebar', handleToggleImmersiveMode)")
    expect(appShell).toContain("useAction('view.toggleFocusMode', handleToggleImmersiveMode)")
    expect(appShell).toContain('storage.KEYS.immersiveModeEnabled')
    expect(appShell).toContain('immersive={immersivePressed}')
    expect(appShell).toContain('immersive={immersiveLayout}')
    expect(appShell).not.toContain('setIsSidebarAndNavigatorHidden(v => !v)')
    const panel = read('../PanelSlot.tsx')
    expect(panel).toContain('data-immersive-layout')
    expect(panel).not.toContain('data-immersive-cap')
    expect(panel).not.toContain('immersivePanelMaxWidth')
    const chat = read('../../../pages/ChatPage.tsx')
    expect(chat).not.toContain('suspended={immersiveLayout}')
    expect(chat).not.toContain('immersiveLayoutActiveAtom')
    const app = read('../../../App.tsx')
    expect(app).not.toContain('immersiveLayout')
    expect(app).toContain('hasTrailingPanel={officePreviewPresent}')
    expect(appShell).not.toContain('setIsSidebarVisible(v => !v)')
  })

  it('keeps the toggle in the top bar and uses one label for tooltip, menu, and shortcuts', () => {
    const topBar = read('../TopBar.tsx')
    expect(topBar).toContain('aria-label={t("menu.immersiveMode")}')
    expect(topBar).toContain('{t("menu.immersiveMode")}')
    expect(topBar).toContain('aria-pressed={immersive}')
    expect(topBar).toContain('isActive={immersive}')
    expect(topBar).toContain('<PanelLeftRounded className="h-[18px] w-[18px] text-foreground/70" />')
    expect(topBar).not.toContain('ImmersiveModeIcon')
    expect(topBar).not.toContain('进入沉浸模式')
    expect(topBar).not.toContain('退出沉浸模式')

    const menu = read('../../../../shared/menu-schema.ts')
    expect(menu).toContain("labelKey: 'menu.immersiveMode'")
    expect(menu).toContain("icon: 'PanelLeft'")
    expect(menu).not.toContain('RectangleHorizontal')
    expect(menu).toContain("shortcut: 'CmdOrCtrl+B'")
    expect(menu).not.toContain('menu.toggleSidebar')
    expect(menu).not.toContain('menu.toggleFocusMode')
    expect(menu).not.toContain("shortcut: 'CmdOrCtrl+.'")

    const shortcuts = read('../../../pages/settings/ShortcutsPage.tsx')
    expect(shortcuts).toContain("'view.toggleSidebar': 'shortcuts.action.immersiveMode'")
    expect(shortcuts).toContain("'view.toggleFocusMode': 'shortcuts.action.immersiveMode'")
    expect(shortcuts).toContain('shortcuts.action.immersiveMode.description')
  })

  it('aligns immersive locale keys and uses 沉浸模式 for the Chinese label', () => {
    const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
    const files = readdirSync(localesDir).filter(file => file.endsWith('.json'))
    const keys = [
      'menu.immersiveMode',
      'shortcuts.action.immersiveMode',
      'shortcuts.action.immersiveMode.description',
      'chatInput.placeholder.immersiveMode',
    ]
    const removed = ['menu.toggleSidebar', 'shortcuts.action.toggleSidebar', 'chatInput.placeholder.sidebar']
    for (const file of files) {
      const messages = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of keys) expect(messages[key], `${file} ${key}`).toBeTruthy()
      for (const key of removed) expect(messages[key], `${file} ${key}`).toBeUndefined()
      expect(messages['menu.immersiveMode']).toBe(messages['shortcuts.action.immersiveMode'])
      expect(messages['menu.toggleFocusMode']).toBe(messages['menu.immersiveMode'])
      expect(messages['shortcuts.action.toggleFocusMode']).toBe(messages['shortcuts.action.immersiveMode'])
      expect(messages['chatInput.placeholder.immersiveMode']).toContain('{{key}}')
      expect(messages['chatInput.placeholder.focusMode']).toContain('{{key}}')
      expect(messages['menu.immersiveMode']).not.toMatch(/进入|退出|Enter|Exit/)
      expect(messages['shortcuts.action.immersiveMode.description']).not.toMatch(/只显示对话|only the conversation|Show only/i)
      expect(messages['chatInput.placeholder.focusMode']).not.toMatch(/专注|Focus Mode|フォーカス|Fokus|enfoque|skupienia|fókusz/i)
    }
    const zh = JSON.parse(readFileSync(join(localesDir, 'zh-Hans.json'), 'utf8')) as Record<string, string>
    expect(zh['menu.immersiveMode']).toBe('沉浸模式')
    expect(zh['shortcuts.action.immersiveMode']).toBe('沉浸模式')
    expect(zh['chatInput.placeholder.immersiveMode']).toBe('按 {{key}} + B 沉浸模式')
    expect(zh['chatInput.placeholder.focusMode']).toBe('按 {{key}} + . 沉浸模式')
    expect(zh['shortcuts.action.immersiveMode.description']).toContain('隐藏左侧')
  })
})
