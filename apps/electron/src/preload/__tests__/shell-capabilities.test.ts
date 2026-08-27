import { describe, expect, it } from 'bun:test'
import { dispatchOpenPath } from '../shell-capabilities'

describe('dispatchOpenPath', () => {
  it('acknowledges immediately when the Windows open request remains pending', () => {
    const neverSettles = new Promise<string>(() => {})

    const result = dispatchOpenPath('C:\\workspace\\report.docx', () => neverSettles)

    expect(result).toEqual({})
  })

  it('preserves synchronous dispatch failures', () => {
    const failure = new Error('native dispatch failed')

    expect(() => dispatchOpenPath('C:\\workspace\\report.docx', () => {
      throw failure
    })).toThrow(failure)
  })

  it('logs an asynchronous Windows shell error after acknowledging', async () => {
    const messages: Array<[string, unknown?]> = []
    let rejectOpen!: (error: Error) => void
    const completion = new Promise<string>((_resolve, reject) => {
      rejectOpen = reject
    })

    expect(dispatchOpenPath(
      'C:\\workspace\\report.docx',
      () => completion,
      (message, error) => messages.push([message, error]),
    )).toEqual({})

    const failure = new Error('no file association')
    rejectOpen(failure)
    await completion.catch(() => {})

    expect(messages).toEqual([['Failed to open file:', failure]])
  })
})
