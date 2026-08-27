import { describe, expect, it } from 'bun:test'
import { dispatchOpenPath } from '../shell-capabilities'

describe('dispatchOpenPath', () => {
  it('acknowledges after the grace window when the Windows open request remains pending', async () => {
    const neverSettles = new Promise<string>(() => {})

    const result = await dispatchOpenPath('C:\\workspace\\report.docx', () => neverSettles, console.error, 0)

    expect(result).toEqual({})
  })

  it('preserves synchronous dispatch failures', () => {
    const failure = new Error('native dispatch failed')

    expect(() => dispatchOpenPath('C:\\workspace\\report.docx', () => {
      throw failure
    })).toThrow(failure)
  })

  it('returns a fast shell error to the renderer', async () => {
    const result = await dispatchOpenPath(
      'C:\\workspace\\report.docx',
      async () => 'No application is associated with the specified file',
    )

    expect(result).toEqual({ error: 'No application is associated with the specified file' })
  })

  it('returns a fast rejected dispatch to the renderer', async () => {
    const result = await dispatchOpenPath(
      'C:\\workspace\\report.docx',
      async () => { throw new Error('native dispatch failed') },
    )

    expect(result).toEqual({ error: 'native dispatch failed' })
  })

  it('logs an asynchronous Windows shell error after acknowledging', async () => {
    const messages: Array<[string, unknown?]> = []
    let rejectOpen!: (error: Error) => void
    const completion = new Promise<string>((_resolve, reject) => {
      rejectOpen = reject
    })

    expect(await dispatchOpenPath(
      'C:\\workspace\\report.docx',
      () => completion,
      (message, error) => messages.push([message, error]),
      0,
    )).toEqual({})

    const failure = new Error('no file association')
    rejectOpen(failure)
    await completion.catch(() => {})

    expect(messages).toEqual([['Failed to open file:', failure]])
  })
})
