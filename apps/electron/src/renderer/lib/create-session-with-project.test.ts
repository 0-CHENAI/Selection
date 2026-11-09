import { describe, expect, mock, test } from 'bun:test'
import type { CreateSessionOptions, Session } from '../../shared/types'
import { createSessionWithConfirmedProject } from './create-session-with-project'

const session = (projectId?: string): Session => ({
  id: 'session-1',
  workspaceRootPath: '/workspace',
  createdAt: 1,
  lastUsedAt: 1,
  messages: [],
  projectId,
}) as unknown as Session

describe('createSessionWithConfirmedProject (#145)', () => {
  test('repairs a missing project binding before returning the session', async () => {
    const create = mock(async (_workspaceId: string, _options?: CreateSessionOptions) => session())
    const setProject = mock(async (_sessionId: string, _projectId: string) => undefined)

    const result = await createSessionWithConfirmedProject(
      create,
      setProject,
      'workspace-1',
      { projectId: 'project-1' },
    )

    expect(create).toHaveBeenCalledWith('workspace-1', { projectId: 'project-1' })
    expect(setProject).toHaveBeenCalledWith('session-1', 'project-1')
    expect(result.projectId).toBe('project-1')
  })

  test('does not issue a redundant command when creation confirms the binding', async () => {
    const create = mock(async () => session('project-1'))
    const setProject = mock(async () => undefined)

    const result = await createSessionWithConfirmedProject(
      create,
      setProject,
      'workspace-1',
      { projectId: 'project-1' },
    )

    expect(setProject).not.toHaveBeenCalled()
    expect(result.projectId).toBe('project-1')
  })

  test('keeps ordinary unbound session creation unchanged', async () => {
    const create = mock(async () => session())
    const setProject = mock(async () => undefined)

    const result = await createSessionWithConfirmedProject(
      create,
      setProject,
      'workspace-1',
    )

    expect(setProject).not.toHaveBeenCalled()
    expect(result.projectId).toBeUndefined()
  })

  test('does not publish a repaired binding when the persistence command fails', async () => {
    const create = mock(async () => session())
    const setProject = mock(async () => {
      throw new Error('persist failed')
    })

    await expect(createSessionWithConfirmedProject(
      create,
      setProject,
      'workspace-1',
      { projectId: 'project-1' },
    )).rejects.toThrow('persist failed')
  })
})
