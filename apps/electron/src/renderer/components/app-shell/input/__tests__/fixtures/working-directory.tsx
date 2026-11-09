import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import { setupI18n } from '@craft-agent/shared/i18n'
import { TooltipProvider } from '@craft-agent/ui'
import { ModalProvider } from '@/context/ModalContext'
import { ChatWorkingDirectoryControl } from '../../ChatWorkingDirectoryControl'
import { ProjectWorkingDirectoryMark } from '../../ProjectWorkingDirectoryMark'
import '@/index.css'

const calls = { picker: 0, changes: [] as string[] }
let resolvePicker: (path: string | null) => void = () => {}
Object.assign(window, {
  electronAPI: {
    openFolderDialog: () => { calls.picker++; return new Promise<string | null>(resolve => { resolvePicker = resolve }) },
    getTransportConnectionState: async () => ({ mode: 'local', status: 'connected' }),
  },
})
setupI18n([initReactI18next])

function Fixture() {
  const [directory, setDirectory] = React.useState<string | undefined>()
  const [root, setRoot] = React.useState<string | undefined>()
  const [disabled, setDisabled] = React.useState(false)
  const [scope, setScope] = React.useState('draft')
  const [project, setProject] = React.useState(false)
  Object.assign(window, { folderFixture: {
    calls,
    resolve: (path: string | null) => resolvePicker(path),
    configure: (options: { directory?: string; root?: string; disabled?: boolean; scope?: string; project?: boolean }) => {
      setDirectory(options.directory); setRoot(options.root); setDisabled(options.disabled ?? false)
      setScope(options.scope ?? 'draft'); setProject(options.project ?? false)
    },
    get directory() { return directory },
  } })
  return <main style={{ padding: 48, width: 580 }}>
    <h1 style={{ fontSize: 20, marginBottom: 24 }}>Ordinary chat · working folder</h1>
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 20, background: 'var(--background)' }}>
      <p style={{ opacity: .5, marginBottom: 40 }}>Message Selection…</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span aria-hidden>＋</span><span aria-hidden>⊕</span>
        {project ? <ProjectWorkingDirectoryMark workingDirectory={directory} /> :
          <ChatWorkingDirectoryControl key={scope} workingDirectory={directory} sessionFolderPath={root} disabled={disabled}
            onWorkingDirectoryChange={path => { calls.changes.push(path); setDirectory(path) }} />}
      </div>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<TooltipProvider><ModalProvider><Fixture /></ModalProvider></TooltipProvider>)
