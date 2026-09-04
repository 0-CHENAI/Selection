import * as React from 'react'
import { useAtom } from 'jotai'
import { useAppShellContext } from '@/context/AppShellContext'
import { kanbanEditorTargetAtom } from '@/atoms/kanban'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { BoardListToggle } from './BoardListToggle'
import { TaskEditor } from './TaskEditor'
import { buildModelCatalog, catalogDefaultModel } from './kanban-models'
import { resolveOrchestrationEditorTarget } from './orchestration-editor-target'

/**
 * Second view of the list/orchestration switcher. The board columns are gone;
 * this pane is the create/edit orchestration editor (#261).
 */
export function KanbanBoardContainer() {
  const {
    activeWorkspaceId,
    llmConnections,
    onJumpToTaskSessions,
    orchestrationProjectId,
  } = useAppShellContext()
  const { navigate, navigateToSession } = useNavigation()
  const [editorTarget, setEditorTarget] = useAtom(kanbanEditorTargetAtom)
  const { groups, modelToConnection } = React.useMemo(
    () => buildModelCatalog(llmConnections),
    [llmConnections],
  )
  const defaultModel = catalogDefaultModel(groups)
  const target = resolveOrchestrationEditorTarget(editorTarget, orchestrationProjectId)

  const closeToList = React.useCallback(() => {
    setEditorTarget(null)
    navigate(routes.view.allSessions())
  }, [navigate, setEditorTarget])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-end border-b border-border/50 px-4 py-2.5">
        <BoardListToggle
          value="board"
          onChange={view => {
            if (view === 'list') {
              setEditorTarget(null)
              navigate(routes.view.allSessions())
            }
          }}
        />
      </div>
      {activeWorkspaceId ? (
        <div className="min-h-0 flex-1">
          <TaskEditor
            workspaceId={activeWorkspaceId}
            target={target}
            onClose={closeToList}
            onOpenSession={
              target.mode === 'edit'
                ? () => {
                    const sessionId = target.sessionId
                    setEditorTarget(null)
                    navigateToSession(sessionId)
                  }
                : undefined
            }
            onOpenChildSession={(sessionId) => {
              setEditorTarget(null)
              navigateToSession(sessionId)
            }}
            onCreated={({ sessionId, taskLabelId, projectId: createdProjectId }) => {
              if (taskLabelId && onJumpToTaskSessions) {
                onJumpToTaskSessions(sessionId, { labelId: taskLabelId, projectId: createdProjectId })
              } else {
                navigateToSession(sessionId)
              }
            }}
            modelGroups={groups}
            modelToConnection={modelToConnection}
            defaultModel={defaultModel ?? ''}
          />
        </div>
      ) : null}
    </div>
  )
}
