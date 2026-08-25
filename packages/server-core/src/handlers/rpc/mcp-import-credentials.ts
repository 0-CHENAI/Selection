import type { McpImportCandidate, McpImportDecision } from '@craft-agent/shared/resources'
import {
  validateMcpConnection,
  validateStdioMcpConnection,
  type McpValidationResult,
} from '@craft-agent/shared/mcp'
import {
  getSourceCredentialManager,
  getSourceServerBuilder,
  loadSource,
  saveSourceConfig,
  type FolderSourceConfig,
  type LoadedSource,
} from '@craft-agent/shared/sources'
import type { HandlerDeps } from '../handler-deps'

interface RawMcpServer {
  name: string
  config: Record<string, unknown>
}

export interface McpImportCredentialDependencies {
  loadSource: (workspaceRootPath: string, sourceSlug: string) => LoadedSource | null
  saveCredential: (source: LoadedSource, value: string) => Promise<void>
  saveSourceConfig: (workspaceRootPath: string, config: FolderSourceConfig) => void
  validateConnection: (source: LoadedSource) => Promise<McpValidationResult>
  notifySourceChanged: (workspaceRootPath: string, sourceSlug: string) => void
  now?: () => number
}

const activeValidationAttempts = new Map<string, symbol>()
const MCP_CONNECTION_TIMEOUT_MS = 30_000

function validationKey(workspaceRootPath: string, sourceSlug: string): string {
  return `${workspaceRootPath}\0${sourceSlug}`
}

function validateWithTimeout(validation: Promise<McpValidationResult>): Promise<McpValidationResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve({
        success: false,
        error: 'MCP connection timed out after 30 seconds. Check the server URL and try again.',
        errorType: 'failed',
      })
    }, MCP_CONNECTION_TIMEOUT_MS)

    validation.then(
      result => {
        clearTimeout(timeout)
        resolve(result)
      },
      error => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

export function createMcpValidationDependencies(deps: HandlerDeps): McpImportCredentialDependencies {
  return {
    loadSource,
    saveCredential: async (source, value) => {
      await getSourceCredentialManager().save(source, { value })
    },
    saveSourceConfig,
    validateConnection: async source => {
      const mcp = source.config.mcp
      if (!mcp) return { success: false, error: 'MCP configuration is missing', errorType: 'failed' }

      if (mcp.transport === 'stdio') {
        if (!mcp.command) return { success: false, error: 'MCP command is missing', errorType: 'failed' }
        return validateStdioMcpConnection({
          command: mcp.command,
          args: mcp.args,
          env: mcp.env,
          timeout: MCP_CONNECTION_TIMEOUT_MS,
        })
      }

      const credentialManager = getSourceCredentialManager()
      const hasStructuredHeaders = Boolean(mcp.headerNames?.length)
      const credential = hasStructuredHeaders ? await credentialManager.getApiCredential(source) : null
      const token = mcp.authType === 'none' || hasStructuredHeaders
        ? null
        : await credentialManager.getToken(source)

      if (mcp.authType !== 'none' && !(hasStructuredHeaders ? credential : token)) {
        return {
          success: false,
          error: 'Authentication credentials are missing. Re-authorize this MCP source.',
          errorType: 'needs-auth',
        }
      }

      const server = getSourceServerBuilder().buildMcpServer(source, token, credential)
      if (!server || server.type === 'stdio') {
        return { success: false, error: 'MCP connection configuration is invalid', errorType: 'failed' }
      }

      return validateWithTimeout(validateMcpConnection({
        mcpUrl: server.url,
        mcpTransport: mcp.transport,
        mcpHeaders: server.headers,
      }))
    },
    notifySourceChanged: (workspaceRootPath, sourceSlug) => {
      deps.sessionManager.notifyConfigFileChange(workspaceRootPath, `sources/${sourceSlug}/config.json`)
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isMcpServer(value: unknown): value is Record<string, unknown> {
  const record = asRecord(value)
  if (!record) return false
  return (typeof record.command === 'string' && record.command.trim().length > 0)
    || (typeof record.url === 'string' && record.url.trim().length > 0)
    || (typeof record.serverUrl === 'string' && record.serverUrl.trim().length > 0)
}

function collectRawMcpServers(jsonText: string): RawMcpServer[] {
  const parsed: unknown = JSON.parse(jsonText)
  const record = asRecord(parsed)
  const serverMap = record?.mcpServers ?? record?.servers ?? record?.mcp

  if (asRecord(serverMap)) {
    return Object.entries(serverMap as Record<string, unknown>)
      .filter((entry): entry is [string, Record<string, unknown>] => isMcpServer(entry[1]))
      .map(([name, config]) => ({ name, config }))
  }

  if (Array.isArray(parsed)) {
    return parsed.filter(isMcpServer).map((config, index) => ({
      name: typeof config.name === 'string' && config.name.trim()
        ? config.name.trim()
        : `mcp-${index + 1}`,
      config,
    }))
  }

  if (!isMcpServer(parsed)) return []
  return [{
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'mcp',
    config: parsed,
  }]
}

function isCredentialTemplate(value: string): boolean {
  return /^\$(?:\{[^}]+\}|[A-Za-z_][A-Za-z0-9_]*)$/.test(value.trim())
}

export function extractMcpImportCredentials(
  jsonText: string,
  candidates: McpImportCandidate[],
): Map<string, string> {
  const servers = collectRawMcpServers(jsonText)
  const credentials = new Map<string, string>()

  for (const [index, candidate] of candidates.entries()) {
    if (candidate.mcp.authType === 'none' || candidate.mcp.transport === 'stdio') continue

    const server = servers[index]?.name === candidate.name
      ? servers[index]
      : servers.find(item => item.name === candidate.name)
    const headers = asRecord(server?.config.headers)
    if (!headers) continue

    const headerEntries = Object.entries(headers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    const authorization = headerEntries.find(([name]) => /^authorization$/i.test(name))

    if (candidate.mcp.headerNames?.length) {
      const credentialHeaders: Record<string, string> = {}
      let missingCredential = false

      for (const requiredName of candidate.mcp.headerNames) {
        const header = headerEntries.find(([name]) => name.toLowerCase() === requiredName.toLowerCase())
        if (!header || !header[1].trim() || isCredentialTemplate(header[1])) {
          missingCredential = true
          break
        }
        credentialHeaders[requiredName] = header[1]
      }

      if (missingCredential) continue
      if (authorization) {
        const bearerToken = authorization[1].trim().match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
        if (bearerToken && !isCredentialTemplate(bearerToken)) {
          credentialHeaders[authorization[0]] = authorization[1]
        }
      }
      credentials.set(candidate.key, JSON.stringify(credentialHeaders))
      continue
    }

    const token = authorization?.[1].trim().match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    if (token && !isCredentialTemplate(token)) credentials.set(candidate.key, token)
  }

  return credentials
}

function authFailure(error: string): boolean {
  return /\b401\b|\b403\b|unauthorized|forbidden|authentication/i.test(error)
}

export function startMcpSourceValidation(
  workspaceRootPath: string,
  sourceSlug: string,
  deps: McpImportCredentialDependencies,
  credential?: string,
): Promise<void> {
  const source = deps.loadSource(workspaceRootPath, sourceSlug)
  if (!source) throw new Error(`MCP source '${sourceSlug}' could not be loaded`)
  if (source.config.type !== 'mcp' || !source.config.mcp) {
    throw new Error(`Source '${sourceSlug}' is not an MCP server`)
  }

  const key = validationKey(workspaceRootPath, sourceSlug)
  const attempt = Symbol(sourceSlug)
  activeValidationAttempts.set(key, attempt)

  deps.saveSourceConfig(workspaceRootPath, {
    ...source.config,
    enabled: false,
    isAuthenticated: false,
    connectionStatus: 'connecting',
    connectionError: undefined,
  })
  deps.notifySourceChanged(workspaceRootPath, sourceSlug)

  const finish = (result: McpValidationResult): void => {
    if (activeValidationAttempts.get(key) !== attempt) return

    const latest = deps.loadSource(workspaceRootPath, sourceSlug)
    if (!latest || latest.config.id !== source.config.id) return

    const requiresAuthentication = !result.success && result.errorType === 'needs-auth'
    deps.saveSourceConfig(workspaceRootPath, {
      ...latest.config,
      enabled: result.success,
      isAuthenticated: result.success,
      connectionStatus: result.success ? 'connected' : requiresAuthentication ? 'needs_auth' : 'failed',
      connectionError: result.success ? undefined : result.error || 'MCP connection validation failed',
      lastTestedAt: (deps.now ?? Date.now)(),
    })
    deps.notifySourceChanged(workspaceRootPath, sourceSlug)
  }

  return (async () => {
    try {
      if (credential) await deps.saveCredential(source, credential)

      const current = deps.loadSource(workspaceRootPath, sourceSlug)
      if (!current || current.config.id !== source.config.id) return
      if (activeValidationAttempts.get(key) !== attempt) return

      finish(await deps.validateConnection(current))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      finish({
        success: false,
        error: message,
        errorType: authFailure(message) ? 'needs-auth' : 'failed',
      })
    } finally {
      if (activeValidationAttempts.get(key) === attempt) {
        activeValidationAttempts.delete(key)
      }
    }
  })()
}

export function resumeInterruptedMcpValidations(
  workspaceRootPath: string,
  sources: LoadedSource[],
  deps: McpImportCredentialDependencies,
): Promise<void>[] {
  return sources
    .filter(source => source.config.type === 'mcp'
      && source.config.connectionStatus === 'connecting'
      && !activeValidationAttempts.has(validationKey(workspaceRootPath, source.config.slug)))
    .map(source => startMcpSourceValidation(workspaceRootPath, source.config.slug, deps))
}

export function activateImportedMcpSources(
  workspaceRootPath: string,
  candidates: McpImportCandidate[],
  decisions: McpImportDecision[],
  importedSlugs: string[],
  credentials: Map<string, string>,
  deps: McpImportCredentialDependencies,
): Promise<void>[] {
  const decisionByKey = new Map(decisions.map(decision => [decision.key, decision]))
  const pendingValidations: Promise<void>[] = []
  let importedIndex = 0

  for (const candidate of candidates) {
    const action = decisionByKey.get(candidate.key)?.action ?? (candidate.conflict ? 'skip' : 'overwrite')
    if (action === 'skip') continue

    const slug = importedSlugs[importedIndex++]
    const credential = credentials.get(candidate.key)
    if (!slug || (candidate.needsAuth && !credential)) continue

    pendingValidations.push(startMcpSourceValidation(workspaceRootPath, slug, deps, credential))
  }

  return pendingValidations
}
