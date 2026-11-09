import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ModalProvider } from '@/context/ModalContext'
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog'
import { ProjectSettingsPanel } from '@/components/projects/ProjectSettingsPanel'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { Trash2, Upload } from 'lucide-react'
import { ProjectWorkingDirectoryMark } from '@/components/app-shell/input/ProjectWorkingDirectoryMark'
import type { ComponentEntry } from './types'

function useChineseCopy() {
  const { i18n } = useTranslation()
  React.useEffect(() => {
    const previous = i18n.language
    void i18n.changeLanguage('zh-Hans')
    return () => {
      void i18n.changeLanguage(previous)
    }
  }, [i18n])
}

function CreateProjectPreview() {
  useChineseCopy()
  const [open, setOpen] = React.useState(true)
  const [created, setCreated] = React.useState<string>('')
  return (
    <ModalProvider>
      <div className="flex w-[560px] flex-col items-start gap-3">
        <button
          type="button"
          className="rounded-lg bg-foreground px-3 py-1.5 text-sm text-background"
          onClick={() => setOpen(true)}
        >
          新建项目
        </button>
        {created && <p className="text-sm text-muted-foreground">{created}</p>}
        <CreateProjectDialog
          open={open}
          onCancel={() => setOpen(false)}
          pickFolder={async () => '/Users/demo/巡察资料'}
          onSubmit={(input) => {
            setCreated(`${input.name} · ${input.workingDirectory}`)
            setOpen(false)
          }}
        />
      </div>
    </ModalProvider>
  )
}

function ProjectSettingsPreview() {
  useChineseCopy()
  const [name, setName] = React.useState('巡察资料')
  const [description, setDescription] = React.useState('2026 年巡察底稿')
  const [folder, setFolder] = React.useState('/Users/chenai/local/EFSA')
  const [details, setDetails] = React.useState('引用材料时注明页码。')
  const [history, setHistory] = React.useState(true)
  const [color, setColor] = React.useState('#6366f1')
  const [saved, setSaved] = React.useState('')
  return (
    <div className="w-[640px] rounded-xl bg-background p-1">
      <ProjectSettingsPanel
        name={name}
        description={description}
        storedWorkingDirectory={undefined}
        workingDirectory={folder}
        details={details}
        historySearch={history}
        color={color}
        slug="xuncha-ziliao"
        folderPath="/Users/demo/Selection/projects/xuncha-ziliao"
        folderError={null}
        onNameChange={setName}
        onDescriptionChange={setDescription}
        onDetailsChange={setDetails}
        onHistorySearchChange={setHistory}
        onColorChange={setColor}
        onPickFolder={() => setFolder('/Users/demo/巡察资料')}
        onDelete={() => setSaved('已请求删除')}
        onOpenLocation={() => setSaved('已打开存储位置')}
        resources={(
          <SettingsSection
            title="资源"
            description="上传 PDF、图片或文本，供此项目中的会话使用。"
            action={(
              <Button variant="outline" size="sm" type="button">
                <Upload />
                上传文件
              </Button>
            )}
          >
            <SettingsCard divided={false}>
              <ul className="divide-y divide-border/50">
                <li className="flex items-center gap-3 px-4 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">brief.pdf</div>
                    <div className="text-xs text-foreground/50">128.0 KB · application/pdf</div>
                  </div>
                  <Button size="sm" variant="ghost" type="button" className="text-destructive hover:text-destructive" aria-label="删除资源">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              </ul>
            </SettingsCard>
          </SettingsSection>
        )}
      />
      <div className="mt-6 rounded-xl border border-border/60 bg-background px-3 py-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">项目会话</div>
        <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-2 py-2">
          <ProjectWorkingDirectoryMark workingDirectory={folder || undefined} isEmptySession={!folder} />
          <span className="text-xs text-muted-foreground">只读，悬停可看完整路径</span>
        </div>
      </div>
      {saved && <p className="px-1 pt-3 text-sm text-muted-foreground">{saved}</p>}
    </div>
  )
}

export const projectSettingsComponents: ComponentEntry[] = [
  {
    id: 'project-create-dialog',
    name: 'New project',
    category: 'Settings',
    description: 'Create a project only after a working folder is chosen',
    component: CreateProjectPreview,
    props: [],
    variants: [],
  },
  {
    id: 'project-settings-panel',
    name: 'Project settings',
    category: 'Settings',
    description: 'Grouped project settings with a prompt when the working folder is missing',
    component: ProjectSettingsPreview,
    props: [],
    variants: [],
    layout: 'top',
  },
]
