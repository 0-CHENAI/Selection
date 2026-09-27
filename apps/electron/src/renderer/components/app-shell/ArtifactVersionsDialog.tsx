import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { ArtifactFeedback, ManagedArtifact } from '@craft-agent/shared/protocol'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ShikiDiffViewer } from '@/components/shiki/ShikiDiffViewer'
import { latestArtifactFeedback, mergeArtifactFeedbackHistory, updateSelectedArtifactFeedback } from '@/lib/artifact-feedback-state'
import { artifactFeedbackAnchor } from '@/lib/artifact-feedback-anchor'

type CleanupDraft = { artifactId: string; versionId: string; ordinal: number; expectedVersion: string; requestId: string }

type FeedbackDraft = { validationRoot?: string; validationInputs?: string; instruction: string; requestId: string; source?: { content: string; version: string; hash: string }; anchor?: ArtifactFeedback['anchor'] }

const TEXT_ARTIFACT = /\.(?:txt|md|mdx|csv|tsv|json|jsonc|html?|xml|svg|css|scss|less|[cm]?[jt]sx?|py|rs|go|java|[ch](?:pp)?|sh|ya?ml|toml|sql)$/i

export function ArtifactVersionsDialog({ path, alternativePaths, sessionId, onClose, onPreview, onOpenSession }: { path: string | null; alternativePaths?: string[]; sessionId?: string; onClose: () => void; onPreview: (path: string) => void; onOpenSession?: (sessionId: string) => void }) {
  const { t } = useTranslation()
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const [record, setRecord] = React.useState<ManagedArtifact>()
  const [missing, setMissing] = React.useState(false)
  const [newLocation, setNewLocation] = React.useState('')
  const [error, setError] = React.useState<string>()
  const [cleanup, setCleanup] = React.useState<CleanupDraft>()
  const cleanupDrafts = React.useRef(new Map<string, CleanupDraft>())
  const cleanupRunning = React.useRef(false)
  const [cleanupInFlight, setCleanupInFlight] = React.useState<string>()
  const [pending, setPending] = React.useState(false)
  const [instruction, setInstruction] = React.useState('')
  const [validationInputs, setValidationInputs] = React.useState('')
  const [validationRoot, setValidationRoot] = React.useState<string>()
  const [validationContext, setValidationContext] = React.useState<{ root: string; requiresProjectChecks: boolean }>()
  const [feedback, setFeedback] = React.useState<ArtifactFeedback>()
  const [history, setHistory] = React.useState<ArtifactFeedback[]>([])
  const [comparison, setComparison] = React.useState<{ original: string; modified: string; before: number; after: number }>()
  const [selectionSource, setSelectionSource] = React.useState<{ content: string; version: string; hash: string }>()
  const [anchor, setAnchor] = React.useState<ArtifactFeedback['anchor']>()
  const drafts = React.useRef(new Map<string, FeedbackDraft>())
  const draftKey = JSON.stringify([sessionId, path])
  const requestId = React.useRef<string>(crypto.randomUUID())
  const sequence = React.useRef(0)
  const saveDraft = (changes: Partial<FeedbackDraft>) => {
    const draft = { instruction, validationInputs, validationRoot, requestId: requestId.current, source: selectionSource, anchor, ...changes }
    drafts.current.set(draftKey, draft)
    requestId.current = draft.requestId
  }
  React.useEffect(() => {
    const draft = path ? drafts.current.get(draftKey) : undefined
    setValidationInputs(draft?.validationInputs ?? ''); setValidationRoot(draft?.validationRoot);
    setInstruction(draft?.instruction ?? ''); setSelectionSource(draft?.source); setAnchor(draft?.anchor)
    setCleanup(path ? cleanupDrafts.current.get(draftKey) : undefined); setFeedback(undefined); setHistory([]); requestId.current = draft?.requestId ?? crypto.randomUUID()
  }, [draftKey, path])
  const artifactId = record?.id
  React.useEffect(() => {
    setValidationContext(undefined)
    if (!path || !artifactId || !sessionId || !window.electronAPI.isChannelAvailable('artifacts:feedbackContext')) return
    let disposed = false
    void window.electronAPI.getArtifactFeedbackContext(sessionId, artifactId)
      .then(value => { if (!disposed) setValidationContext(value) })
      .catch(e => { if (!disposed) setError(String(e)) })
    return () => { disposed = true }
  }, [path, artifactId, sessionId])
  const feedbackId = feedback?.id
  const feedbackStatus = feedback?.status
  const feedbackSessionId = feedback?.sessionId
  const recordPath = record?.path
  React.useEffect(() => {
    if (!path || !feedbackId || !feedbackSessionId || !feedbackStatus || !['queued', 'running', 'validating'].includes(feedbackStatus)) return
    const request = sequence.current
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const value = await window.electronAPI.artifactFeedback({ type: 'get', sessionId: feedbackSessionId, feedbackId })
        if (disposed || request !== sequence.current) return
        // Load the committed version before changing status: changing it cleans
        // up this effect, which previously discarded the refreshed artifact.
        const artifact = value.status === 'applied'
          ? await window.electronAPI.manageArtifact({ type: 'read', artifactId: value.artifactId }) : undefined
        if (disposed || request !== sequence.current) return
        if (artifact) setRecord(artifact)
        setFeedback(current => updateSelectedArtifactFeedback(current, value))
        setHistory(items => mergeArtifactFeedbackHistory(items, [value]))
      } catch (e) { if (!disposed) setError(String(e)) }
      finally { if (!disposed) timer = setTimeout(() => { void poll() }, 2000) }
    }
    timer = setTimeout(() => { void poll() }, 2000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [feedbackId, feedbackStatus, feedbackSessionId, path, sessionId])
  React.useEffect(() => {
    const request = ++sequence.current
    setRecord(undefined); setError(undefined); setComparison(undefined); setMissing(false); setNewLocation('')
    if (!path) { setPending(false); return }
    setPending(true)
    void window.electronAPI.manageArtifact({ type: 'register', path, alternativePaths }).then(value => {
      if (request === sequence.current) setRecord(value)
    }).catch(e => { if (request === sequence.current) setError(String(e)) })
      .finally(() => { if (request === sequence.current) setPending(false) })
    return () => { sequence.current = request + 1 }
  }, [path, sessionId, alternativePaths])
  React.useEffect(() => {
    if (!record?.id || !sessionId || !window.electronAPI.isChannelAvailable('artifacts:feedbackList')) return
    let disposed = false
    void window.electronAPI.listArtifactFeedback(sessionId, record.id).then(items => {
      if (!disposed) {
        setHistory(current => mergeArtifactFeedbackHistory(current, items))
        setFeedback(current => {
          if (!current) return items[0]
          const loaded = items.find(item => item.id === current.id)
          return loaded ? latestArtifactFeedback(current, loaded) : current
        })
      }
    }).catch(e => { if (!disposed) setError(String(e)) })
    return () => { disposed = true }
  }, [record?.id, sessionId])
  React.useEffect(() => {
    if (!recordPath || !window.electronAPI.isChannelAvailable('fs:statPath')) return
    let disposed = false
    void window.electronAPI.statPath(recordPath).then(value => { if (!disposed) setMissing(!value || value.type !== 'file') })
      .catch(e => { if (!disposed) { setMissing(true); setError(String(e)) } })
    return () => { disposed = true }
  }, [recordPath])
  return <Dialog open={path !== null} onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-auto"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => {
        if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() }
      }}>

      <DialogHeader><DialogTitle>{t('chat.artifactVersions.title')}</DialogTitle><DialogDescription className="break-all">{record?.path ?? path}</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">{t('chat.artifactVersions.description')}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(pending || cleanupInFlight === draftKey) && <p role="status">{t('chat.artifactVersions.loading')}</p>}
      {record && <div className="space-y-2">
        {missing && <div className="space-y-2" role="status">
          <p className="text-sm text-warning">{t('chat.artifactVersions.locationMissing')}</p>
          <label htmlFor="artifact-new-location">{t('chat.artifactVersions.newLocation')}</label>
          <input id="artifact-new-location" className="w-full rounded-md border border-input bg-background p-2 text-sm" value={newLocation} onChange={event => setNewLocation(event.target.value)} disabled={pending} />
          <Button variant="outline" disabled={pending || !newLocation.trim()} onClick={() => {
            const request = sequence.current; setPending(true); setError(undefined)
            void window.electronAPI.manageArtifact({ type: 'relocate', artifactId: record.id, path: newLocation.trim(), expectedVersion: record.currentVersion })
              .then(value => { if (request === sequence.current) { setRecord(value); setMissing(false); setNewLocation('') } })
              .catch(e => { if (request === sequence.current) setError(String(e)) })
              .finally(() => { if (request === sequence.current) setPending(false) })
          }}>{t('chat.artifactVersions.relocate')}</Button>
        </div>}
        {sessionId && window.electronAPI.isChannelAvailable('artifacts:feedback') && <div className="space-y-2">
          {TEXT_ARTIFACT.test(record.path) && window.electronAPI.isChannelAvailable('artifacts:preview') && <Button variant="outline" disabled={pending} onClick={() => {
            const request = sequence.current
            const version = record.versions.find(item => item.id === record.currentVersion)!
            setPending(true); setError(undefined)
            void window.electronAPI.previewArtifactVersion(record.id, version.id).then(file => window.electronAPI.readFile(file))
              .then(content => { if (request === sequence.current) { const source = { content, version: version.id, hash: version.hash }; setSelectionSource(source); setAnchor(undefined); saveDraft({ source, anchor: undefined, requestId: crypto.randomUUID() }) } })
              .catch(e => { if (request === sequence.current) setError(String(e)) })
              .finally(() => { if (request === sequence.current) setPending(false) })
          }}>{t('chat.artifactVersions.selectText')}</Button>}
          {selectionSource && <textarea disabled={pending} readOnly aria-label={t('chat.artifactVersions.selectText')} value={selectionSource.content}
            className="w-full min-h-40 rounded-md border border-input bg-background p-3 font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring"
            onSelect={event => { const target = event.currentTarget; const selected = artifactFeedbackAnchor(selectionSource.content, selectionSource.hash, target.selectionStart, target.selectionEnd); setAnchor(selected); saveDraft({ anchor: selected, requestId: crypto.randomUUID() }) }} />}
          {anchor && <p className="whitespace-pre-wrap break-words text-sm">{t('chat.artifactVersions.selectedText')}: {anchor.text}</p>}
          {anchor && selectionSource?.version !== record.currentVersion && <p role="alert" className="text-sm text-destructive">{t('chat.artifactVersions.staleSelection')}</p>}
          <label htmlFor="artifact-feedback" className="text-sm font-medium">{t('chat.artifactVersions.feedback')}</label>
          <textarea disabled={pending} id="artifact-feedback" className="w-full min-h-24 rounded-md border border-input bg-background p-3 text-sm focus-visible:ring-2 focus-visible:ring-ring" value={instruction} onChange={event => { setInstruction(event.target.value); saveDraft({ instruction: event.target.value, requestId: crypto.randomUUID() }) }} />
          {validationContext?.requiresProjectChecks && <details className="text-sm" open={!!validationInputs.trim() && !!validationRoot && validationRoot !== validationContext.root || undefined}>
            <summary className="cursor-pointer focus-visible:ring-2 focus-visible:ring-ring">{t('chat.artifactVersions.validationInputs')}</summary>
            <p className="mt-2">{t('chat.artifactVersions.validationInputsHint')}</p>
            <p className="my-2 break-all font-mono text-xs">{validationRoot ?? validationContext.root}</p>
            {validationInputs.trim() && validationRoot && validationRoot !== validationContext.root && <p role="alert" className="mb-2 text-destructive">{t('chat.artifactVersions.validationRootChanged', { root: validationContext.root })}</p>}
            <label htmlFor="artifact-validation-inputs">{t('chat.artifactVersions.validationInputs')}</label>
            <textarea id="artifact-validation-inputs" disabled={pending} className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring" value={validationInputs} onChange={event => { setValidationInputs(event.target.value); setValidationRoot(validationContext.root); saveDraft({ validationRoot: validationContext.root, validationInputs: event.target.value, requestId: crypto.randomUUID() }) }} />
          </details>}
          <Button disabled={pending || !instruction.trim() || !!validationInputs.trim() && (!validationContext?.requiresProjectChecks || validationRoot !== validationContext.root) || !!anchor && selectionSource?.version !== record.currentVersion || !!feedback && ['queued', 'running', 'validating'].includes(feedback.status)} onClick={() => {
            const request = sequence.current
            setPending(true); setError(undefined)
            const submittedId = requestId.current
            void window.electronAPI.artifactFeedback({ type: 'create', sessionId, artifactId: record.id, baseVersion: record.currentVersion, requestId: requestId.current, instruction, anchor, ...(validationContext?.requiresProjectChecks && validationInputs.trim() ? { validationRoot, validationInputs: validationInputs.split(/\r?\n/).map(line => line.trim()).filter(Boolean) } : {}) })
              .then(value => {
                if (drafts.current.get(draftKey)?.requestId === submittedId) drafts.current.delete(draftKey)
                if (request === sequence.current && requestId.current === submittedId) { setFeedback(value); setHistory(items => mergeArtifactFeedbackHistory(items, [value])); setInstruction(''); setValidationInputs(''); setValidationRoot(undefined); setAnchor(undefined); setSelectionSource(undefined); requestId.current = crypto.randomUUID() }
              })
              .catch(e => { if (request === sequence.current) setError(String(e)) })
              .finally(() => { if (request === sequence.current) setPending(false) })
          }}>{t('chat.artifactVersions.sendFeedback')}</Button>
          {(instruction || validationInputs || selectionSource) && <Button variant="ghost" disabled={pending} onClick={() => { drafts.current.delete(draftKey); setInstruction(''); setValidationInputs(''); setValidationRoot(undefined); setAnchor(undefined); setSelectionSource(undefined); requestId.current = crypto.randomUUID() }}>{t('chat.artifactVersions.discardDraft')}</Button>}
        </div>}
        {history.length > 0 && <div className="space-y-1" aria-label={t('chat.artifactVersions.history')}>
          <p className="text-sm font-medium">{t('chat.artifactVersions.history')}</p>
          {history.map(item => <button key={item.id} type="button" aria-pressed={feedback?.id === item.id}
            className="block w-full rounded-md p-2 text-left text-sm hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-foreground/10"
            onClick={() => setFeedback(item)}>
            <span className="block truncate">{item.instruction}</span>
            <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()} · {t(`chat.artifactVersions.status.${item.status}`)}</span>
          </button>)}
        </div>}
        {feedback && <div className="space-y-2 border-b border-border py-3" role="status">
          <p>{t(`chat.artifactVersions.status.${feedback.status}`)}</p>
          {['queued', 'running', 'validating'].includes(feedback.status) && <Button variant="outline" disabled={pending} onClick={() => {
            const request = sequence.current
            setPending(true); setError(undefined)
            void window.electronAPI.artifactFeedback({ type: 'cancel', sessionId: feedback.sessionId, feedbackId: feedback.id })
              .then(value => { if (request === sequence.current) { setFeedback(current => updateSelectedArtifactFeedback(current, value)); setHistory(items => mergeArtifactFeedbackHistory(items, [value])) } })
              .catch(e => { if (request === sequence.current) setError(String(e)) })
              .finally(() => { if (request === sequence.current) setPending(false) })
          }}>{t('chat.artifactVersions.cancelFeedback')}</Button>}
          {feedback.childSessionId && onOpenSession && <Button variant="outline" onClick={() => onOpenSession(feedback.childSessionId!)}>{t('chat.artifactVersions.openTask')}</Button>}
          {feedback.error && <p className="text-sm text-destructive">{feedback.error}</p>}
          {feedback.validation?.map(item => <p key={item} className="text-xs text-muted-foreground">{item}</p>)}
          {feedback.status === 'applied' && !feedback.userResolved && <Button variant="outline" onClick={() => { const request = sequence.current; void window.electronAPI.artifactFeedback({ type: 'resolve', sessionId: feedback.sessionId, feedbackId: feedback.id }).then(value => { if (request === sequence.current) { setFeedback(current => updateSelectedArtifactFeedback(current, value)); setHistory(items => mergeArtifactFeedbackHistory(items, [value])) } }).catch(e => { if (request === sequence.current) setError(String(e)) }) }}>{t('chat.artifactVersions.resolve')}</Button>}
        </div>}
        <Button variant="outline" onClick={() => onPreview(record.path)}>{t('chat.artifactVersions.preview')}</Button>
        {sessionId && cleanup && cleanup.artifactId === record.id && window.electronAPI.isChannelAvailable('artifacts:cleanup') && <div className="max-w-sm space-y-2 rounded-md border border-destructive/40 p-3">
              <p className="text-sm font-medium">{t('chat.artifactVersions.version', { number: cleanup.ordinal })}</p>
              <p className="text-sm">{t('chat.artifactVersions.cleanupWarning')}</p>
              <div className="flex gap-2">
                <Button variant="destructive" disabled={pending || cleanupInFlight !== undefined} onClick={() => {
                  if (cleanupRunning.current) return
                  cleanupRunning.current = true
                  setCleanupInFlight(draftKey)
                  const request = sequence.current
                  setPending(true); setError(undefined)
                  void window.electronAPI.cleanupArtifactVersions(sessionId, cleanup.artifactId, cleanup.expectedVersion, [cleanup.versionId], cleanup.requestId)
                    .then(value => {
                      if (cleanupDrafts.current.get(draftKey)?.requestId === cleanup.requestId) cleanupDrafts.current.delete(draftKey)
                      setCleanup(current => current?.requestId === cleanup.requestId ? undefined : current)
                      setRecord(current => current?.id === value.id && current.currentVersion === cleanup.expectedVersion ? value : current)
                      if (request === sequence.current) setComparison(undefined)
                    })
                    .catch(e => { if (request === sequence.current) setError(String(e)) })
                    .finally(() => { cleanupRunning.current = false; setCleanupInFlight(undefined); if (request === sequence.current) setPending(false) })
                }}>{t('chat.artifactVersions.cleanupConfirm')}</Button>
                <Button variant="outline" disabled={pending || cleanupInFlight === draftKey} onClick={() => { cleanupDrafts.current.delete(draftKey); setCleanup(undefined) }}>{t('chat.artifactVersions.cleanupCancel')}</Button>
              </div>
            </div>}
        {[...record.versions].reverse().map((version, i) => <div key={version.id} className="flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border py-3">
          <div><p className="text-sm">{t('chat.artifactVersions.version', { number: version.ordinal ?? record.versions.length - i })}{version.id === record.currentVersion && ` · ${t('chat.artifactVersions.current')}`}</p><p className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()} · {version.size} B</p></div>
          <div className="flex flex-wrap gap-2">
          {i < record.versions.length - 1 && TEXT_ARTIFACT.test(record.path)
            && window.electronAPI.isChannelAvailable('artifacts:preview') && <Button variant="outline" disabled={pending} onClick={() => {
              const request = sequence.current
              const position = record.versions.length - i - 1
              const previous = record.versions[position - 1]!
              setPending(true); setError(undefined)
              void Promise.all([previous.id, version.id].map(async id => {
                const file = await window.electronAPI.previewArtifactVersion(record.id, id)
                return window.electronAPI.readFile(file)
              })).then(([original, modified]) => {
                if (request === sequence.current) setComparison({ original: original!, modified: modified!, before: previous.ordinal ?? position, after: version.ordinal ?? position + 1 })
              }).catch(e => { if (request === sequence.current) setError(String(e)) })
                .finally(() => { if (request === sequence.current) setPending(false) })
            }}>{t('chat.artifactVersions.changes')}</Button>}
          {window.electronAPI.isChannelAvailable('artifacts:preview') && <Button variant="outline" disabled={pending} onClick={() => {
            const request = sequence.current
            setPending(true); setError(undefined)
            void window.electronAPI.previewArtifactVersion(record.id, version.id)
              .then(value => { if (request === sequence.current) onPreview(value) })
              .catch(e => { if (request === sequence.current) setError(String(e)) })
              .finally(() => { if (request === sequence.current) setPending(false) })
          }}>{t('chat.artifactVersions.previewVersion')}</Button>}
          {sessionId && version.id !== record.currentVersion && window.electronAPI.isChannelAvailable('artifacts:cleanup') && <Button variant="outline" disabled={pending || !!cleanup} onClick={() => {
            const value = { artifactId: record.id, versionId: version.id, ordinal: version.ordinal ?? record.versions.length - i, expectedVersion: record.currentVersion, requestId: crypto.randomUUID() }
            cleanupDrafts.current.set(draftKey, value); setCleanup(value)
          }}>{t('chat.artifactVersions.cleanup')}</Button>}
          {version.id !== record.currentVersion && <Button variant="outline" disabled={pending} onClick={() => {
            const request = sequence.current
            setPending(true); setError(undefined)
            void window.electronAPI.manageArtifact({ type: 'restore', artifactId: record.id, expectedVersion: record.currentVersion, versionId: version.id })
              .then(value => { if (request === sequence.current) setRecord(value) })
              .catch(e => { if (request === sequence.current) setError(String(e)) })
              .finally(() => { if (request === sequence.current) setPending(false) })
          }}>{t('chat.artifactVersions.restore')}</Button>}
          </div>
        </div>)}
        {comparison && <section className="min-w-0 border-t border-border pt-3" aria-label={t('chat.artifactVersions.changes')}>
          <p className="mb-2 text-sm font-medium">{t('chat.artifactVersions.version', { number: comparison.before })} → {t('chat.artifactVersions.version', { number: comparison.after })}</p>
          <ShikiDiffViewer original={comparison.original} modified={comparison.modified} filePath={record.path} diffStyle="unified" />
        </section>}
      </div>}
    </DialogContent>
  </Dialog>
}
