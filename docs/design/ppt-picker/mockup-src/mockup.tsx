import './playground/mock-utils'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import { setupI18n } from '@craft-agent/shared/i18n'
import { initReactI18next } from 'react-i18next'
import { ThemeProvider } from './context/ThemeContext'
import { EscapeInterruptProvider } from './context/EscapeInterruptContext'
import { PlaygroundAppShellProvider } from './playground/PlaygroundAppShellProvider'
import { TooltipProvider } from '@craft-agent/ui'
import { MockupApp } from './mockup/App'
import './index.css'
import 'generative-loaders/styles.css'

const i18n = setupI18n([initReactI18next])
void i18n.changeLanguage('zh-Hans')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <JotaiProvider>
    <ThemeProvider>
      <EscapeInterruptProvider>
        <PlaygroundAppShellProvider>
          <TooltipProvider delayDuration={0}>
            <MockupApp />
          </TooltipProvider>
        </PlaygroundAppShellProvider>
      </EscapeInterruptProvider>
    </ThemeProvider>
  </JotaiProvider>
)
