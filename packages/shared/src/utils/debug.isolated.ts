// This file changes process.type and debug state; run in its own Bun process.
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { createLogger, debug, enableDebug, setElectronMainLogSink } from './debug'

const originalType = Object.getOwnPropertyDescriptor(process, 'type')
const originalJsonMode = process.env.CRAFT_CLI_JSON_ONLY
let stderr: ReturnType<typeof spyOn>
let consoleLog: ReturnType<typeof spyOn>
const mirrored: string[] = []

beforeEach(() => {
  enableDebug()
  delete process.env.CRAFT_CLI_JSON_ONLY
  mirrored.length = 0
  setElectronMainLogSink(message => { mirrored.push(message) })
  stderr = spyOn(process.stderr, 'write').mockImplementation(() => true)
  consoleLog = spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  setElectronMainLogSink(undefined)
  stderr.mockRestore()
  consoleLog.mockRestore()
  if (originalType) Object.defineProperty(process, 'type', originalType)
  else delete (process as unknown as { type?: string }).type
  if (originalJsonMode === undefined) delete process.env.CRAFT_CLI_JSON_ONLY
  else process.env.CRAFT_CLI_JSON_ONLY = originalJsonMode
})
function environment(type: string | undefined) {
  Object.defineProperty(process, 'type', { configurable: true, value: type })
}

test('main debug output still reaches the registered file sink and stderr', () => {
  environment('browser')
  createLogger('views').info('compiled', { count: 2 })
  expect(mirrored).toHaveLength(1)
  expect(mirrored[0]).toContain('[views] INFO  compiled {"count":2}')
  expect(stderr).toHaveBeenCalledTimes(1)
  expect(consoleLog).not.toHaveBeenCalled()
})
test('renderer debug output uses the browser console without calling the main sink', () => {
  environment('renderer')
  debug('renderer message')
  expect(consoleLog).toHaveBeenCalledTimes(1)
  expect(stderr).not.toHaveBeenCalled()
  expect(mirrored).toEqual([])
})
test('CLI output stays on stderr and JSON-only mode suppresses debug output', () => {
  environment(undefined)
  debug('cli message')
  expect(stderr).toHaveBeenCalledTimes(1)
  expect(mirrored).toEqual([])
  process.env.CRAFT_CLI_JSON_ONLY = '1'
  environment('browser')
  debug('must not contaminate JSON')
  expect(stderr).toHaveBeenCalledTimes(1)
  expect(mirrored).toEqual([])
})
