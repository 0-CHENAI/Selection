/**
 * Browser Toolbar — React entry point
 *
 * Renders the shared BrowserControls component inside a chromeless
 * BrowserWindow. Communicates with the main process via a dedicated
 * preload script (browser-toolbar preload).
 */

import React, { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom/client'
import { useTranslation, initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { setupI18n } from '@craft-agent/shared/i18n'
import { EyeOff, X } from 'lucide-react'
import { BrowserControls } from '@craft-agent/ui'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import './index.css'

// This is a standalone entry (browser-toolbar.html) — i18n must be initialized
// here or BrowserControls and the window actions render raw translation keys.
setupI18n([LanguageDetector, initReactI18next])

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ToolbarState {
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  themeColor?: string | null
}

declare global {
  interface Window {
    browserToolbar: {
      instanceId: string
      navigate: (url: string) => Promise<void>
      goBack: () => Promise<void>
      goForward: () => Promise<void>
      reload: () => Promise<void>
      stop: () => Promise<void>
      hideWindow: () => Promise<void>
      closeWindowEntirely: () => Promise<void>
      onStateUpdate: (callback: (state: ToolbarState) => void) => () => void
      onThemeColor: (callback: (color: string | null) => void) => () => void
    }
  }
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

function BrowserToolbarApp() {
  const { t } = useTranslation()
  const [state, setState] = useState<ToolbarState>({
    url: 'about:blank',
    title: 'New Tab',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
  })
  const [themeColor, setThemeColor] = useState<string | null>(null)
  const api = window.browserToolbar

  useEffect(() => {
    if (!api) return
    return api.onStateUpdate((s) => {
      setState(s)
      // Sync theme color from full state push (initial load / reconnection)
      if ('themeColor' in s) {
        setThemeColor((s as ToolbarState).themeColor ?? null)
      }
    })
  }, [api])

  useEffect(() => {
    if (!api) return
    return api.onThemeColor(setThemeColor)
  }, [api])

  const handleNavigate = useCallback((url: string) => {
    void api?.navigate(url)
  }, [api])

  const handleGoBack = useCallback(() => {
    void api?.goBack()
  }, [api])

  const handleGoForward = useCallback(() => {
    void api?.goForward()
  }, [api])

  const handleReload = useCallback(() => {
    void api?.reload()
  }, [api])

  const handleStop = useCallback(() => {
    void api?.stop()
  }, [api])

  const handleHideWindow = useCallback(() => {
    void api?.hideWindow()
  }, [api])

  const handleCloseWindowEntirely = useCallback(() => {
    void api?.closeWindowEntirely()
  }, [api])

  return (
    <BrowserControls
      url={state.url}
      loading={state.isLoading}
      canGoBack={state.canGoBack}
      canGoForward={state.canGoForward}
      onNavigate={handleNavigate}
      onGoBack={handleGoBack}
      onGoForward={handleGoForward}
      onReload={handleReload}
      onStop={handleStop}
      trailingContent={(
        <div className="ml-2 flex items-center gap-1.5 titlebar-no-drag">
          <HeaderIconButton
            icon={<EyeOff className="h-3.5 w-3.5" />}
            aria-label={t('browser.hideWindow')}
            onClick={handleHideWindow}
            className={themeColor ? '' : 'bg-background shadow-minimal hover:bg-foreground/5'}
            style={themeColor ? { color: 'var(--tb-fg)' } : undefined}
          />
          <HeaderIconButton
            icon={<X className="h-3.5 w-3.5" />}
            aria-label={t('browser.closeWindowEntirely')}
            onClick={handleCloseWindowEntirely}
            className={themeColor ? '' : 'bg-background shadow-minimal hover:bg-foreground/5'}
            style={themeColor ? { color: 'var(--tb-fg)' } : undefined}
          />
        </div>
      )}
      themeColor={themeColor}
      urlBarClassName="max-w-[600px]"
      className="titlebar-drag-region bg-background"
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Mount                                                              */
/* ------------------------------------------------------------------ */

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserToolbarApp />
  </React.StrictMode>,
)
