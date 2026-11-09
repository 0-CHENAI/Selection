import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

mock.module('electron', () => ({
  app: {
    setName() {},
    setAppUserModelId() {},
  },
}))

const { APP_DISPLAY_NAME, APP_USER_MODEL_ID } = await import('../app-identity.ts')

describe('app identity', () => {
  it('matches electron-builder appId and productName', () => {
    const yml = readFileSync(join(import.meta.dir, '../../../electron-builder.yml'), 'utf8')
    expect(yml).toContain(`appId: ${APP_USER_MODEL_ID}`)
    expect(yml).toContain(`productName: ${APP_DISPLAY_NAME}`)
    expect(yml).toContain(`CFBundleName: ${APP_DISPLAY_NAME}`)
    expect(yml).toContain(`shortcutName: ${APP_DISPLAY_NAME}`)
  })

  it('declares productName on the Electron package', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, '../../../package.json'), 'utf8'),
    ) as { productName?: string }
    expect(pkg.productName).toBe(APP_DISPLAY_NAME)
  })
})
