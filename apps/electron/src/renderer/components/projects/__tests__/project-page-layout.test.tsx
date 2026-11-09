import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next, { type InitOptions } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))

let ProjectSettingsPanel: typeof import('../ProjectSettingsPanel').ProjectSettingsPanel
let ProjectWorkingDirectoryMark: typeof import('../../app-shell/input/ProjectWorkingDirectoryMark').ProjectWorkingDirectoryMark
let TooltipProvider: typeof import('@craft-agent/ui').TooltipProvider

beforeAll(async () => {
  ;({ ProjectSettingsPanel } = await import('../ProjectSettingsPanel'))
  ;({ ProjectWorkingDirectoryMark } = await import('../../app-shell/input/ProjectWorkingDirectoryMark'))
  ;({ TooltipProvider } = await import('@craft-agent/ui'))
})

function renderZh(node: ReactNode): string {
  const instance = i18next.createInstance()
  void instance.init({
    lng: 'zh-Hans',
    fallbackLng: 'en',
    initImmediate: false,
    resources: {
      'zh-Hans': { translation: LOCALE_REGISTRY['zh-Hans'].messages },
    },
  } as InitOptions)
  return renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  )
}

describe('project page is one scroll without a session list', () => {
  it('does not render a sessions tab or session list on the project page', () => {
    const page = readFileSync(join(import.meta.dir, '../../../pages/ProjectInfoPage.tsx'), 'utf8')
    expect(page).not.toContain('tabSessions')
    expect(page).not.toContain('projectSessions')
    expect(page).not.toContain('onCreateSession')
    expect(page).toContain('projectInfo.tabAssets')
    expect(page).toContain('ProjectSettingsAutosaveController')
    expect(page).toContain('blurText')
    expect(page).toContain("addEventListener('pagehide'")
    expect(page).not.toContain('onSave')
    expect(page).not.toContain('handleSaveSettings')
    expect(page).not.toContain('common.save')
  })

  it('has no save button, and the textarea matches the other inputs', () => {
    const html = renderZh(
      <ProjectSettingsPanel
        name="Redundent"
        description=""
        storedWorkingDirectory="/Users/chenai/local/EFSA"
        workingDirectory="/Users/chenai/local/EFSA"
        details=""
        historySearch
        color=""
        slug="redundent"
        folderPath="/Users/chenai/local/Selection/projects/redundent"
        folderError={null}
        onNameChange={() => {}}
        onDescriptionChange={() => {}}
        onDetailsChange={() => {}}
        onHistorySearchChange={() => {}}
        onColorChange={() => {}}
        onPickFolder={() => {}}
        onDelete={() => {}}
        onOpenLocation={() => {}}
        resources={<section>资源</section>}
      />,
    )
    expect(html).toContain('基本信息')
    expect(html).toContain('工作文件夹')
    expect(html).toContain('AI 指令')
    expect(html).toContain('历史对话')
    expect(html).toContain('允许 AI 查阅本项目的历史对话')
    expect(html).toContain('仅 PRO 模式可用')
    expect(html).toContain('危险操作')
    expect(html).toContain('>资源<')
    expect(html).not.toContain('>会话<')
    const retrieval = html.indexOf('历史对话')
    const resources = html.indexOf('>资源<')
    expect(retrieval).toBeGreaterThan(-1)
    expect(resources).toBeGreaterThan(retrieval)
    expect(html.slice(retrieval, resources)).not.toContain('保存')
    expect((html.match(/>保存</g) ?? []).length).toBe(0)
    expect(html).not.toContain('保存中')
    expect(html).toContain('data-slot="textarea"')
    expect(html).toContain('resize-none')
    expect(html).toContain('data-slot="input"')
  })

  it('reads the locked folder title and the full path to assistive tech', () => {
    const html = renderZh(
      <ProjectWorkingDirectoryMark workingDirectory="/Users/chenai/local/EFSA" />,
    )
    expect(html).toContain('aria-label="项目文件夹，不可变更: /Users/chenai/local/EFSA"')
    expect(html).toContain('项目文件夹，不可变更')
    expect(html).toContain('/Users/chenai/local/EFSA')
    expect(html).toContain('>EFSA<')
    expect(html).toContain('hover:bg-foreground/5')
    expect(html).toContain('focus-visible:bg-foreground/5')
    expect(html).not.toContain('bg-background')
    expect(html).not.toContain('border-foreground/5')
    expect(html).not.toContain('mx-0.5')
    expect(html).not.toContain('项目工作文件夹')
  })
})
