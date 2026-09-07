import { expect, it } from 'bun:test'
import i18next, { type InitOptions } from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { TaskYamlImport } from '../TaskYamlImport'

it('renders a localized YAML-only import surface with no generation controls', () => {
  const instance = i18next.createInstance()
  void instance.init({
    lng: 'zh-Hans', fallbackLng: 'en', initImmediate: false,
    resources: Object.fromEntries(Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [code, { translation: entry.messages }])),
  } as InitOptions)
  const html = renderToStaticMarkup(<I18nextProvider i18n={instance}>
    <TaskYamlImport workspaceId="test" onClose={() => {}} />
  </I18nextProvider>)
  expect(html).toContain('导入 YAML')
  expect(html).toContain('schema_version: 3')
  expect(html).toContain('accept=".yaml,.yml"')
  expect(html).toContain('<textarea')
  expect(html).not.toContain('生成编排')
  expect(html).not.toContain('创建并运行')
});
