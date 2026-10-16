import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { actions } from '../../../actions/definitions'
import {
  IMMERSIVE_CHAT_MAX_WIDTH,
  immersiveDisplayWidths,
  isConversationSurface,
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
    expect(IMMERSIVE_CHAT_MAX_WIDTH).toBeGreaterThanOrEqual(840)
    expect(IMMERSIVE_CHAT_MAX_WIDTH).toBeLessThanOrEqual(1040)
  })

  it('reuses ⌘/Ctrl+B and does not exit on Escape', () => {
    expect(actions['view.toggleSidebar'].defaultHotkey).toBe('mod+b')
    expect(actions['view.toggleSidebar'].label).toBe('Immersive Mode')
    expect(actions['chat.stopProcessing'].defaultHotkey).toBe('escape')

    const appShell = read('../AppShell.tsx')
    const toggleStart = appShell.indexOf('const handleToggleImmersiveMode')
    const toggle = appShell.slice(toggleStart, appShell.indexOf('}, [])', toggleStart))
    expect(toggle).toContain('setIsImmersiveMode')
    expect(toggle).not.toMatch(/escape|Escape/)
    expect(toggle).not.toContain('setSidebarWidth')
    expect(toggle).not.toContain('setSessionListWidth')
    expect(appShell).toContain('storage.KEYS.immersiveModeEnabled')
    expect(appShell).toContain('immersive={isImmersiveMode}')
    expect(appShell).toContain('immersive={immersiveLayout}')
    expect(read('../PanelSlot.tsx')).toContain('IMMERSIVE_CHAT_MAX_WIDTH')
    expect(read('../../../../../../../packages/ui/src/components/chat/ResponseSourcesLayout.tsx')).toContain('suspended')
    expect(appShell).not.toContain('setIsSidebarVisible(v => !v)')
  })

  it('keeps the toggle in the top bar and uses one label for tooltip, menu, and shortcuts', () => {
    const topBar = read('../TopBar.tsx')
    expect(topBar).toContain('aria-label={t("menu.immersiveMode")}')
    expect(topBar).toContain('{t("menu.immersiveMode")}')
    expect(topBar).toContain('aria-pressed={immersive}')
    expect(topBar).toContain('isActive={immersive}')
    expect(topBar).not.toContain('进入沉浸模式')
    expect(topBar).not.toContain('退出沉浸模式')

    const menu = read('../../../../shared/menu-schema.ts')
    expect(menu).toContain("labelKey: 'menu.immersiveMode'")
    expect(menu).toContain("shortcut: 'CmdOrCtrl+B'")
    expect(menu).not.toContain('menu.toggleSidebar')

    const shortcuts = read('../../../pages/settings/ShortcutsPage.tsx')
    expect(shortcuts).toContain("'view.toggleSidebar': 'shortcuts.action.immersiveMode'")
  })

  it('aligns immersive locale keys and uses 沉浸模式 for the Chinese label', () => {
    const localesDir = join(import.meta.dir, '../../../../../../../packages/shared/src/i18n/locales')
    const files = readdirSync(localesDir).filter(file => file.endsWith('.json'))
    const keys = [
      'menu.immersiveMode',
      'shortcuts.action.immersiveMode',
      'chatInput.placeholder.immersiveMode',
    ]
    const removed = ['menu.toggleSidebar', 'shortcuts.action.toggleSidebar', 'chatInput.placeholder.sidebar']
    for (const file of files) {
      const messages = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of keys) expect(messages[key], `${file} ${key}`).toBeTruthy()
      for (const key of removed) expect(messages[key], `${file} ${key}`).toBeUndefined()
      expect(messages['menu.immersiveMode']).toBe(messages['shortcuts.action.immersiveMode'])
      expect(messages['chatInput.placeholder.immersiveMode']).toContain('{{key}}')
      expect(messages['menu.immersiveMode']).not.toMatch(/进入|退出|Enter|Exit/)
    }
    const zh = JSON.parse(readFileSync(join(localesDir, 'zh-Hans.json'), 'utf8')) as Record<string, string>
    expect(zh['menu.immersiveMode']).toBe('沉浸模式')
    expect(zh['shortcuts.action.immersiveMode']).toBe('沉浸模式')
    expect(zh['chatInput.placeholder.immersiveMode']).toBe('按 {{key}} + B 沉浸模式')
  })
})
