import { lstatSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { extractSimpleCommandsStrict, type AgentEvent } from '@craft-agent/shared/agent'
import { isOfficecliShellCommand } from '@craft-agent/shared/utils/officecli'

type Phase = 'model_wait' | 'tool' | 'validation' | 'readback_render' | 'recompute' | 'delivery_gate'
type FileChanged = boolean | null

interface OfficeStage {
  phase: Phase
  type: string
  durationMs: number
  fileChanged: FileChanged
  commandTypes?: string[]
}

type ClassifiedTool = Pick<OfficeStage, 'phase' | 'type' | 'commandTypes'> & { file?: unknown }

const cliPhases = new Map<string, Phase>([
  ...['create', 'add', 'set', 'remove', 'move', 'swap', 'copy', 'batch', 'raw-set', 'add-part',
    'open', 'save', 'close', 'load_skill', 'help', 'watch'].map(verb => [verb, 'tool'] as const),
  ...['get', 'query', 'view', 'outline', 'raw', 'screenshot'].map(verb => [verb, 'readback_render'] as const),
  ['validate', 'validation'], ['recalc', 'recompute'],
])

const tools = new Map<string, Phase>([
  ['office_template', 'tool'], ['office_template_write', 'tool'], ['xlsx_recalculate', 'recompute'],
  ['office_render', 'readback_render'], ['office_business', 'tool'], ['ppt_template_create_project', 'tool'],
])

const officeCliExecutable = /(?:^|[/\\])officecli(?:\.exe|\.cmd)?$/i
const shellReadbackHelpers = new Set(['cat', 'cd', 'echo', 'export', 'grep', 'head', 'ls', 'printf', 'pwd', 'sed', 'sleep', 'tail'])

function isDeckScreenshot([runner, script, command]: string[]): boolean {
  return /(?:^|[/\\])(?:bun|node)(?:\.exe)?$/i.test(runner ?? '')
    && /(?:^|[/\\])deck-cli\.mjs$/.test(script ?? '') && command === 'screenshot'
}

function classifyDeckScreenshot(shell: string, simple: string[][] | null): ClassifiedTool | undefined {
  if (!shell.includes('deck-cli.mjs')) return
  const commands = simple ?? extractSimpleCommandsStrict(shell
    .replace(/\$(?:\{CRAFT_BUN\}|CRAFT_BUN\b)/g, 'bun')
    .replace(/\$(?:\{[A-Za-z_]\w*\}|[A-Za-z_]\w*|\?)/g, 'shell-variable'))
  if (!commands?.some(isDeckScreenshot)) return
  if (simple?.length === 1) return { phase: 'readback_render', type: 'deck-cli:screenshot', file: simple[0]?.[3] }
  const readback = commands.every(command => isDeckScreenshot(command)
    || shellReadbackHelpers.has(command[0] ?? '')
    || (officeCliExecutable.test(command[0] ?? '') && cliPhases.get(command[1]?.toLowerCase()) === 'readback_render'))
  return { phase: readback ? 'readback_render' : 'tool', type: 'deck-cli:shell', commandTypes: ['screenshot'] }
}

export function isTimedOfficeFile(path: string): boolean {
  return /\.(?:docx|docm|xlsx|xlsm|pptx|pptm)$/i.test(path)
}

function fingerprint(path: string): string | null | undefined {
  try {
    const file = lstatSync(path, { bigint: true })
    return file.isFile() ? `${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}` : undefined
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined
  }
}

function fileObserver(root: string, raw: unknown): () => FileChanged {
  if (typeof raw !== 'string' || !isTimedOfficeFile(raw) || raw.length > 4096) return () => null
  const path = resolve(root, raw)
  const rel = relative(root, path)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return () => null
  const before = fingerprint(path)
  return () => {
    const after = fingerprint(path)
    return before === undefined || after === undefined ? null : before !== after
  }
}

function classify(event: Extract<AgentEvent, { type: 'tool_start' }>): ClassifiedTool | undefined {
  const tool = event.toolName.replace(/^(?:mcp__session__|session__)/, '')
  const phase = tools.get(tool)
  if (phase) return {
    phase: tool === 'office_business' && event.input.command === 'validate-minutes' ? 'validation' : phase,
    type: tool,
    file: tool === 'office_template_write' ? event.input.output_path : event.input.path,
  }
  if (tool !== 'Bash' || typeof event.input.command !== 'string') return
  const shell = event.input.command
  const directCli = isOfficecliShellCommand(shell)
  if (!directCli && !/\bofficecli(?:\.exe|\.cmd)?\b/i.test(shell) && !shell.includes('deck-cli.mjs')) return
  const simple = extractSimpleCommandsStrict(shell)
  const screenshot = classifyDeckScreenshot(shell, simple)
  if (screenshot) return screenshot
  const cli = simple?.filter(([exe]) => officeCliExecutable.test(exe ?? '')) ?? []
  if (!cli.length && (simple || !directCli)) return
  const knownVerb = (raw?: string) => {
    const verb = raw?.toLowerCase() ?? ''
    return cliPhases.has(verb) ? verb : 'other'
  }
  const commandTypes = cli.map(([, verb]) => knownVerb(verb))
  if (!simple) {
    // The guides use variable-expanded arguments. Keep the leading verb as a
    // hint, without attributing the entire shell duration to that invocation.
    const leading = /^\s*(?:officecli(?:\.exe|\.cmd)?|["']?\$\{?CRAFT_OFFICECLI\}?["']?|%CRAFT_OFFICECLI%)\s+([\w-]+)/i.exec(shell)
    if (leading) commandTypes.push(knownVerb(leading[1]))
  }
  if (simple?.length === 1 && commandTypes.length === 1) {
    const verb = commandTypes[0]!
    return { phase: cliPhases.get(verb) ?? 'tool', type: `officecli:${verb}`, file: cli[0]?.[2] }
  }
  // One shell tool can contain multiple commands; its elapsed time cannot be split across them.
  const firstFile = cli[0]?.[2]
  const file = simple?.length === cli.length && cli.every(args => args[2] === firstFile) ? firstFile : undefined
  return { phase: 'tool', type: 'officecli:shell', commandTypes: [...new Set(commandTypes)], file }
}

export class OfficeTurnTiming {
  private modelStart: number | undefined
  private stages: OfficeStage[] = []
  private tools = new Map<string, () => void>()
  private readonly startedAt: number

  constructor(
    private office: boolean,
    private readonly shellRoot: string,
    private readonly toolRoot: string,
    private readonly now = () => performance.now(),
  ) {
    this.startedAt = now()
  }

  start(phase: Phase, type: string, fileChanged: () => FileChanged, commandTypes?: string[]): () => void {
    this.office = true
    const start = this.now()
    return () => this.record(phase, type, start, fileChanged(), commandTypes)
  }

  private record(phase: Phase, type: string, start: number, fileChanged: FileChanged, commandTypes?: string[]): void {
    this.stages.push({ phase, type, durationMs: Math.round(this.now() - start), fileChanged,
      ...(commandTypes?.length ? { commandTypes } : {}) })
  }

  private closeModel(): void {
    if (this.modelStart === undefined) return
    this.record('model_wait', 'model', this.modelStart, false)
    this.modelStart = undefined
  }

  async excludeFromModelWait<T>(run: () => Promise<T>): Promise<T> {
    if (this.modelStart === undefined) return run()
    const start = this.now()
    try {
      return await run()
    } finally {
      if (this.modelStart !== undefined) this.modelStart += this.now() - start
    }
  }

  deliveryGate(start: number, fileChanged: FileChanged): void {
    if (fileChanged) this.office = true
    if (this.office) this.record('delivery_gate', 'office_delivery_guard', start, fileChanged)
  }

  observe(event: AgentEvent): void {
    switch (event.type) {
      case 'model_call_start':
        this.closeModel()
        this.modelStart = this.now()
        break
      case 'usage_update':
      case 'complete':
        this.closeModel()
        break
      case 'tool_start': {
        this.closeModel()
        const tool = classify(event)
        if (tool && !this.tools.has(event.toolUseId)) {
          const root = event.toolName === 'Bash' || tool.type === 'office_render' || tool.type === 'office_business'
            ? this.shellRoot : this.toolRoot
          this.tools.set(event.toolUseId, this.start(tool.phase, tool.type, fileObserver(root, tool.file), tool.commandTypes))
        }
        break
      }
      case 'tool_result': {
        const finish = this.tools.get(event.toolUseId)
        this.tools.delete(event.toolUseId)
        finish?.()
        break
      }
    }
  }

  finish() {
    this.closeModel()
    if (!this.office) return undefined
    return {
      durationMs: Math.round(this.now() - this.startedAt),
      incompleteToolCount: this.tools.size,
      stages: this.stages,
    }
  }
}
