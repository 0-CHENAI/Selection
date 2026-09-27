import * as React from 'react'
import { usePlatform } from '../../context/PlatformContext'
import { hashAnnotationSource } from './annotation-core'
import type { AnnotationV1 } from '@craft-agent/core'
import {
  annotationInteractionActions,
  annotationInteractionReducer,
  initialAnnotationInteractionState,
  type ActiveAnnotationDetail,
  type AnchoredSelection,
  type AnnotationIslandMode,
} from './interaction-state-machine'

export type ExternalOpenAnnotationRequest = {
  messageId: string
  annotationId: string
  mode: AnnotationIslandMode
  anchorX?: number
  anchorY?: number
  nonce: number
}

export function useAnnotationInteractionController(namespace = '') {
  const [state, dispatch] = React.useReducer(annotationInteractionReducer, initialAnnotationInteractionState)
  const { onReadAnnotationDraft, onWriteAnnotationDraft } = usePlatform()
  const [draftError, setDraftError] = React.useState(false)
  const revisions = React.useRef(new Map<string, number>())
  const drafts = React.useRef(new Map<string, string>())
  const draftKey = React.useRef<string | null>(null)
  const lastHandledOpenRequestNonceRef = React.useRef<number | null>(null)

  const digests = React.useRef(new Map<string, Promise<string>>())
  const digestKey = React.useCallback((key: string) => {
    let digest = digests.current.get(key)
    if (!digest) {
      digest = hashAnnotationSource(key).catch(error => { digests.current.delete(key); throw error })
      digests.current.set(key, digest)
    }
    return digest
  }, [])

  const persistDraft = React.useCallback((key: string, value: string | undefined) => {
    const revision = (revisions.current.get(key) ?? 0) + 1
    revisions.current.set(key, revision)
    if (!onWriteAnnotationDraft) return
    void digestKey(key).then(digest => {
      if (revisions.current.get(key) !== revision) return
      onWriteAnnotationDraft(digest, value)
      if (draftKey.current === key) setDraftError(false)
    }).catch(() => { if (draftKey.current === key) setDraftError(true) })
  }, [onWriteAnnotationDraft, digestKey])

  const restoreDraft = React.useCallback((key: string) => {
    const revision = revisions.current.get(key) ?? 0
    if (!onReadAnnotationDraft || drafts.current.has(key)) return
    void digestKey(key).then(digest => {
      if ((revisions.current.get(key) ?? 0) !== revision) return
      const value = onReadAnnotationDraft(digest)
      if (value === undefined) return
      drafts.current.set(key, value)
      if (draftKey.current === key) dispatch(annotationInteractionActions.setDraft(value))
    }).catch(() => { if (draftKey.current === key) setDraftError(true) })
  }, [onReadAnnotationDraft, digestKey])

  const setDraft = React.useCallback((draft: string) => {
    if (draftKey.current) { drafts.current.set(draftKey.current, draft); persistDraft(draftKey.current, draft) }
    dispatch(annotationInteractionActions.setDraft(draft))
  }, [persistDraft])

  const openFromSelection = React.useCallback((selection: AnchoredSelection) => {
    draftKey.current = JSON.stringify([namespace, 'selection', selection.start, selection.end, selection.sourceContent ?? selection.selectedText])
    setDraftError(false)
    restoreDraft(draftKey.current)
    dispatch(annotationInteractionActions.openFromSelection(selection))
    const draft = drafts.current.get(draftKey.current)
    if (draft !== undefined) dispatch(annotationInteractionActions.setDraft(draft))
  }, [namespace, restoreDraft])

  const openFollowUpFromSelection = React.useCallback(() => {
    dispatch(annotationInteractionActions.openFollowUpFromSelection())
    const draft = draftKey.current ? drafts.current.get(draftKey.current) : undefined
    if (draft !== undefined) dispatch(annotationInteractionActions.setDraft(draft))
  }, [])

  const openFromAnnotation = React.useCallback((detail: ActiveAnnotationDetail, noteText: string, mode: AnnotationIslandMode, sourceIdentity?: string) => {
    draftKey.current = JSON.stringify([namespace, 'annotation', detail.annotationId, sourceIdentity])
    setDraftError(false)
    if (mode === 'edit') restoreDraft(draftKey.current)
    dispatch(annotationInteractionActions.openFromAnnotation(detail, mode === 'edit' ? drafts.current.get(draftKey.current) ?? noteText : noteText, mode))
  }, [namespace, restoreDraft])

  const requestEdit = React.useCallback(() => {
    if (draftKey.current) restoreDraft(draftKey.current)
    dispatch(annotationInteractionActions.requestEdit())
    const draft = draftKey.current ? drafts.current.get(draftKey.current) : undefined
    if (draft !== undefined) dispatch(annotationInteractionActions.setDraft(draft))
  }, [restoreDraft])

  const cancelFollowUp = React.useCallback(() => {
    const hadPendingSelection = Boolean(state.pendingSelection)
    const pendingSelection = state.pendingSelection
    dispatch(annotationInteractionActions.cancelFollowUp())
    return { hadPendingSelection, pendingSelection }
  }, [state.pendingSelection])

  const closeAll = React.useCallback(() => {
    dispatch(annotationInteractionActions.closeAll())
  }, [])

  const discardDraft = React.useCallback(() => {
    if (draftKey.current) { drafts.current.delete(draftKey.current); persistDraft(draftKey.current, undefined) }
    dispatch(annotationInteractionActions.cancelFollowUp())
  }, [persistDraft])

  const markSubmitSuccess = React.useCallback(() => {
    if (draftKey.current) { drafts.current.delete(draftKey.current); persistDraft(draftKey.current, undefined) }
    dispatch(annotationInteractionActions.submitSuccess())
  }, [persistDraft])

  const markDeleteSuccess = React.useCallback(() => {
    if (draftKey.current) { drafts.current.delete(draftKey.current); persistDraft(draftKey.current, undefined) }
    dispatch(annotationInteractionActions.deleteSuccess())
  }, [persistDraft])

  const consumeExternalOpenRequest = React.useCallback((
    request: ExternalOpenAnnotationRequest | null | undefined,
    params: {
      messageId?: string
      annotations?: AnnotationV1[]
      getNoteText: (annotation: AnnotationV1) => string
      fallbackAnchor: { x: number; y: number }
    },
  ): boolean => {
    if (!request || !params.messageId || !params.annotations?.length) return false
    if (request.messageId !== params.messageId) return false

    if (lastHandledOpenRequestNonceRef.current === request.nonce) return false

    const annotationIndex = params.annotations.findIndex(item => item.id === request.annotationId)
    if (annotationIndex < 0) return false

    lastHandledOpenRequestNonceRef.current = request.nonce

    const annotation = params.annotations[annotationIndex]
    if (!annotation) return false

    const noteText = params.getNoteText(annotation)
    const detail: ActiveAnnotationDetail = {
      annotationId: request.annotationId,
      index: annotationIndex + 1,
      anchorX: request.anchorX ?? params.fallbackAnchor.x,
      anchorY: request.anchorY ?? params.fallbackAnchor.y,
    }

    openFromAnnotation(detail, noteText, request.mode, JSON.stringify([annotation.meta?.sourceContentHash, annotation.target.selectors]))
    return true
  }, [openFromAnnotation])

  return {
    state,
    draftError,
    setDraft,
    openFromSelection,
    openFollowUpFromSelection,
    openFromAnnotation,
    requestEdit,
    cancelFollowUp,
    closeAll,
    discardDraft,
    markSubmitSuccess,
    markDeleteSuccess,
    consumeExternalOpenRequest,
  }
}
