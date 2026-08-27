import { describe, expect, it } from 'bun:test'
import { dispatchOpenPath } from '../shell-capabilities'

describe('dispatchOpenPath', () => {
  it('acknowledges after the grace period when the Windows open request remains pending', async () => {
    const neverSettles = new Promise<string>(() => {})

    const result = await dispatchOpenPath(
      'C:\\workspace\\report.docx',
      () => neverSettles,
      { graceMs: 0 },
    )

    expect(result).toEqual({})
  })

  it('preserves synchronous dispatch failures', () => {
    const failure = new Error('native dispatch failed')

    expect(() => dispatchOpenPath('C:\\workspace\\report.docx', () => {
      throw failure
    })).toThrow(failure)
  })

  it('returns a prompt successful Windows shell result', async () => {
    const result = await dispatchOpenPath(
      'C:\\workspace\\report.docx',
      () => Promise.resolve(''),
    )

    expect(result).toEqual({ error: undefined })
  })

  it('returns a prompt Windows shell error to the RPC caller', async () => {
    const result = await dispatchOpenPath(
      'C:\\workspace\\report.docx',
      () => Promise.resolve('No application is associated with the specified file'),
    )

    expect(result).toEqual({
      error: 'No application is associated with the specified file',
    })
  })

  it('rejects when the Windows shell rejects before the grace period', async () => {
    const failure = new Error('native dispatch failed asynchronously')

    await expect(dispatchOpenPath(
      'C:\\workspace\\report.docx',
      () => Promise.reject(failure),
    )).rejects.toBe(failure)
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
      {
        graceMs: 0,
        logError: (message, error) => messages.push([message, error]),
      },
    )).toEqual({})

    const failure = new Error('no file association')
    rejectOpen(failure)
    await completion.catch(() => {})

    expect(messages).toEqual([['Failed to open file:', failure]])
  })
})
