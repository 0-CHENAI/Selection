import * as React from 'react'
import { ChevronLeft, ChevronDown, Sparkles, Plus, Trash2, Check, X, ExternalLink, RefreshCw, CheckCircle2, XCircle, CircleSlash, DatabaseZap, Zap, Folder } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Spinner, Markdown } from '@craft-agent/ui'
import { getModelShortName } from '@config/models'
import { TaskYamlImport } from './TaskYamlImport'
import { isUnboundTaskEdit } from './orchestration-editor-target'
import { catalogDefaultModel } from './kanban-models'
import { useAtomValue, useStore } from 'jotai'
import { useProjects } from '@/hooks/useProjects'
import { sourcesAtom } from '@/atoms/sources'
import { skillsAtom } from '@/atoms/skills'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import type { KanbanModelProviderGroup, TaskEditorTarget } from './types'
import { uid, buildSpec, specToSubtasks, canDependOn, quickAddNodeId, quickAddChildToSubtask, taskDocumentForSave, canSafelySaveExistingTask, shouldRefreshYamlDraft, specNeedsV3Confirm, DEFAULT_REPAIR_ATTEMPTS, MAX_REPAIR_ATTEMPTS_CAP, SESSION_LIKE_KINDS, type EditorSubtask, type SpecNode, type TaskPermissionMode } from './task-spec-form'
import { runnerLabelKey, runStatusLabelKey } from './task-labels'
import { ConductorWorkbench, type WorkbenchSpec } from './ConductorWorkbench'
import { ApplyRunRevisionDialog, canConfirmRunRevision } from './ApplyRunRevisionDialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isTasksOrchestrateEnabled } from '@craft-agent/shared/feature-flags'
import { resolveNodeStatePill } from './node-state-pill'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceSelectorPopover } from '@/components/ui/SourceSelectorPopover'
import { SkillSelectorPopover } from '@/components/ui/SkillSelectorPopover'
import { WorkingDirectorySelector } from '../input/WorkingDirectorySelector'
import type { LoadedSource, LoadedSkill } from '../../../../shared/types'
import { resolveSkillTitle, resolveSourceTitle } from '@craft-agent/shared/display-titles'
import { buildSensitiveRunParams, sensitiveRunParamNames } from './sensitive-run-params'


function v3MigrationLines(spec: Record<string, unknown>): string[] {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes as Array<{ id?: string; cache?: string }> : []
  const cachePure = nodes.filter((node) => node.cache === 'pure').map((node) => node.id).filter(Boolean)
  const lines = [
    'schema_version becomes 3. v1/v2 run logs are not rewritten.',
    'Coordinator checkpoints wait for submit_orchestration_decision; timeout pauses with coordinator-timeout.',
    'verify/judge nodes must call submit_task_node_verdict. Parent chat is never a run verdict.',
  ]
  if (cachePure.length) {
    lines.push(`cache: pure on ${cachePure.join(', ')} becomes run-pure (same-run only). workspace-pure is never implied.`)
  }
  return lines
}


function resolveModelName(groups: KanbanModelProviderGroup[], id: string): string {
  for (const g of groups) {
    const hit = g.models.find((m) => m.id === id)
    if (hit) return hit.name
  }
  return getModelShortName(id)
}

type Tab = 'definition' | 'canvas' | 'yaml' | 'results'

// The target type lives in ./types so the editor-target atom can import it without
// pulling in this component module; re-exported here for existing consumers.
export type { TaskEditorTarget } from './types'

/** Storage-backed run results (shape inferred from the electronAPI so no shared import is needed). */
type TaskResults = Awaited<ReturnType<typeof window.electronAPI.getTaskResults>>

type EditableTaskSpec = Record<string, unknown> & {
  id?: string
  title?: string
  goal?: string
  acceptance_criteria?: string
  max_iterations?: number
  project?: string
  cwd?: string
  sources?: string[]
  skills?: string[]
  runner?: 'conduct' | 'orchestrate'
  defaults?: { model?: string; llmConnection?: string; permissionMode?: TaskPermissionMode }
  nodes?: SpecNode[]
  params?: Array<{ name?: string; sensitive?: boolean }>
  ui?: { layout?: { nodes?: Record<string, { x: number; y: number }> } }
}

// ---------------------------------------------------------------------------
// Small inline controls (presentational)
// ---------------------------------------------------------------------------
type BtnVariant = 'primary' | 'secondary' | 'ghost'
const BTN_VARIANT: Record<BtnVariant, string> = {
  primary: 'bg-indigo-500 text-white hover:bg-indigo-600',
  secondary: 'border border-border bg-card text-foreground hover:bg-foreground/[0.03]',
  ghost: 'text-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground',
}

function Btn({
  variant = 'secondary',
  className,
  ...rest
}: { variant?: BtnVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-semibold transition-colors',
        'disabled:pointer-events-none disabled:opacity-60',
        BTN_VARIANT[variant],
        className,
      )}
      {...rest}
    />
  )
}

// MUST forward the ref: Radix's <DropdownMenuTrigger asChild> attaches a ref to
// this element to anchor the menu. A function component without forwardRef drops
// that ref and the dropdown fails to open/position.
const SelectButton = React.forwardRef<
  HTMLButtonElement,
  { size?: 'sm' | 'md' } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function SelectButton({ size = 'md', children, className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background font-medium text-foreground',
        'transition-colors hover:bg-foreground/[0.03] data-[state=open]:bg-foreground/[0.03]',
        size === 'sm' ? 'h-7 px-2 text-[11.5px]' : 'h-8 px-2.5 text-[12.5px]',
        className,
      )}
      {...rest}
    >
      {children}
      <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-foreground/40" strokeWidth={2} />
    </button>
  )
})

function ModelSelect({
  value,
  onChange,
  groups,
  width = 168,
  size = 'md',
}: {
  value: string
  onChange: (id: string) => void
  groups: KanbanModelProviderGroup[]
  width?: number
  size?: 'sm' | 'md'
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SelectButton size={size} style={{ width }}>
          <span className="truncate">{resolveModelName(groups, value)}</span>
        </SelectButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[320px] min-w-[180px]">
        {groups.map((g, gi) => (
          <React.Fragment key={`${g.provider}-${gi}`}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] text-foreground/50">{g.label}</DropdownMenuLabel>
            {g.models.map((m) => (
              <DropdownMenuItem key={m.id} className="text-xs" onSelect={() => onChange(m.id)}>
                <span className="truncate">{m.name}</span>
                {m.id === value && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] font-medium text-foreground/55">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/**
 * Overlapping avatar stack for the selector triggers — mirrors the chat input's
 * source badge (first three avatars, then a "+N" chip).
 */
function AvatarStack({
  avatars,
  chromeless = false,
}: {
  avatars: React.ReactNode[]
  chromeless?: boolean
}) {
  const display = avatars.slice(0, 3)
  const remaining = avatars.length - 3
  return (
    <div className="-ml-0.5 flex shrink-0 items-center">
      {display.map((node, i) => (
        <div
          key={i}
          className={cn(
            'relative flex h-5 w-5 items-center justify-center',
            !chromeless && 'rounded-[4px] bg-background shadow-minimal',
            i > 0 && '-ml-1',
          )}
          style={{ zIndex: i + 1 }}
        >
          {node}
        </div>
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            '-ml-1 flex h-5 w-5 items-center justify-center text-[8px] font-medium text-muted-foreground',
            !chromeless && 'rounded-[4px] bg-background shadow-minimal',
          )}
          style={{ zIndex: display.length + 1 }}
        >
          +{remaining}
        </div>
      )}
    </div>
  )
}

/**
 * Sources picker — the chat input's source dropdown (SourceSelectorPopover:
 * avatar rows + filter + check) fronted by the form's bordered SelectButton
 * trigger with a leading avatar stack.
 */
function SourcesField({
  sources,
  values,
  onChange,
  title,
}: {
  sources: LoadedSource[]
  values: string[]
  onChange: (next: string[]) => void
  title?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const selected = values
    .map((slug) => sources.find((s) => s.config.slug === slug))
    .filter((s): s is LoadedSource => Boolean(s))
  const firstName = selected[0] ? resolveSourceTitle(selected[0]) : values[0]
  const label =
    values.length === 0 ? t('tasks.noneSelected') : values.length === 1 ? firstName : `${firstName} +${values.length - 1}`
  const toggle = (slug: string) =>
    onChange(values.includes(slug) ? values.filter((v) => v !== slug) : [...values, slug])
  return (
    <>
      <SelectButton
        ref={anchorRef}
        style={{ width: 168 }}
        title={title}
        data-state={open ? 'open' : 'closed'}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected.length === 0 ? (
          <DatabaseZap className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2} />
        ) : (
          <AvatarStack
            chromeless
            avatars={selected.map((s) => (
              <SourceAvatar key={s.config.slug} source={s} size="xs" chromeless />
            ))}
          />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-left', values.length === 0 && 'text-foreground/50')}>{label}</span>
      </SelectButton>
      <SourceSelectorPopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        sources={sources}
        selectedSlugs={values}
        onToggleSlug={toggle}
      />
    </>
  )
}

/**
 * Skills picker — parallel to {@link SourcesField} using SkillSelectorPopover
 * and SkillAvatar (workspace-scoped icons).
 */
function SkillsField({
  skills,
  values,
  onChange,
  workspaceId,
  title,
}: {
  skills: LoadedSkill[]
  values: string[]
  onChange: (next: string[]) => void
  workspaceId: string
  title?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const selected = values
    .map((slug) => skills.find((s) => s.slug === slug))
    .filter((s): s is LoadedSkill => Boolean(s))
  const firstName = selected[0] ? resolveSkillTitle(selected[0]) : values[0]
  const label =
    values.length === 0 ? t('tasks.noneSelected') : values.length === 1 ? firstName : `${firstName} +${values.length - 1}`
  const toggle = (slug: string) =>
    onChange(values.includes(slug) ? values.filter((v) => v !== slug) : [...values, slug])
  return (
    <>
      <SelectButton
        ref={anchorRef}
        style={{ width: 168 }}
        title={title}
        data-state={open ? 'open' : 'closed'}
        onClick={() => setOpen((prev) => !prev)}
      >
        {selected.length === 0 ? (
          <Zap className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2} />
        ) : (
          <AvatarStack avatars={selected.map((s) => <SkillAvatar key={s.slug} skill={s} size="xs" workspaceId={workspaceId} />)} />
        )}
        <span className={cn('min-w-0 flex-1 truncate text-left', values.length === 0 && 'text-foreground/50')}>{label}</span>
      </SelectButton>
      <SkillSelectorPopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        skills={skills}
        selectedSlugs={values}
        onToggleSlug={toggle}
        workspaceId={workspaceId}
      />
    </>
  )
}

/**
 * Working-directory picker — reuses the chat input's folder selector
 * (WorkingDirectorySelector: recent folders, filter, Choose Folder) behind the
 * form's SelectButton trigger.
 */
function FolderField({
  cwd,
  onChange,
  workspaceId,
}: {
  cwd: string
  onChange: (path: string) => void
  workspaceId: string
}) {
  const { t } = useTranslation()
  return (
    <WorkingDirectorySelector
      workingDirectory={cwd || undefined}
      onWorkingDirectoryChange={onChange}
      workspaceId={workspaceId}
      side="bottom"
      align="start"
      renderTrigger={({ hasFolder, folderName }) => (
        <SelectButton style={{ width: 168 }} title={t('tasks.workingDirectoryHint')}>
          <Folder className="h-3.5 w-3.5 shrink-0 text-foreground/40" strokeWidth={2} />
          <span className={cn('min-w-0 flex-1 truncate text-left', !hasFolder && 'text-foreground/50')}>
            {folderName ?? t('chat.workInFolder')}
          </span>
        </SelectButton>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Subtask card (includes the required prompt)
// ---------------------------------------------------------------------------
function SubtaskCard({
  index,
  subtask,
  allSubtasks,
  groups,
  fallbackModel,
  modelToConnection,
  onChange,
  onRemove,
}: {
  index: number
  subtask: EditorSubtask
  /** Every row, so dependency chips resolve titles (incl. forward edges) and add-candidates can be cycle-filtered. */
  allSubtasks: EditorSubtask[]
  groups: KanbanModelProviderGroup[]
  /** Effective model shown when the node has no explicit one (it inherits the orchestrator default). */
  fallbackModel: string
  /** model id → connection slug, so picking a model pins the connection that serves it. */
  modelToConnection: Map<string, string>
  onChange: (patch: Partial<EditorSubtask>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const titleByUid = new Map(allSubtasks.map((s) => [s.uid, s.title]))
  const depTitle = (depUid: string) => titleByUid.get(depUid) || t('tasks.untitledSubtask')
  const addDep = (depUid: string) => onChange({ dependsOn: [...subtask.dependsOn, depUid] })
  const removeDep = (depUid: string) => onChange({ dependsOn: subtask.dependsOn.filter((d) => d !== depUid) })
  // Candidates exclude self, already-selected, and any edge that would close a cycle.
  const candidates = allSubtasks.filter(
    (s) => !subtask.dependsOn.includes(s.uid) && canDependOn(allSubtasks, subtask.uid, s.uid),
  )
  return (
    <div className="group rounded-[10px] border border-border/70 bg-foreground/[0.015] p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-500/10 text-[12px] font-bold text-indigo-500 dark:text-indigo-300">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={subtask.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={t('tasks.subtaskTitlePlaceholder')}
            className="w-full bg-transparent text-[13.5px] font-semibold text-foreground outline-none placeholder:text-foreground/30"
          />
          <textarea
            value={subtask.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            rows={2}
            placeholder={t('tasks.promptPlaceholder')}
            className="mt-1.5 w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-foreground/25 field-sizing-content max-h-40"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ModelSelect
              value={subtask.model ?? fallbackModel}
              onChange={(id) => onChange({ model: id, llmConnection: modelToConnection.get(id) })}
              groups={groups}
              width={128}
              size="sm"
            />
            {subtask.dependsOn.map((depUid) => (
              <span
                key={depUid}
                className="inline-flex h-7 max-w-[168px] items-center gap-1 rounded-lg border border-border bg-foreground/[0.03] pl-2 pr-1 text-[11.5px] font-medium text-foreground/70"
              >
                <span className="truncate">{t('tasks.dependsOnLabel', { title: depTitle(depUid) })}</span>
                <button
                  type="button"
                  onClick={() => removeDep(depUid)}
                  aria-label={t('tasks.removeDependency')}
                  className="grid h-4 w-4 shrink-0 place-items-center rounded text-foreground/40 hover:bg-foreground/10 hover:text-red-500"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </span>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SelectButton size="sm" style={{ width: 144 }}>
                  <span className="truncate text-foreground/70">
                    {subtask.dependsOn.length === 0 ? t('tasks.noDependencies') : t('tasks.addDependency')}
                  </span>
                </SelectButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-[240px]">
                {candidates.map((c) => (
                  <DropdownMenuItem key={c.uid} className="text-xs" onSelect={() => addDep(c.uid)}>
                    <span className="truncate">{c.title || t('tasks.untitledSubtask')}</span>
                  </DropdownMenuItem>
                ))}
                {candidates.length === 0 && (
                  <div className="px-2 py-1.5 text-[11px] text-foreground/40">{t('tasks.noAvailableSubtasks')}</div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('tasks.removeSubtask')}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-foreground/40 opacity-0 transition-all hover:bg-foreground/10 hover:text-red-500 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task Editor
// ---------------------------------------------------------------------------
export interface TaskEditorProps {
  workspaceId: string
  /** What the editor points at: create-new or edit an existing tile. Defaults to create. */
  target?: TaskEditorTarget
  /** Return to the session list. */
  onClose: () => void
  /** Jump to the underlying orchestrator chat session (edit mode only). */
  onOpenSession?: () => void
  /** Jump to a specific child/subtask session (used by Results "Open session" links). */
  onOpenChildSession?: (sessionId: string) => void
  /**
   * Fired after a successful CREATE (never for edit-mode saves) so the host can land the
   * user somewhere useful — e.g. the session list scoped to the task. `taskLabelId` is the
   * RESOLVED reserved-label id from tasks:create (may be 'task-2' after a name collision).
   */
  onCreated?: (created: { sessionId: string; taskLabelId?: string; projectId?: string }) => void
  /** Real provider→model groups (from the workspace's LLM connections). */
  modelGroups: KanbanModelProviderGroup[]
  /** model id → connection slug that serves it (so each node routes to the right backend). */
  modelToConnection: Map<string, string>
  /** Default model id. */
  defaultModel: string
}

export function TaskEditor(props: TaskEditorProps) {
  const { t } = useTranslation()
  if (isUnboundTaskEdit(props.target)) {
    return <section className="flex h-full flex-col items-start gap-4 p-6">
      <p role="alert">{t('tasks.yamlImportUnbound')}</p>
      <Button onClick={props.onClose}>{t('common.cancel')}</Button>
    </section>
  }
  if (props.target?.mode !== 'edit' || !props.target.taskSlug) {
    const scope = props.target?.mode === 'create' ? props.target.initialProjectId ?? '' : ''
    return <TaskYamlImport key={`${props.workspaceId}:${scope}`} {...props} />
  }
  return <ExistingTaskEditor key={`${props.workspaceId}:${props.target.taskSlug}`} {...props} />
}

function ExistingTaskEditor({
  workspaceId,
  target = { mode: 'create' },
  onClose,
  onOpenSession,
  onOpenChildSession,
  modelGroups,
  modelToConnection,
  defaultModel,
}: TaskEditorProps) {
  const { t } = useTranslation()
  const isEdit = target.mode === 'edit'
  // The slug to pin on save (edit mode). Undefined for create and for quick-add tiles with no slug;
  // in those cases buildSpec derives the id from the title.
  const editSlug = target.mode === 'edit' ? target.taskSlug : undefined
  const editSessionId = target.mode === 'edit' ? target.sessionId : undefined
  const groups = modelGroups
  const fallbackModel = catalogDefaultModel(groups, defaultModel) ?? ''
  const { projects } = useProjects(workspaceId)
  const [tab, setTab] = React.useState<Tab>('definition')
  const [runner, setRunner] = React.useState<'conduct' | 'orchestrate'>('conduct')
  const [layout, setLayout] = React.useState<Record<string, { x: number; y: number }>>({})
  const [yamlDraft, setYamlDraft] = React.useState('')
  const [yamlDiagnostics, setYamlDiagnostics] = React.useState<string[]>([])
  const [yamlHasLocalSource, setYamlHasLocalSource] = React.useState(false)
  const [formChangedSinceYaml, setFormChangedSinceYaml] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [goal, setGoal] = React.useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = React.useState('')
  // Empty string = "use the runner default"; a number pins the spec's max_iterations.
  const [maxRepairs, setMaxRepairs] = React.useState('')
  // Create mode seeds the project from the current sidebar/project scope; edit
  // mode starts empty and is prefilled from the spec below.
  const [projectId, setProjectId] = React.useState(target.mode === 'create' ? (target.initialProjectId ?? '') : '')
  const createProjectScope = target.mode === 'create' ? (target.initialProjectId ?? '') : null
  React.useEffect(() => {
    if (createProjectScope === null) return
    setProjectId(createProjectScope)
  }, [createProjectScope])
  const [orchModel, setOrchModel] = React.useState(fallbackModel)
  // Explicit connection serving the orch model; undefined lets buildSpec derive it from orchModel.
  // Preserved from the loaded spec so an authored connection isn't rewritten on save (round-trip).
  const [orchConnection, setOrchConnection] = React.useState<string | undefined>(undefined)
  // Task-family permission ceiling. Preview tasks fail closed at safe unless the user explicitly
  // raises it; edit mode prefills from the spec. Persisted to defaults.permissionMode.
  const [permissionMode, setPermissionMode] = React.useState<TaskPermissionMode>('safe')
  // The task's project binding at load (edit mode). Floor for buildSpec so leaving the picker on
  // "No Project" can't silently drop a binding, and the gate for whether "No Project" is offered.
  const [boundProjectId, setBoundProjectId] = React.useState('')
  const [subtasks, setSubtasks] = React.useState<EditorSubtask[]>([])
  const [cwd, setCwd] = React.useState('')
  // Task-level sources (enabled on orchestrator + children) and skills (read as context
  // before each child works). Empty = leave workspace defaults / no skill preamble.
  const [sourceSlugs, setSourceSlugs] = React.useState<string[]>([])
  const [skillSlugs, setSkillSlugs] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)

  // Pickable catalogs from the active workspace (AppShell keeps these atoms populated).
  const workspaceSources = useAtomValue(sourcesAtom)
  const workspaceSkills = useAtomValue(skillsAtom)
  // Sources are the task-level pickable catalog (children inherit them); skills are
  // read as context before each child. Both feed the icon-rich selector fields below.
  const enabledSources = React.useMemo(
    () => workspaceSources.filter((s) => s.config.enabled !== false),
    [workspaceSources],
  )

  // Results tab (edit mode): storage-backed run outcome, loaded lazily on tab open / refresh.
  const [results, setResults] = React.useState<TaskResults | null>(null)
  const [resultsLoading, setResultsLoading] = React.useState(false)
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null)
  const [liveRun, setLiveRun] = React.useState<Awaited<ReturnType<typeof window.electronAPI.runTask>> | null>(null)
  const [tokenBudgetDraft, setTokenBudgetDraft] = React.useState('')
  const [sensitiveParamDrafts, setSensitiveParamDrafts] = React.useState<Record<string, string>>({})
  const [etag, setEtag] = React.useState<string | null>(null)
  const [sourceVersion, setSourceVersion] = React.useState<1 | 2 | 3 | undefined>(undefined)
  const [migrationWarnings, setMigrationWarnings] = React.useState<string[]>([])
  const [v3Confirm, setV3Confirm] = React.useState<{ run: boolean; spec: Record<string, unknown> } | null>(null)
  const [preservedSpec, setPreservedSpec] = React.useState<Record<string, unknown> | undefined>(undefined)
  const [taskLoadError, setTaskLoadError] = React.useState<string | null>(null)
  const [revisionDialogOpen, setRevisionDialogOpen] = React.useState(false)
  const [revisionPreview, setRevisionPreview] = React.useState<Awaited<ReturnType<typeof window.electronAPI.applyTaskRunRevision>> | null>(null)
  const [revisionPreviewRunId, setRevisionPreviewRunId] = React.useState<string | null>(null)
  const [revisionPreviewLoading, setRevisionPreviewLoading] = React.useState(false)
  const [revisionApplying, setRevisionApplying] = React.useState(false)
  const [revisionError, setRevisionError] = React.useState<string | null>(null)

  const markFormChanged = React.useCallback(() => {
    setDirty(true)
    setFormChangedSinceYaml(true)
  }, [])

  // Jotai store handle for one-shot reads (no subscription — the editor must not re-render
  // on every streaming metadata tick just to have read children once at open).
  const store = useStore()

  /**
   * The tile's quick-add children as editor rows, so hand-spawned subtasks show up (and get
   * adopted into the spec on save) instead of living only on the tile. Each row carries the
   * deterministic node id `qa-<sessionId>`; a child whose qa-id is already a spec node was
   * adopted by a previous save and is skipped. Conductor-owned children (`taskNodeId`) are
   * executions of spec nodes — the node row already represents them.
   */
  const collectQuickAddRows = React.useCallback(
    (adoptedNodeIds: ReadonlySet<string>): EditorSubtask[] => {
      if (!editSessionId) return []
      const metaMap = store.get(sessionMetaMapAtom)
      const children = [...metaMap.values()]
        .filter(
          (child) =>
            child.parentSessionId === editSessionId &&
            !child.taskNodeId &&
            !child.hidden &&
            !child.isArchived &&
            !adoptedNodeIds.has(quickAddNodeId(child.id)),
        )
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      return children.map((child) => {
        // Quick-add contract: the typed title is the session name AND the dispatch prompt. Preserve the
        // child's explicit model + connection (custom-routed children must not lose their backend).
        const title = child.name?.trim() || getSessionTitle(child)
        return quickAddChildToSubtask({ sessionId: child.id, title, model: child.model, llmConnection: child.llmConnection })
      })
    },
    [store, editSessionId],
  )

  // Edit-mode prefill: spec-backed tiles load their authored task.yaml; either way the tile's
  // quick-add children merge in as editable rows (adopted into the spec on the next save).
  React.useEffect(() => {
    setTaskLoadError(null)
    setPreservedSpec(undefined)
    setEtag(null)
    setYamlHasLocalSource(false)
    setFormChangedSinceYaml(false)
    if (target.mode !== 'edit') return
    let cancelled = false
    // The tile's existing project binding (spec-less quick-add tiles have no spec.project, so fall
    // back to the session's own projectId) — prefilled into the picker and kept as the buildSpec floor.
    const sessionMeta = editSessionId ? store.get(sessionMetaMapAtom).get(editSessionId) : undefined
    const sessionProjectId = sessionMeta?.projectId ?? ''
    if (target.taskSlug) {
      void window.electronAPI
        .getTask(workspaceId, target.taskSlug)
        .then((res) => {
          if (cancelled) return
          const spec = res.spec as EditableTaskSpec | undefined
          if (!spec) {
            const message = t('tasks.loadMissingSpec')
            setTaskLoadError(message)
            toast.error(t('tasks.toastLoadFailed'), { description: message })
            return
          }
          if (!res.etag) {
            const message = t('tasks.loadMissingEtag')
            setTaskLoadError(message)
            toast.error(t('tasks.toastLoadFailed'), { description: message })
            return
          }
          setPreservedSpec(spec)
          setEtag(res.etag)
          if (res.latestRun) setLiveRun(res.latestRun)
          setSourceVersion(res.sourceVersion)
          setMigrationWarnings(res.migrationWarnings ?? [])
          if (res.yaml) {
            setYamlDraft(res.yaml)
            setYamlHasLocalSource(true)
          }
          if (spec.runner) setRunner(spec.runner)
          if (spec.ui?.layout?.nodes) setLayout(spec.ui.layout.nodes)
          setDirty(false)
          if (spec.title) setTitle(spec.title)
          if (spec.goal) setGoal(spec.goal)
          setAcceptanceCriteria(spec.acceptance_criteria ?? '')
          setMaxRepairs(spec.max_iterations != null ? String(spec.max_iterations) : '')
          // Bind from the spec, else the session's existing binding. Record it as the immutable floor.
          const bound = spec.project ?? sessionProjectId
          setProjectId(bound)
          setBoundProjectId(bound)
          if (spec.cwd) setCwd(spec.cwd)
          setSourceSlugs(spec.sources ?? [])
          setSkillSlugs(spec.skills ?? [])
          if (spec.defaults?.model) setOrchModel(spec.defaults.model)
          // Preserve the authored orchestrator connection + permission mode (round-trip, no silent rewrite).
          // Fall back to the session's actual mode so saving a bound tile can't silently escalate it.
          setOrchConnection(spec.defaults?.llmConnection)
          if (spec.defaults?.permissionMode) setPermissionMode(spec.defaults.permissionMode)
          else if (sessionMeta?.permissionMode) setPermissionMode(sessionMeta.permissionMode as TaskPermissionMode)
          const nodes = spec.nodes ?? []
          setSubtasks([
            ...specToSubtasks(nodes),
            ...collectQuickAddRows(new Set(nodes.map((n) => n.id))),
          ])
        })
        .catch((error) => {
          if (cancelled) return
          const message = error instanceof Error ? error.message : String(error)
          setTaskLoadError(message)
          toast.error(t('tasks.toastLoadFailed'), { description: message })
        })
    } else {
      if (target.initialTitle) setTitle(target.initialTitle)
      // A bound quick-add tile with no task.yaml: prefill + floor from the session's own state, so
      // saving it as a task neither drops its project nor silently changes its permission mode.
      setProjectId(sessionProjectId)
      setBoundProjectId(sessionProjectId)
      if (sessionMeta?.permissionMode) setPermissionMode(sessionMeta.permissionMode as TaskPermissionMode)
      setSubtasks(collectQuickAddRows(new Set()))
    }
    return () => {
      cancelled = true
    }
    // Prefill runs once per target identity; fallbackModel is stable enough for this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.mode, editSessionId, editSlug, workspaceId])

  const loadResults = React.useCallback((runId?: string) => {
    if (!editSlug) return
    setResultsLoading(true)
    void window.electronAPI
      .getTaskResults(workspaceId, editSlug, runId)
      .then((res) => {
        setResults(res)
        if (res.runId) setSelectedRunId(res.runId)
      })
      .catch(() => {})
      .finally(() => setResultsLoading(false))
  }, [workspaceId, editSlug])

  // Load results when the Results tab is first opened (and there's a slug to read).
  React.useEffect(() => {
    if (tab === 'results' && editSlug && !results && !resultsLoading) loadResults()
  }, [tab, editSlug, results, resultsLoading, loadResults])

  React.useEffect(() => {
    if (!editSlug) return
    return window.electronAPI.onTaskRunChanged((_ws, snapshot) => {
      if (snapshot.slug !== editSlug) return
      setLiveRun(snapshot)
    })
  }, [editSlug])

  const controlRun = React.useCallback(
    async (op: 'pause' | 'resume' | 'stop' | 'continue') => {
      if (!editSlug || !liveRun) return
      const api = {
        pause: window.electronAPI.pauseTask,
        resume: window.electronAPI.resumeTask,
        stop: window.electronAPI.stopTask,
        continue: window.electronAPI.continueTask,
      }[op]
      try {
        const res = await api(workspaceId, editSlug, liveRun.runId)
        if (res.conflict) {
          toast.error(t('tasks.toastControlConflict'), { description: res.conflict.message })
          return
        }
        setLiveRun(res.snapshot)
      } catch (err) {
        toast.error(t('tasks.toastRunFailed'), { description: err instanceof Error ? err.message : String(err) })
      }
    },
    [editSlug, liveRun, workspaceId, t],
  )

  const increaseTokenBudget = React.useCallback(async () => {
    if (!editSlug || !liveRun) return
    const tokenBudget = Number(tokenBudgetDraft)
    if (!Number.isFinite(tokenBudget) || tokenBudget <= (liveRun.tokenBudget ?? liveRun.tokensUsed)) {
      toast.error(t('tasks.toastControlConflict'), { description: t('tasks.budgetMustIncrease') })
      return
    }
    const res = await window.electronAPI.updateTaskRunLimits(workspaceId, {
      slug: editSlug,
      runId: liveRun.runId,
      tokenBudget,
    })
    if (res.conflict) {
      toast.error(t('tasks.toastControlConflict'), { description: res.conflict.message })
      return
    }
    setLiveRun(res.snapshot)
    setTokenBudgetDraft('')
  }, [editSlug, liveRun, tokenBudgetDraft, workspaceId, t])

  const sensitiveParams = React.useMemo(
    () => sensitiveRunParamNames(preservedSpec),
    [preservedSpec],
  )

  React.useEffect(() => {
    setSensitiveParamDrafts({})
  }, [liveRun?.runId])

  const restoreSensitiveParams = React.useCallback(async () => {
    if (!editSlug || !liveRun) return
    const resolved = buildSensitiveRunParams(sensitiveParams, sensitiveParamDrafts)
    if (!resolved.params) {
      toast.error(t('tasks.sensitiveParamsRequired'), { description: resolved.missing.join(', ') })
      return
    }
    try {
      const res = await window.electronAPI.updateTaskRunLimits(workspaceId, {
        slug: editSlug,
        runId: liveRun.runId,
        params: resolved.params,
      })
      if (res.conflict) {
        toast.error(t('tasks.toastControlConflict'), { description: res.conflict.message })
        return
      }
      setLiveRun(res.snapshot)
      setSensitiveParamDrafts({})
      toast.success(t('tasks.sensitiveParamsRestored'))
    } catch (err) {
      toast.error(t('tasks.toastRunFailed'), { description: err instanceof Error ? err.message : String(err) })
    }
  }, [editSlug, liveRun, sensitiveParamDrafts, sensitiveParams, workspaceId, t])

  const previewRunRevision = React.useCallback(async () => {
    const runId = selectedRunId ?? results?.runId ?? liveRun?.runId
    if (!editSlug || !runId || !etag) return
    setRevisionDialogOpen(true)
    setRevisionPreview(null)
    setRevisionPreviewRunId(runId)
    setRevisionError(null)
    setRevisionPreviewLoading(true)
    try {
      const preview = await window.electronAPI.applyTaskRunRevision(workspaceId, {
        slug: editSlug,
        runId,
        expectedEtag: etag,
        confirm: false,
      })
      setRevisionPreview(preview)
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRevisionPreviewLoading(false)
    }
  }, [editSlug, etag, liveRun?.runId, results?.runId, selectedRunId, workspaceId])

  const confirmRunRevision = React.useCallback(async () => {
    const preview = revisionPreview
    if (!editSlug || !revisionPreviewRunId || !etag || !preview || !canConfirmRunRevision(preview)) return
    setRevisionApplying(true)
    setRevisionError(null)
    try {
      const applied = await window.electronAPI.applyTaskRunRevision(workspaceId, {
        slug: editSlug,
        runId: revisionPreviewRunId,
        expectedEtag: etag,
        expectedRunRevision: preview.runRevision,
        expectedRunSpecHash: preview.runSpecHash,
        confirm: true,
        confirmV3Migration: (preview.migrationWarnings?.length ?? 0) > 0,
      })
      if (applied.conflict) {
        setRevisionPreview((current) => current ? { ...current, conflict: applied.conflict } : applied)
        setRevisionError(applied.conflict.code === 'etag-conflict'
          ? t('tasks.revisionEtagConflict')
          : t('tasks.revisionRunConflict'))
        return
      }
      if (!applied.applied || !applied.validation.valid || !applied.yaml || !applied.etag) {
        setRevisionPreview(applied)
        setRevisionError(t('tasks.revisionApplyFailed'))
        return
      }

      const spec = applied.validation.spec as EditableTaskSpec | undefined
      setYamlDraft(applied.yaml)
      setEtag(applied.etag)
      setSourceVersion(applied.sourceVersion ?? 2)
      setMigrationWarnings(applied.migrationWarnings ?? [])
      setYamlDiagnostics([])
      setYamlHasLocalSource(true)
      setFormChangedSinceYaml(false)
      setDirty(false)
      if (spec) {
        setPreservedSpec(spec)
        setSubtasks(specToSubtasks(spec.nodes ?? []))
        if (spec.runner) setRunner(spec.runner)
        setLayout(spec.ui?.layout?.nodes ?? {})
      }
      setRevisionDialogOpen(false)
      setRevisionPreview(null)
      setRevisionPreviewRunId(null)
      setTab('yaml')
      toast.success(t('tasks.revisionApplySuccess'))
    } catch (error) {
      setRevisionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRevisionApplying(false)
    }
  }, [editSlug, etag, revisionPreview, revisionPreviewRunId, t, workspaceId])


  const project = projects.find((p) => p.config.id === projectId)

  const updateSubtask = (id: string, patch: Partial<EditorSubtask>) => {
    markFormChanged()
    setSubtasks((prev) => prev.map((s) => (s.uid === id ? { ...s, ...patch } : s)))
  }
  const removeSubtask = (id: string) => {
    markFormChanged()
    setSubtasks((prev) =>
      prev.filter((s) => s.uid !== id).map((s) => ({ ...s, dependsOn: s.dependsOn.filter((d) => d !== id) })),
    )
  }
  const addSubtask = () => {
    markFormChanged()
    setSubtasks((prev) => {
      const last = prev[prev.length - 1]
      // No explicit model → the new subtask inherits the orchestrator default (the picker still shows
      // that effective model). Picking a model in the row makes it explicit.
      return [...prev, { uid: uid(), title: '', prompt: '', dependsOn: last ? [last.uid] : [] }]
    })
  }


  const currentSpec = React.useCallback((): WorkbenchSpec => {
    return buildSpec(
      {
        title,
        goal,
        acceptanceCriteria,
        maxRepairs: maxRepairs.trim() === '' ? undefined : Number(maxRepairs),
        projectId,
        orchModel,
        orchConnection,
        permissionMode,
        boundProjectId,
        subtasks,
        cwd,
        sourceSlugs,
        skillSlugs,
        fixedId: editSlug,
        runner,
        layout,
        preservedSpec,
      },
      modelToConnection,
    ) as unknown as WorkbenchSpec
  }, [
    title, goal, acceptanceCriteria, maxRepairs, projectId, orchModel, orchConnection, permissionMode,
    boundProjectId, subtasks, cwd, sourceSlugs, skillSlugs, editSlug, runner, layout, preservedSpec, modelToConnection,
  ])

  const requestClose = React.useCallback(() => {
    if (dirty && !window.confirm(t('tasks.discardUnsaved'))) return
    onClose()
  }, [dirty, onClose, t])

  const applyWorkbenchSpec = React.useCallback((next: EditableTaskSpec, source: 'form' | 'yaml' = 'form') => {
    setPreservedSpec(next)
    setDirty(true)
    setFormChangedSinceYaml(source === 'form')
    if (source === 'yaml') setYamlHasLocalSource(true)
    setTitle(typeof next.title === 'string' ? next.title : '')
    setGoal(typeof next.goal === 'string' ? next.goal : '')
    setAcceptanceCriteria(typeof next.acceptance_criteria === 'string' ? next.acceptance_criteria : '')
    setMaxRepairs(typeof next.max_iterations === 'number' ? String(next.max_iterations) : '')
    setProjectId(typeof next.project === 'string' ? next.project : '')
    setCwd(typeof next.cwd === 'string' ? next.cwd : '')
    setSourceSlugs(Array.isArray(next.sources) ? next.sources : [])
    setSkillSlugs(Array.isArray(next.skills) ? next.skills : [])
    setRunner(next.runner === 'orchestrate' ? 'orchestrate' : 'conduct')
    setOrchModel(next.defaults?.model ?? '')
    setOrchConnection(next.defaults?.llmConnection)
    setPermissionMode(next.defaults?.permissionMode ?? 'safe')
    setLayout(next.ui?.layout?.nodes ?? {})
    setSubtasks(specToSubtasks(next.nodes ?? []))
  }, [])

  const validateYamlDraft = React.useCallback(async () => {
    try {
      const res = await window.electronAPI.validateTask(workspaceId, yamlDraft)
      if (!res.valid) {
        setYamlDiagnostics(res.errors.map((e) => `${e.path}: ${e.message}`))
        return
      }
      setYamlDiagnostics([])
      if (res.spec) applyWorkbenchSpec(res.spec as EditableTaskSpec, 'yaml')
    } catch (err) {
      setYamlDiagnostics([err instanceof Error ? err.message : String(err)])
    }
  }, [workspaceId, yamlDraft, applyWorkbenchSpec])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void submit(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Save only an existing, successfully loaded task. Running remains an explicit action.
  async function submit(run: boolean, confirmV3Migration = false) {
    if (isEdit && !canSafelySaveExistingTask({ taskSlug: editSlug, etag, loadError: taskLoadError })) {
      toast.error(t('tasks.toastLoadFailed'), { description: taskLoadError ?? t('tasks.loadFailedBanner') })
      return
    }
    if (tab !== 'yaml') {
      if (!title.trim()) {
        toast.error(t('tasks.toastNeedTitle'))
        return
      }
      if (subtasks.length === 0) {
        toast.error(t('tasks.toastNeedSubtask'))
        return
      }
      if (subtasks.some((s) => SESSION_LIKE_KINDS.has(s.kind ?? 'session') && !s.prompt.trim())) {
        toast.error(t('tasks.toastNeedPrompt'))
        return
      }
    }
    setBusy(true)
    try {
      let spec: Record<string, unknown>
      let yaml: string
      if (tab === 'yaml') {
        const validation = await window.electronAPI.validateTask(workspaceId, yamlDraft)
        if (!validation.valid || !validation.spec) {
          setYamlDiagnostics(validation.errors.map((e) => `${e.path}: ${e.message}`))
          const first = validation.errors[0]
          toast.error(t('tasks.toastInvalid'), { description: first ? `${first.path}: ${first.message}` : undefined })
          return
        }
        spec = validation.spec as Record<string, unknown>
        if (isEdit && editSlug && spec.id !== editSlug) {
          const message = t('tasks.taskIdImmutable', { id: editSlug })
          setYamlDiagnostics([message])
          toast.error(t('tasks.toastInvalid'), { description: message })
          return
        }
        // The YAML tab is a real authoring source. Save exactly the validated
        // document instead of rebuilding a lossy subset from form state.
        yaml = taskDocumentForSave('yaml', yamlDraft, spec)
        setYamlDiagnostics([])
        setPreservedSpec(spec)
      } else {
        // Edit mode pins the existing slug so the title can change without forking a new task folder
        // and orphaning the bound orchestrator session.
        spec = buildSpec(
          {
            title,
            goal,
            acceptanceCriteria,
            maxRepairs: maxRepairs.trim() === '' ? undefined : Number(maxRepairs),
            projectId,
            orchModel,
            orchConnection,
            permissionMode,
            boundProjectId,
            subtasks,
            cwd,
            sourceSlugs,
            skillSlugs,
            fixedId: editSlug,
            runner,
            layout,
            preservedSpec,
          },
          modelToConnection,
        )
        yaml = taskDocumentForSave('form', yamlDraft, spec)
      }
      if (specNeedsV3Confirm(sourceVersion, spec) && !confirmV3Migration) {
        setV3Confirm({ run, spec })
        return
      }
      if (isEdit && etag) {
        const saved = await window.electronAPI.saveTask(workspaceId, {
          yaml,
          expectedEtag: etag,
          confirmV3Migration: confirmV3Migration || specNeedsV3Confirm(sourceVersion, spec),
        })
        if (saved.conflict) {
          toast.error(t('tasks.toastEtagConflict'))
          return
        }
        if (!saved.validation.valid) {
          const first = saved.validation.errors[0]
          toast.error(t('tasks.toastInvalid'), { description: first ? `${first.path}: ${first.message}` : undefined })
          return
        }
        setEtag(saved.etag ?? null)
        setSourceVersion(saved.sourceVersion)
        setMigrationWarnings(saved.migrationWarnings ?? [])
        if (!run) {
          toast.success(t('tasks.toastSaved'), { description: saved.slug })
          onClose()
          return
        }
        const runResult = await window.electronAPI.runTask(workspaceId, {
          slug: saved.slug,
          orchestratorSessionId: editSessionId,
        })
        toast.success(t('tasks.toastStarted'), {
          description: t('tasks.toastStartedDesc', { slug: saved.slug, runId: runResult.runId, count: runResult.nodes.length }),
        })
        onClose()
        return
      }
    } catch (err) {
      toast.error(t('tasks.toastCreateFailed'), { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 bg-background p-3 text-foreground">
      {/* Header */}
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-minimal">
        <Btn variant="ghost" className="px-2" onClick={requestClose}>
          <ChevronLeft className="h-4 w-4" strokeWidth={2} /> {t('kanban.list')}
        </Btn>
        <span className="text-foreground/25">/</span>
        <span className="text-sm font-semibold">{isEdit ? t('tasks.editTask') : t('kanban.newTask')}</span>

        {/* Definition / Results tabs — edit mode only (results need a backing task to read). */}
        <div className="ml-3 inline-flex rounded-[9px] bg-foreground/[0.05] p-0.5">
          {(isEdit ? (['definition', 'canvas', 'yaml', 'results'] as Tab[]) : (['definition', 'canvas', 'yaml'] as Tab[])).map((tb) => (
            <button
              key={tb}
              onClick={() => {
                if (tb === 'yaml' && shouldRefreshYamlDraft(yamlHasLocalSource, formChangedSinceYaml)) {
                  setYamlDraft(JSON.stringify(currentSpec(), null, 2))
                  setYamlHasLocalSource(true)
                  setFormChangedSinceYaml(false)
                }
                setTab(tb)
              }}
              className={cn(
                'rounded-[7px] px-3 py-1 text-[12.5px] font-semibold transition-colors',
                tab === tb ? 'bg-card text-foreground shadow-minimal' : 'text-foreground/55 hover:text-foreground/80',
              )}
            >
              {tb === 'definition' && t('tasks.tabDefinition')}
              {tb === 'canvas' && t('tasks.tabCanvas')}
              {tb === 'yaml' && t('tasks.tabYaml')}
              {tb === 'results' && t('tasks.tabResults')}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isEdit && onOpenSession && (
            <Btn variant="secondary" onClick={onOpenSession} disabled={busy}>
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /> {t('tasks.openSession')}
            </Btn>
          )}
          {isEdit && liveRun && !['completed', 'failed', 'stopped'].includes(liveRun.status) && (
            <div className="flex items-center gap-1.5">
              {(liveRun.status === 'running' || liveRun.status === 'verifying' || liveRun.status === 'repairing') && (
                <Btn variant="secondary" onClick={() => void controlRun('pause')}>{t('tasks.pauseRun')}</Btn>
              )}
              {(liveRun.status === 'paused' || liveRun.status === 'pausing') && (
                <Btn variant="secondary" onClick={() => void controlRun('resume')}>{t('tasks.resumeRun')}</Btn>
              )}
              {liveRun.status === 'interrupted' && (
                <Btn variant="secondary" onClick={() => void controlRun('continue')}>{t('tasks.continueRun')}</Btn>
              )}
              <Btn variant="secondary" onClick={() => void controlRun('stop')}>{t('tasks.stopRun')}</Btn>
            </div>
          )}
          {isEdit && liveRun?.nodes.some((n) => n.state === 'waiting-approval') && (
            <div className="flex items-center gap-1.5">
              {liveRun.nodes.filter((n) => n.state === 'waiting-approval').map((n) => (
                <span key={n.id} className="flex items-center gap-1">
                  <Btn
                    variant="secondary"
                    onClick={() => void window.electronAPI.respondTaskApproval(workspaceId, {
                      slug: editSlug!,
                      runId: liveRun.runId,
                      nodeId: n.id,
                      approved: true,
                    }).then((res) => { if (!res.conflict) setLiveRun(res.snapshot) })}
                  >
                    {t('tasks.approveNode', { id: n.id })}
                  </Btn>
                  <Btn
                    variant="secondary"
                    onClick={() => void window.electronAPI.respondTaskApproval(workspaceId, {
                      slug: editSlug!,
                      runId: liveRun.runId,
                      nodeId: n.id,
                      approved: false,
                    }).then((res) => { if (!res.conflict) setLiveRun(res.snapshot) })}
                  >
                    {t('tasks.rejectNode', { id: n.id })}
                  </Btn>
                </span>
              ))}
            </div>
          )}
          {isEdit && liveRun?.status === 'waiting-budget' && (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={(liveRun.tokenBudget ?? liveRun.tokensUsed) + 1}
                step="1"
                value={tokenBudgetDraft}
                onChange={(event) => setTokenBudgetDraft(event.target.value)}
                placeholder={String((liveRun.tokenBudget ?? liveRun.tokensUsed) + 1)}
                aria-label={t('tasks.newTokenBudget')}
                className="h-7 w-28 rounded-md border border-border bg-background px-2 text-[11.5px]"
              />
              <Btn variant="secondary" onClick={() => void increaseTokenBudget()}>
                {t('tasks.increaseBudget')}
              </Btn>
            </div>
          )}
          {isEdit && liveRun?.status === 'interrupted' && sensitiveParams.length > 0 && (
            <div className="flex items-center gap-1.5" aria-label={t('tasks.sensitiveParamsTitle')}>
              {sensitiveParams.map((name) => (
                <input
                  key={name}
                  type="password"
                  autoComplete="off"
                  value={sensitiveParamDrafts[name] ?? ''}
                  onChange={(event) => setSensitiveParamDrafts((current) => ({
                    ...current,
                    [name]: event.target.value,
                  }))}
                  placeholder={name}
                  aria-label={t('tasks.sensitiveParamInput', { name })}
                  className="h-7 w-28 rounded-md border border-border bg-background px-2 text-[11.5px]"
                />
              ))}
              <Btn variant="secondary" onClick={() => void restoreSensitiveParams()}>
                {t('tasks.restoreSensitiveParams')}
              </Btn>
            </div>
          )}
          {(tab === 'definition' || tab === 'canvas' || tab === 'yaml') && (
            <>
              <Btn variant="secondary" onClick={requestClose} disabled={busy}>
                {t('common.cancel')}
              </Btn>
              <Btn variant="secondary" onClick={() => submit(false)} disabled={busy || !!taskLoadError}>
                {isEdit ? t('common.save') : t('common.create')}
              </Btn>
              <Btn variant="primary" onClick={() => submit(true)} disabled={busy || !!taskLoadError}>
                {busy ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />}
                {busy ? t('tasks.starting') : isEdit ? t('tasks.saveAndRun') : t('tasks.createAndRun')}
              </Btn>
            </>
          )}
          {tab === 'results' && (
            <Btn variant="secondary" onClick={() => loadResults()} disabled={resultsLoading}>
              {resultsLoading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />} {t('common.refresh')}
            </Btn>
          )}
        </div>
      </div>

      {taskLoadError && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-700 dark:text-red-300">
          <span className="font-semibold">{t('tasks.loadFailedBanner')}</span>{' '}
          <span>{taskLoadError}</span>
        </div>
      )}

      {liveRun && ((liveRun.blockers?.length ?? 0) > 0 || liveRun.nodes.some((node) => node.blocker)) && (
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px] text-foreground/80">
          <div className="font-semibold">{t('tasks.runBlockers')}</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {(liveRun.blockers ?? []).map((blocker, index) => <li key={`run:${index}:${blocker}`}>{blocker}</li>)}
            {liveRun.nodes.filter((node) => node.blocker).map((node) => (
              <li key={`node:${node.id}:${node.blocker}`}>
                <span className="font-mono">{node.id}</span>: {node.blocker}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'definition' && migrationWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12.5px] text-foreground/80">
          {t(sourceVersion === 3 ? 'tasks.migrationBannerV3' : 'tasks.migrationBanner', { version: sourceVersion ?? 1 })}
          <ul className="mt-1 list-disc pl-4">
            {migrationWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'results' ? (
        <ResultsPanel
          results={results}
          loading={resultsLoading}
          selectedRunId={selectedRunId}
          onSelectRun={(id) => {
            setSelectedRunId(id)
            loadResults(id)
          }}
          onOpenChildSession={onOpenChildSession}
          onApplyRunRevision={() => void previewRunRevision()}
          canApplyRunRevision={Boolean(editSlug && etag && (selectedRunId ?? results?.runId ?? liveRun?.runId))}
        />
      ) : tab === 'yaml' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <textarea
            className="min-h-[280px] flex-1 rounded-xl border border-border bg-card p-3 font-mono text-[12px]"
            value={yamlDraft}
            onChange={(e) => {
              setDirty(true)
              setYamlHasLocalSource(true)
              setFormChangedSinceYaml(false)
              setYamlDraft(e.target.value)
            }}
            onBlur={() => void validateYamlDraft()}
            spellCheck={false}
            aria-label={t('tasks.tabYaml')}
          />
          {yamlDiagnostics.length > 0 && (
            <ul className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[12px] text-red-700">
              {yamlDiagnostics.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      ) : tab === 'canvas' ? (
        <ConductorWorkbench spec={currentSpec()} liveRun={liveRun} />
      ) : (
      /* Body */
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,2fr)_3fr] gap-3">
        {/* Left — definition */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-minimal">
          <div className="text-[15px] font-bold">{t('tasks.definition')}</div>


          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-foreground/55">{t('tasks.title')}</div>
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); markFormChanged() }}
              placeholder={t('tasks.titlePlaceholder')}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] font-semibold outline-none focus:border-foreground/25"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-semibold text-foreground/55">{t('tasks.goal')}</span>
              <span className="text-[10.5px] text-foreground/35">{t('tasks.goalHint')}</span>
            </div>
            <textarea
              value={goal}
              onChange={(e) => { setGoal(e.target.value); markFormChanged() }}
              rows={4}
              placeholder={t('tasks.goalPlaceholder')}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-foreground/25 field-sizing-content max-h-48"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] font-semibold text-foreground/55">{t('tasks.acceptanceCriteria')}</span>
              <span className="text-[10.5px] text-foreground/35">{t('tasks.acceptanceCriteriaHint')}</span>
            </div>
            <textarea
              value={acceptanceCriteria}
              onChange={(e) => { setAcceptanceCriteria(e.target.value); markFormChanged() }}
              rows={3}
              placeholder={t('tasks.acceptanceCriteriaPlaceholder')}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-foreground/25 field-sizing-content max-h-48"
            />
          </div>

          <div className="flex flex-col gap-3">
            <FieldRow label={t('tasks.project')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SelectButton style={{ width: 168 }}>
                    <span className="truncate">{project ? project.config.name : t('tasks.noProject')}</span>
                  </SelectButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {/* "No Project" clears the binding — only offered when NOT already bound. The backend
                      never unbinds on save, and buildSpec floors a blank pick to the existing project,
                      so showing it for a bound task would be a no-op that implies clearing works. */}
                  {!boundProjectId && (
                    <DropdownMenuItem className="text-xs" onSelect={() => { setProjectId(''); markFormChanged() }}>
                      {t('tasks.noProject')}
                      {!projectId && <Check className="ml-auto h-3.5 w-3.5" strokeWidth={2} />}
                    </DropdownMenuItem>
                  )}
                  {projects.map((p) => (
                    <DropdownMenuItem key={p.config.id} className="text-xs" onSelect={() => { setProjectId(p.config.id); markFormChanged() }}>
                      <span className="truncate">{p.config.name}</span>
                      {projectId === p.config.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldRow>

            <FieldRow label={t('tasks.runnerLabel')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SelectButton style={{ width: 196 }}>
                    <span className="truncate">{t(runnerLabelKey(runner, isTasksOrchestrateEnabled()))}</span>
                  </SelectButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-xs" onSelect={() => { setRunner('conduct'); markFormChanged() }}>
                    {t('tasks.runnerConduct')}
                    {runner === 'conduct' && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-xs"
                    disabled={!isTasksOrchestrateEnabled()}
                    onSelect={() => { setRunner('orchestrate'); markFormChanged() }}
                  >
                    {t(runnerLabelKey('orchestrate', isTasksOrchestrateEnabled()))}
                    {runner === 'orchestrate' && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldRow>
            <FieldRow label={t('tasks.orchestratorModel')}>
              <ModelSelect
                value={orchModel}
                onChange={(m) => {
                  // Keep the connection in step with the model: an unchanged model preserves the loaded
                  // (possibly custom) connection; changing it re-routes to the new model's connection.
                  setOrchModel(m)
                  setOrchConnection(modelToConnection.get(m))
                  markFormChanged()
                }}
                groups={groups}
              />
            </FieldRow>

            <FieldRow label={t('tasks.permissionMode')}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SelectButton style={{ width: 168 }}>
                    <span className="truncate">{t(`mode.${permissionMode}`)}</span>
                  </SelectButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  {(['allow-all', 'ask', 'safe'] as const).map((m) => (
                    <DropdownMenuItem key={m} className="text-xs" onSelect={() => { setPermissionMode(m); markFormChanged() }}>
                      <span className="truncate">{t(`mode.${m}`)}</span>
                      {permissionMode === m && <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldRow>

            {enabledSources.length > 0 && (
              <FieldRow label={t('tasks.sources')}>
                <SourcesField
                  sources={enabledSources}
                  values={sourceSlugs}
                  onChange={(values) => { setSourceSlugs(values); markFormChanged() }}
                  title={t('tasks.sourcesHint')}
                />
              </FieldRow>
            )}

            {workspaceSkills.length > 0 && (
              <FieldRow label={t('tasks.skills')}>
                <SkillsField
                  skills={workspaceSkills}
                  values={skillSlugs}
                  onChange={(values) => { setSkillSlugs(values); markFormChanged() }}
                  workspaceId={workspaceId}
                  title={t('tasks.skillsHint')}
                />
              </FieldRow>
            )}

            <FieldRow label={t('tasks.workingDirectory')}>
              <FolderField cwd={cwd} onChange={(value) => { setCwd(value); markFormChanged() }} workspaceId={workspaceId} />
            </FieldRow>

            <FieldRow label={t('tasks.maxRepairs')}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_REPAIR_ATTEMPTS_CAP}
                value={maxRepairs}
                onChange={(e) => { setMaxRepairs(e.target.value); markFormChanged() }}
                placeholder={String(DEFAULT_REPAIR_ATTEMPTS)}
                title={t('tasks.maxRepairsHint')}
                className="h-8 w-[88px] rounded-lg border border-border bg-background px-2.5 text-right text-[12.5px] tabular-nums outline-none focus:border-foreground/25 placeholder:text-foreground/30"
              />
            </FieldRow>
          </div>
        </div>

        {/* Right — editable nodes of the existing task */}
        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card shadow-minimal">
            <>
              <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
                <span className="text-[15px] font-bold">{t('kanban.subtasks')}</span>
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-foreground/[0.06] px-1.5 text-[11px] font-bold text-foreground/55">
                  {subtasks.length}
                </span>
                <Btn variant="secondary" className="ml-auto h-7 px-2.5 text-[12px]" onClick={addSubtask}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('kanban.addSubtask')}
                </Btn>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                {subtasks.map((st, i) => (
                  <SubtaskCard
                    key={st.uid}
                    index={i}
                    subtask={st}
                    allSubtasks={subtasks}
                    groups={groups}
                    fallbackModel={orchModel || fallbackModel}
                    modelToConnection={modelToConnection}
                    onChange={(patch) => updateSubtask(st.uid, patch)}
                    onRemove={() => removeSubtask(st.uid)}
                  />
                ))}
                {subtasks.length === 0 && (
                  <button
                    onClick={addSubtask}
                    className="flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border py-2.5 text-[12.5px] font-semibold text-foreground/40 transition-colors hover:border-foreground/30 hover:text-foreground/60"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('tasks.addFirstSubtask')}
                  </button>
                )}
              </div>

              <div className="shrink-0 border-t border-border/60 px-4 py-2.5 text-[10.5px] text-foreground/40">
                {t('tasks.subtaskFooter')}
              </div>
            </>
        </div>
      </div>
      )}
      <ApplyRunRevisionDialog
        open={revisionDialogOpen}
        preview={revisionPreview}
        loading={revisionPreviewLoading}
        applying={revisionApplying}
        error={revisionError}
        hasUnsavedChanges={dirty}
        onOpenChange={(open) => {
          setRevisionDialogOpen(open)
          if (!open) {
            setRevisionPreview(null)
            setRevisionPreviewRunId(null)
            setRevisionError(null)
          }
        }}
        onConfirm={() => void confirmRunRevision()}
      />
      <Dialog open={v3Confirm !== null} onOpenChange={(open) => { if (!open) setV3Confirm(null) }}>
        <DialogContent className="max-h-[82vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t('tasks.confirmV3Title')}</DialogTitle>
            <DialogDescription>{t('tasks.confirmV3Description')}</DialogDescription>
          </DialogHeader>
          {v3Confirm && (
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-foreground/75">
              {v3MigrationLines(v3Confirm.spec).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setV3Confirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const pending = v3Confirm
                setV3Confirm(null)
                if (pending) void submit(pending.run, true)
              }}
            >
              {t('tasks.confirmV3Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results panel — storage-backed run outcome (verdict + per-node output).
// ---------------------------------------------------------------------------
function ResultsPanel({
  results,
  loading,
  selectedRunId,
  onSelectRun,
  onOpenChildSession,
  onApplyRunRevision,
  canApplyRunRevision,
}: {
  results: TaskResults | null
  loading: boolean
  selectedRunId: string | null
  onSelectRun: (runId: string) => void
  onOpenChildSession?: (sessionId: string) => void
  onApplyRunRevision: () => void
  canApplyRunRevision: boolean
}) {
  const { t } = useTranslation()

  if (loading && !results) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-card text-foreground/50 shadow-minimal">
        <Spinner className="text-lg" />
      </div>
    )
  }

  if (!results || !results.runId || results.nodes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 text-center text-foreground/50 shadow-minimal">
        <CircleSlash className="h-6 w-6 text-foreground/30" strokeWidth={2} />
        <p className="text-[12.5px]">{t('tasks.resultsEmpty')}</p>
      </div>
    )
  }

  const verdict = results.verdict
  const verdicts = results.verdicts ?? (verdict ? [verdict] : [])
  const repair = results.repair
  const runStatusKey = runStatusLabelKey(results.runStatus)
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-minimal">
      {results.runIds.length > 0 && (
        <label className="flex items-center gap-2 text-[12px]">
          <span className="font-semibold text-foreground/55">{t('tasks.runPicker')}</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
            value={selectedRunId ?? results.runId ?? ''}
            onChange={(e) => onSelectRun(e.target.value)}
          >
            {results.runIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          {results.runStatus && (
            <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-bold text-foreground/60">
              {runStatusKey ? t(runStatusKey) : results.runStatus}
            </span>
          )}
          {results.tokensUsed != null && (
            <span className="text-[11px] text-foreground/45">{t('tasks.tokensUsed', { count: results.tokensUsed })}</span>
          )}
        </label>
      )}
      <div className="flex justify-end">
        <Btn variant="secondary" onClick={onApplyRunRevision} disabled={!canApplyRunRevision}>
          {t('tasks.applyRunRevision')}
        </Btn>
      </div>
      {results.acceptanceCriteria && (
        <div className="rounded-[10px] border border-border/70 bg-foreground/[0.015] px-3 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-foreground/45">{t('tasks.acceptanceCriteria')}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground/70">{results.acceptanceCriteria}</p>
        </div>
      )}

      {verdict && (
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5',
            verdict.result === 'pass'
              ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
              : verdict.result === 'fail'
                ? 'border-red-500/30 bg-red-500/[0.06]'
                : 'border-border bg-foreground/[0.03]',
          )}
        >
          {verdict.result === 'pass' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2.5} />
          ) : verdict.result === 'fail' ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={2.5} />
          ) : (
            <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2.5} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold">
                {verdict.result === 'pass' ? t('tasks.verdictPass') : verdict.result === 'fail' ? t('tasks.verdictFail') : t('tasks.verdictUnparsed')}
              </span>
              {repair && (
                <span className="ml-auto shrink-0 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-bold text-foreground/55">
                  {t('tasks.repairAttempt', { used: repair.used, max: repair.max })}
                </span>
              )}
            </div>
            {verdict.reason && <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/65">{verdict.reason}</p>}
            {verdict.nodes && verdict.nodes.length > 0 && (
              <p className="mt-1 text-[11px] text-foreground/45">{t('tasks.repairNodes', { nodes: verdict.nodes.join(', ') })}</p>
            )}
          </div>
        </div>
      )}

      {verdicts.length > 1 && (
        <div className="rounded-[10px] border border-border/70 bg-foreground/[0.015] px-3 py-2.5">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground/45">{t('tasks.verdictHistory')}</div>
          <div className="flex flex-col gap-1">
            {verdicts.map((v, i) => (
              <div key={i} className="flex items-start gap-2 text-[11.5px]">
                {v.result === 'pass' ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={2.5} />
                ) : v.result === 'fail' ? (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" strokeWidth={2.5} />
                ) : (
                  <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40" strokeWidth={2.5} />
                )}
                <span className="min-w-0 flex-1 text-foreground/60">
                  {v.reason || (v.result === 'pass' ? t('tasks.verdictPass') : v.result === 'fail' ? t('tasks.verdictFail') : t('tasks.verdictUnparsed'))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.nodes.map((node) => {
        const pill = resolveNodeStatePill(node.state)
        return (
        <div key={node.id} className="rounded-[10px] border border-border/70 bg-foreground/[0.015] p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{node.title}</span>
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-bold', pill.className)}>
              {pill.labelKey ? t(pill.labelKey) : node.state}
            </span>
            {node.attempt != null && node.attempt > 0 && (
              <span className="text-[10.5px] text-foreground/45">{t('tasks.attemptCount', { count: node.attempt })}</span>
            )}
            {node.sessionId && onOpenChildSession && (
              <button
                type="button"
                onClick={() => onOpenChildSession(node.sessionId!)}
                className="inline-flex shrink-0 items-center gap-1 rounded text-[11.5px] font-semibold text-indigo-500 hover:underline dark:text-indigo-300"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={2.5} /> {t('tasks.openSession')}
              </button>
            )}
          </div>
          {node.failureReason && (
            <p className="mt-1.5 text-[11.5px] text-red-500/80">{t('tasks.failureReason')}: {node.failureReason}</p>
          )}
          {node.output ? (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border/50 bg-background px-3 py-2 text-[12px] leading-relaxed">
              <Markdown>{node.output}</Markdown>
            </div>
          ) : (
            <p className="mt-1.5 text-[11.5px] text-foreground/40">{t('tasks.noOutput')}</p>
          )}
        </div>
        )
      })}
    </div>
  )
}
