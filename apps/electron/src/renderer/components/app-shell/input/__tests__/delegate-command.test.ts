import { describe, expect, it } from 'bun:test'
import {
  assessDelegateCommandSubmission,
  buildDelegateCommandDraft,
  parseDelegateCommand,
} from '../delegate-command'

describe('delegate command', () => {
  it('recognizes only an explicit command prefix and strips it from the task', () => {
    expect(parseDelegateCommand('/delegate inspect auth and storage')).toEqual({
      kind: 'delegate',
      message: 'inspect auth and storage',
    })
    expect(parseDelegateCommand('  /DELEGATE\ninspect both modules  ')).toEqual({
      kind: 'delegate',
      message: 'inspect both modules',
    })
  })

  it('keeps natural-language mentions and lookalike commands unauthorized', () => {
    expect(parseDelegateCommand('请使用子代理并行调查')).toEqual({
      kind: 'ordinary',
      message: '请使用子代理并行调查',
    })
    expect(parseDelegateCommand('Explain /delegate without running it')).toEqual({
      kind: 'ordinary',
      message: 'Explain /delegate without running it',
    })
    expect(parseDelegateCommand('/delegated task')).toEqual({
      kind: 'ordinary',
      message: '/delegated task',
    })
    expect(parseDelegateCommand('  ordinary text  ')).toEqual({
      kind: 'ordinary',
      message: '  ordinary text  ',
    })
  })

  it('reports an empty delegated task and builds a visible command draft', () => {
    expect(parseDelegateCommand('/delegate   ')).toEqual({ kind: 'delegate', message: '' })
    expect(buildDelegateCommandDraft('')).toBe('/delegate ')
    expect(buildDelegateCommandDraft(' existing task ')).toBe('/delegate existing task')
  })

  it('fails closed while the session is processing without blocking ordinary queued messages', () => {
    expect(assessDelegateCommandSubmission('/delegate inspect both modules', true)).toEqual({
      allowed: false,
      kind: 'delegate',
      message: 'inspect both modules',
      reason: 'session-processing',
    })
    expect(assessDelegateCommandSubmission('/delegate inspect both modules', false)).toEqual({
      allowed: true,
      kind: 'delegate',
      message: 'inspect both modules',
    })
    expect(assessDelegateCommandSubmission('请让子代理并行调查', true)).toEqual({
      allowed: true,
      kind: 'ordinary',
      message: '请让子代理并行调查',
    })
  })

  it('fails closed for an empty delegated task before submission', () => {
    expect(assessDelegateCommandSubmission('/delegate ', false)).toEqual({
      allowed: false,
      kind: 'delegate',
      message: '',
      reason: 'empty-task',
    })
  })
})
