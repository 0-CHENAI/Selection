import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ModalProvider } from '@/context/ModalContext'
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog'
import { ProjectSettingsPanel } from '@/components/projects/ProjectSettingsPanel'
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
  const [folder, setFolder] = React.useState('')
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
        saving={false}
        folderError={null}
        onNameChange={setName}
        onDescriptionChange={setDescription}
        onDetailsChange={setDetails}
        onHistorySearchChange={setHistory}
        onColorChange={setColor}
        onPickFolder={() => setFolder('/Users/demo/巡察资料')}
        onSave={() => setSaved(folder ? '已保存' : '已保存其他字段，仍需补选工作文件夹')}
        onDelete={() => setSaved('已请求删除')}
        onOpenLocation={() => setSaved('已打开存储位置')}
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
