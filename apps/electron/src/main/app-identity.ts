/**
 * Canonical desktop identity. Keep these in lockstep with electron-builder.yml
 * (`appId` / `productName`) so OS notifications attribute to "Selection"
 * instead of Electron's default "Electron App".
 */
import { app } from 'electron'

export const APP_DISPLAY_NAME = 'Selection'

/** Must match electron-builder.yml `appId`. Windows toast attribution uses this AUMID. */
export const APP_USER_MODEL_ID = 'com.lukilabs.craft-agent'

export function applyAppIdentity(): void {
  app.setName(process.env.CRAFT_APP_NAME || APP_DISPLAY_NAME)
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID)
  }
}
