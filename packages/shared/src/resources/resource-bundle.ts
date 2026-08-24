/**
 * Resource Bundle — Export/Import Logic
 *
 * Exports workspace resources (sources, skills, automations) to a portable
 * ResourceBundle, and imports bundles into a target workspace.
 *
 * Key behaviors:
 * - Source configs are sanitized (secrets stripped, auth state reset)
 * - All non-hidden files are included per resource (not just known file types)
 * - Import uses staging + atomic rename per resource (single watcher event)
 * - Source overwrite clears stored credentials
 * - Automations overwrite clears history + retry queue
 * - Relies on existing ConfigWatcher for change notifications (no manual events)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { createHash, randomUUID } from 'crypto'
import matter from 'gray-matter'
import { finalizeStagedDirectory, safeTempNameSegment } from '../utils/fs-stage.ts'
import { resolveFsPath } from '../utils/paths.ts'
import {
  type BundleFile,
  MAX_BUNDLE_SIZE_BYTES,
  collectDirectoryFiles,
  restoreFiles,
  validateBundleFile,
} from '../utils/bundle-files.ts'
import { getWorkspaceSourcesPath, getWorkspaceSkillsPath } from '../workspaces/storage.ts'
import { loadSourceConfig, getSourcePath } from '../sources/storage.ts'
import { isBuiltinSource } from '../sources/builtin-sources.ts'
import { loadSkillBySlug } from '../skills/storage.ts'
import { validateSourceConfig } from '../config/validators.ts'
import { AUTOMATIONS_CONFIG_FILE, AUTOMATIONS_HISTORY_FILE, AUTOMATIONS_RETRY_QUEUE_FILE } from '../automations/constants.ts'
import { validateAutomationsConfig } from '../automations/validation.ts'
import { generateShortId } from '../automations/resolve-config-path.ts'
import { VALID_EVENTS } from '../automations/schemas.ts'
import { parsePromptReferences } from '../automations/utils.ts'
import { debug } from '../utils/debug.ts'

import type { FolderSourceConfig } from '../sources/types.ts'
import type { AutomationMatcher } from '../automations/types.ts'
import type {
  ResourceBundle,
  SourceBundleEntry,
  SkillBundleEntry,
  AutomationBundleEntry,
  ExportResourcesOptions,
  ExportResult,
  ResourceImportMode,
  ResourceImportResult,
  ImportBucketResult,
  ResourceImportDeps,
  ResourceBundleManifest,
  ResourceDependency,
  ResourceImportDecision,
  ResourceImportPlan,
  ResourceImportPreview,
  ResourceImportPreviewItem,
  ResourceRedaction,
  ResourceRef,
  ResourceType,
} from './types.ts'

const RESOURCE_BUNDLE_KIND = 'selection-resource-bundle' as const
const RESOURCE_BUNDLE_VERSION = 2 as const

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`
}

function computeBundleDigest(bundle: ResourceBundle): string {
  const copy = { ...bundle, integrity: undefined }
  delete copy.integrity
  return createHash('sha256').update(canonicalize(copy)).digest('hex')
}

function resourceKey(ref: ResourceRef): string {
  return `${ref.type}:${ref.id}`
}

function validateResourceReference(
  value: unknown,
  allowedTypes: readonly string[],
  path: string,
  errors: string[],
): value is { type: string; id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path}: invalid resource reference`)
    return false
  }
  const ref = value as Record<string, unknown>
  rejectUnknownKeys(ref, ['type', 'id'], path, errors)
  if (!allowedTypes.includes(String(ref.type)) || typeof ref.id !== 'string' || ref.id.length === 0) {
    errors.push(`${path}: invalid resource reference`)
    return false
  }
  return true
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}: unknown field '${key}'`)
  }
}

function isSafeTemplate(value: string): boolean {
  return /^(?:\$[A-Z_][A-Z0-9_]*|\$\{[A-Z_][A-Z0-9_]*\})$/.test(value.trim())
}

const SECRET_KEY_PATTERN = /(?:^|[_-])(api[-_]?key|access[-_]?token|refresh[-_]?token|token|auth(?:orization)?|cookie|password|passwd|secret|private[-_]?key)(?:$|[_-])/i
const SECRET_QUERY_PATTERN = /^(?:key|signature|sig|credential|code)$/i
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:sk|rk|pk)-(?:live|proj)-[A-Za-z0-9_-]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
]

function looksLikeSecretValue(value: string): boolean {
  if (isSafeTemplate(value)) return false
  return SECRET_VALUE_PATTERNS.some(pattern => pattern.test(value))
}

function looksLikeInlineCredential(value: string): boolean {
  return /(?:api[-_]?key|password|passwd|secret|token|cookie)\s*[:=]\s*["']?[A-Za-z0-9_\-/.+=]{8,}/i.test(value)
}

function auditFreeformFiles(files: BundleFile[], label: string): void {
  for (const file of files) {
    if (!file || typeof file !== 'object' || typeof file.contentBase64 !== 'string' || typeof file.relativePath !== 'string') continue
    const buffer = Buffer.from(file.contentBase64, 'base64')
    if (buffer.includes(0)) continue
    const text = buffer.toString('utf-8')
    if (looksLikeSecretValue(text) || /(?:api[-_]?key|password|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_\-/.+=]{12,}/i.test(text)) {
      throw new Error(`${label}/${file.relativePath}: possible credential found; remove it before export`)
    }
  }
}

// ============================================================
// Source Config Sanitization
// ============================================================

/**
 * Fields to strip from source configs on export.
 *
 * Runtime state fields are always removed.
 * Known secret-bearing fields are removed with warnings.
 */

/** Strip runtime auth/status state from a source config */
function sanitizeUrl(raw: string, onRedact: (path: string, requiredName?: string) => void, path: string): string {
  const templates: string[] = []
  const masked = raw.replace(/\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*/g, value => {
    const marker = `CRAFTTEMPLATE${templates.length}VALUE`
    templates.push(value)
    return marker
  })
  try {
    const url = new URL(masked)
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
      onRedact(path)
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY_PATTERN.test(key) || SECRET_QUERY_PATTERN.test(key)) {
        url.searchParams.delete(key)
        onRedact(`${path}.query.${key}`, key)
      }
    }
    let sanitized = url.toString()
    templates.forEach((value, index) => { sanitized = sanitized.replace(`CRAFTTEMPLATE${index}VALUE`, value) })
    return sanitized
  } catch {
    return raw
  }
}

function sanitizeUnknown(
  value: unknown,
  path: string,
  onRedact: (path: string, requiredName?: string) => void,
  allowTemplate: (value: string) => boolean = isSafeTemplate,
): unknown {
  if (Array.isArray(value)) return value.map((entry, index) => sanitizeUnknown(entry, `${path}[${index}]`, onRedact, allowTemplate))
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && (looksLikeSecretValue(value) || looksLikeInlineCredential(value))) {
      onRedact(path)
      return undefined
    }
    return value
  }
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key
    if (SECRET_KEY_PATTERN.test(key)) {
      if (typeof child === 'string' && allowTemplate(child)) output[key] = child
      else onRedact(childPath, key)
      continue
    }
    const sanitized = sanitizeUnknown(child, childPath, onRedact, allowTemplate)
    if (sanitized !== undefined) output[key] = sanitized
  }
  return output
}

export function sanitizeSourceConfig(
  config: FolderSourceConfig,
  redactions: ResourceRedaction[],
): { config: FolderSourceConfig; warnings: string[] } {
  const warnings: string[] = []
  const ref: ResourceRef = { type: 'source', id: config.slug }
  const redact = (path: string, reason: ResourceRedaction['reason'], requiredName?: string) => {
    redactions.push({ resource: ref, path, reason, ...(requiredName ? { requiredName } : {}) })
  }

  // Explicit schema whitelist. Unknown config fields never enter the bundle.
  const sanitized = JSON.parse(JSON.stringify({
    id: config.id,
    name: config.name,
    slug: config.slug,
    enabled: config.enabled,
    provider: config.provider,
    type: config.type,
    ...(config.icon !== undefined ? { icon: config.icon } : {}),
    ...(config.tagline !== undefined ? { tagline: config.tagline } : {}),
    ...(config.brand !== undefined ? { brand: config.brand } : {}),
    ...(config.createdAt !== undefined ? { createdAt: config.createdAt } : {}),
    ...(config.updatedAt !== undefined ? { updatedAt: config.updatedAt } : {}),
    ...(config.isAuthenticated !== undefined ? { isAuthenticated: config.isAuthenticated } : {}),
    ...(config.connectionStatus !== undefined ? { connectionStatus: config.connectionStatus } : {}),
    ...(config.connectionError !== undefined ? { connectionError: config.connectionError } : {}),
    ...(config.lastTestedAt !== undefined ? { lastTestedAt: config.lastTestedAt } : {}),
    ...(config.mcp ? { mcp: {
      transport: config.mcp.transport,
      url: config.mcp.url,
      authType: config.mcp.authType,
      clientId: config.mcp.clientId,
      command: config.mcp.command,
      args: config.mcp.args,
      env: config.mcp.env,
      headers: config.mcp.headers,
      headerNames: config.mcp.headerNames,
    } } : {}),
    ...(config.api ? { api: {
      baseUrl: config.api.baseUrl,
      authType: config.api.authType,
      headerName: config.api.headerName,
      headerNames: config.api.headerNames,
      queryParam: config.api.queryParam,
      authScheme: config.api.authScheme,
      defaultHeaders: config.api.defaultHeaders,
      testEndpoint: config.api.testEndpoint ? {
        method: config.api.testEndpoint.method,
        path: config.api.testEndpoint.path,
        body: config.api.testEndpoint.body,
        headers: config.api.testEndpoint.headers,
      } : undefined,
      renewEndpoint: config.api.renewEndpoint ? {
        path: config.api.renewEndpoint.path,
        method: config.api.renewEndpoint.method,
        body: config.api.renewEndpoint.body,
        headers: config.api.renewEndpoint.headers,
        tokenField: config.api.renewEndpoint.tokenField,
        expiresInField: config.api.renewEndpoint.expiresInField,
        fallbackTtlSecs: config.api.renewEndpoint.fallbackTtlSecs,
      } : undefined,
      googleService: config.api.googleService,
      googleScopes: config.api.googleScopes,
      googleOAuthClientId: config.api.googleOAuthClientId,
      googleOAuthClientSecret: config.api.googleOAuthClientSecret,
      slackService: config.api.slackService,
      slackUserScopes: config.api.slackUserScopes,
      microsoftService: config.api.microsoftService,
      microsoftScopes: config.api.microsoftScopes,
      oauth: config.api.oauth ? {
        authorizationUrl: config.api.oauth.authorizationUrl,
        tokenUrl: config.api.oauth.tokenUrl,
        clientId: config.api.oauth.clientId,
        clientSecret: config.api.oauth.clientSecret,
        scopes: config.api.oauth.scopes,
        audience: config.api.oauth.audience,
        extraParams: config.api.oauth.extraParams,
      } : undefined,
    } } : {}),
    ...(config.local ? { local: { path: config.local.path, format: config.local.format } } : {}),
  })) as FolderSourceConfig

  // --- Runtime state: always remove ---
  sanitized.isAuthenticated = false
  delete sanitized.connectionError
  delete sanitized.lastTestedAt
  sanitized.enabled = sanitized.type === 'mcp' ? false : sanitized.enabled

  // Determine if source requires auth
  const authType = sanitized.mcp?.authType || sanitized.api?.authType
  if (authType && authType !== 'none') {
    sanitized.connectionStatus = 'needs_auth'
  } else {
    sanitized.connectionStatus = undefined
  }

  // --- Known secret fields: always remove ---
  if (sanitized.api?.googleOAuthClientSecret) {
    delete sanitized.api.googleOAuthClientSecret
    redact('config.api.googleOAuthClientSecret', 'credential', 'googleOAuthClientSecret')
    warnings.push(`Source '${config.slug}': stripped googleOAuthClientSecret`)
  }

  if (sanitized.api?.oauth?.clientSecret) {
    delete sanitized.api.oauth.clientSecret
    redact('config.api.oauth.clientSecret', 'credential', 'clientSecret')
    warnings.push(`Source '${config.slug}': stripped OAuth clientSecret`)
  }

  // --- MCP env vars: may contain tokens ---
  if (sanitized.mcp?.env && Object.keys(sanitized.mcp.env).length > 0) {
    for (const key of Object.keys(sanitized.mcp.env)) redact(`config.mcp.env.${key}`, 'secret-env', key)
    delete sanitized.mcp.env
    warnings.push(`Source '${config.slug}': stripped mcp.env (may contain secrets)`)
  }

  // --- Headers: potentially secret, remove with warning ---
  if (sanitized.mcp?.headers) {
    for (const [key, value] of Object.entries({ ...sanitized.mcp.headers })) {
      if ((isSecretHeader(key) && !isSafeTemplate(value)) || looksLikeSecretValue(value)) {
        delete sanitized.mcp.headers[key]
        redact(`config.mcp.headers.${key}`, 'secret-header', key)
        warnings.push(`Source '${config.slug}': stripped MCP header '${key}'`)
      }
    }
    if (Object.keys(sanitized.mcp.headers).length === 0) delete sanitized.mcp.headers
  }

  if (sanitized.mcp?.args) {
    const args: string[] = []
    for (let index = 0; index < sanitized.mcp.args.length; index++) {
      const value = sanitized.mcp.args[index]!
      if (/^--?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret)(?:=|$)/i.test(value)) {
        redact(`config.mcp.args[${index}]`, 'credential', value.split('=')[0])
        if (!value.includes('=') && index + 1 < sanitized.mcp.args.length) index++
        continue
      }
      if (looksLikeSecretValue(value) || looksLikeInlineCredential(value)) {
        redact(`config.mcp.args[${index}]`, 'credential')
        continue
      }
      args.push(value)
    }
    sanitized.mcp.args = args
  }

  if (sanitized.api?.defaultHeaders) {
    for (const [key, value] of Object.entries({ ...sanitized.api.defaultHeaders })) {
      if ((isSecretHeader(key) && !isSafeTemplate(value)) || looksLikeSecretValue(value)) {
        delete sanitized.api.defaultHeaders[key]
        redact(`config.api.defaultHeaders.${key}`, 'secret-header', key)
        warnings.push(`Source '${config.slug}': stripped API header '${key}'`)
      }
    }
    if (Object.keys(sanitized.api.defaultHeaders).length === 0) delete sanitized.api.defaultHeaders
  }

  if (sanitized.mcp?.url) sanitized.mcp.url = sanitizeUrl(sanitized.mcp.url, (path, name) => redact(path, 'secret-url', name), 'config.mcp.url')
  if (sanitized.api?.baseUrl) sanitized.api.baseUrl = sanitizeUrl(sanitized.api.baseUrl, (path, name) => redact(path, 'secret-url', name), 'config.api.baseUrl')
  if (sanitized.api?.testEndpoint?.body) {
    sanitized.api.testEndpoint.body = sanitizeUnknown(sanitized.api.testEndpoint.body, 'config.api.testEndpoint.body', (path, name) => redact(path, 'credential', name)) as Record<string, unknown>
  }
  if (sanitized.api?.testEndpoint?.headers) {
    sanitized.api.testEndpoint.headers = sanitizeUnknown(sanitized.api.testEndpoint.headers, 'config.api.testEndpoint.headers', (path, name) => redact(path, 'secret-header', name)) as Record<string, string>
  }
  if (sanitized.api?.renewEndpoint?.body) {
    sanitized.api.renewEndpoint.body = sanitizeUnknown(sanitized.api.renewEndpoint.body, 'config.api.renewEndpoint.body', (path, name) => redact(path, 'credential', name)) as Record<string, unknown>
  }
  if (sanitized.api?.renewEndpoint?.headers) {
    sanitized.api.renewEndpoint.headers = sanitizeUnknown(sanitized.api.renewEndpoint.headers, 'config.api.renewEndpoint.headers', (path, name) => redact(path, 'secret-header', name)) as Record<string, string>
  }
  if (sanitized.api?.oauth) {
    sanitized.api.oauth.authorizationUrl = sanitizeUrl(sanitized.api.oauth.authorizationUrl, (path, name) => redact(path, 'secret-url', name), 'config.api.oauth.authorizationUrl')
    sanitized.api.oauth.tokenUrl = sanitizeUrl(sanitized.api.oauth.tokenUrl, (path, name) => redact(path, 'secret-url', name), 'config.api.oauth.tokenUrl')
    if (sanitized.api.oauth.extraParams) {
      sanitized.api.oauth.extraParams = sanitizeUnknown(sanitized.api.oauth.extraParams, 'config.api.oauth.extraParams', (path, name) => redact(path, 'credential', name)) as Record<string, string>
    }
  }

  return { config: sanitized, warnings }
}

// ============================================================
// Export
// ============================================================

/**
 * Export workspace resources to a portable ResourceBundle.
 *
 * @param workspaceRootPath - Absolute path to workspace root
 * @param options - Which resources to export
 * @returns Bundle + export warnings
 */
export function exportResources(
  workspaceRootPath: string,
  options: ExportResourcesOptions,
): ExportResult {
  const warnings: string[] = []
  const redactions: ResourceRedaction[] = []
  const dependencies: ResourceDependency[] = []
  const initiallySelectedSources = new Set(options.sources === 'all' ? listDirectorySlugs(getWorkspaceSourcesPath(workspaceRootPath)) : options.sources ?? [])
  const initiallySelectedSkills = new Set(options.skills === 'all' ? listDirectorySlugs(getWorkspaceSkillsPath(workspaceRootPath)) : options.skills ?? [])
  const includeDependencies = options.includeDependencies !== false
  const automationSelection = options.automations === true ? 'all' : options.automations
  const automations = automationSelection
    ? exportAutomations(workspaceRootPath, automationSelection, warnings, redactions)
    : []

  const sourceSlugs = new Set(initiallySelectedSources)
  const skillSlugs = new Set(initiallySelectedSkills)
  const availableSources = new Set(listDirectorySlugs(getWorkspaceSourcesPath(workspaceRootPath)))
  const availableSkills = new Set(listDirectorySlugs(getWorkspaceSkillsPath(workspaceRootPath)))

  for (const automation of automations) {
    const from: ResourceRef = { type: 'automation', id: automation.id }
    for (const action of automation.matcher.actions ?? []) {
      if (action.type === 'prompt') {
        for (const mention of parsePromptReferences(action.prompt).mentions) {
          if (availableSources.has(mention)) {
            dependencies.push({ from, to: { type: 'source', id: mention }, reason: 'automation-mention' })
            if (includeDependencies) sourceSlugs.add(mention)
          } else if (availableSkills.has(mention)) {
            dependencies.push({ from, to: { type: 'skill', id: mention }, reason: 'automation-mention' })
            if (includeDependencies) skillSlugs.add(mention)
          } else {
            dependencies.push({ from, to: { type: 'skill', id: mention }, reason: 'automation-mention', external: true })
          }
        }
        if (action.llmConnection) dependencies.push({ from, to: { type: 'llm-connection', id: action.llmConnection }, reason: 'llm-connection', external: true })
        if (action.model) dependencies.push({ from, to: { type: 'model', id: action.model }, reason: 'model', external: true })
      }
    }
    for (const label of automation.matcher.labels ?? []) {
      dependencies.push({ from, to: { type: 'label', id: label }, reason: 'label', external: true })
    }
  }

  // Skills may themselves require sources. Iterate because dependency-added skills
  // are discovered before this pass and future bundle versions may add skill→skill edges.
  for (const slug of [...skillSlugs]) {
    for (const sourceSlug of readSkillRequiredSources(workspaceRootPath, slug)) {
      dependencies.push({
        from: { type: 'skill', id: slug },
        to: { type: 'source', id: sourceSlug },
        reason: 'skill-required-source',
        ...(!availableSources.has(sourceSlug) ? { external: true } : {}),
      })
      if (includeDependencies && availableSources.has(sourceSlug)) sourceSlugs.add(sourceSlug)
    }
  }

  const bundle: ResourceBundle = {
    kind: RESOURCE_BUNDLE_KIND,
    version: RESOURCE_BUNDLE_VERSION,
    exportedAt: Date.now(),
    ...(options.sourceVersion ? { sourceVersion: options.sourceVersion } : {}),
    resources: {},
  }

  // Try to read workspace name for informational purposes
  try {
    const wsConfigPath = join(workspaceRootPath, 'config.json')
    if (existsSync(wsConfigPath)) {
      const wsConfig = JSON.parse(readFileSync(wsConfigPath, 'utf-8'))
      if (wsConfig.name) {
        bundle.sourceWorkspace = wsConfig.name
      }
    }
  } catch {
    // Non-fatal: sourceWorkspace is informational
  }

  if (sourceSlugs.size > 0 || options.sources === 'all') {
    bundle.resources.sources = exportSources(workspaceRootPath, [...sourceSlugs], warnings, redactions)
  }

  if (skillSlugs.size > 0 || options.skills === 'all') {
    bundle.resources.skills = exportSkills(workspaceRootPath, [...skillSlugs], warnings)
  }

  if (automationSelection) {
    bundle.resources.automations = automations
  }

  const items: ResourceBundleManifest['items'] = [
    ...(bundle.resources.sources ?? []).map(entry => ({ type: 'source' as const, id: entry.slug, name: entry.config.name, selected: initiallySelectedSources.has(entry.slug), autoAdded: !initiallySelectedSources.has(entry.slug) })),
    ...(bundle.resources.skills ?? []).map(entry => ({ type: 'skill' as const, id: entry.slug, name: readSkillName(entry), selected: initiallySelectedSkills.has(entry.slug), autoAdded: !initiallySelectedSkills.has(entry.slug) })),
    ...(bundle.resources.automations ?? []).map(entry => ({ type: 'automation' as const, id: entry.id, name: entry.name, selected: true })),
  ]
  bundle.manifest = { items, dependencies, redactions }
  bundle.integrity = { algorithm: 'sha256', digest: computeBundleDigest(bundle) }

  const bundleJson = JSON.stringify(bundle)
  if (Buffer.byteLength(bundleJson) > MAX_BUNDLE_SIZE_BYTES) {
    throw new Error(`Bundle exceeds ${MAX_BUNDLE_SIZE_BYTES / 1024 / 1024}MB size limit`)
  }
  const finalAudit = validateResourceBundle(bundle)
  if (!finalAudit.valid) {
    throw new Error(`Resource bundle failed final security validation: ${finalAudit.errors.join('; ')}`)
  }

  return { bundle, warnings }
}

function listDirectorySlugs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort()
}

function readSkillRequiredSources(workspaceRootPath: string, slug: string): string[] {
  try {
    const raw = readFileSync(join(getWorkspaceSkillsPath(workspaceRootPath), slug, 'SKILL.md'), 'utf-8')
    const value = matter(raw).data.requiredSources
    const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    return [...new Set(values.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(Boolean))]
  } catch {
    return []
  }
}

function readSkillName(entry: SkillBundleEntry): string | undefined {
  try {
    const skill = entry.files.find(file => file.relativePath === 'SKILL.md')
    if (!skill) return undefined
    return matter(Buffer.from(skill.contentBase64, 'base64').toString('utf-8')).data.name as string | undefined
  } catch {
    return undefined
  }
}

function exportSources(
  workspaceRootPath: string,
  selection: string[] | 'all',
  warnings: string[],
  redactions: ResourceRedaction[],
): SourceBundleEntry[] {
  const entries: SourceBundleEntry[] = []
  const sourcesDir = getWorkspaceSourcesPath(workspaceRootPath)

  if (!existsSync(sourcesDir)) return entries

  // Determine which slugs to export
  let slugs: string[]
  if (selection === 'all') {
    slugs = readdirSync(sourcesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
  } else {
    slugs = selection
  }

  for (const slug of slugs) {
    const sourcePath = getSourcePath(workspaceRootPath, slug)
    if (!existsSync(sourcePath)) {
      warnings.push(`Source '${slug}' not found, skipping`)
      continue
    }

    const config = loadSourceConfig(workspaceRootPath, slug)
    if (!config) {
      warnings.push(`Source '${slug}' has invalid config, skipping`)
      continue
    }

    // Sanitize config
    const { config: sanitizedConfig, warnings: sanitizeWarnings } = sanitizeSourceConfig(config, redactions)
    warnings.push(...sanitizeWarnings)

    // Collect all files except config.json (which travels as structured data)
    const files = collectDirectoryFiles(sourcePath, {
      skipFiles: new Set(['config.json']),
    })
    auditFreeformFiles(files, `Source '${slug}'`)

    entries.push({
      slug,
      config: sanitizedConfig,
      files,
    })
  }

  return entries
}

function exportSkills(
  workspaceRootPath: string,
  selection: string[] | 'all',
  warnings: string[],
): SkillBundleEntry[] {
  const entries: SkillBundleEntry[] = []
  const skillsDir = getWorkspaceSkillsPath(workspaceRootPath)

  if (!existsSync(skillsDir)) return entries

  // Determine which slugs to export
  let slugs: string[]
  if (selection === 'all') {
    slugs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name)
  } else {
    slugs = selection
  }

  for (const slug of slugs) {
    const skillDir = join(skillsDir, slug)
    if (!existsSync(skillDir)) {
      warnings.push(`Skill '${slug}' not found, skipping`)
      continue
    }

    // Collect all files in the skill directory
    const files = collectDirectoryFiles(skillDir, {
      includeHidden: true,
      rejectSymlinks: true,
      shouldSkip: (name, _relativePath, isDirectory) => {
        if (isDirectory && ['.git', '.svn', '.hg', 'node_modules', '__pycache__', '.cache', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'tmp', 'temp'].includes(name)) return true
        return /^\.env(?:\.|$)/i.test(name)
          || /(?:credentials?|secrets?)\.(?:json|ya?ml|txt)$/i.test(name)
          || /(?:\.tmp|\.temp|\.swp|\.bak|~)$/i.test(name)
          || /^(?:\.DS_Store|Thumbs\.db)$/i.test(name)
      },
    })

    // Validate that SKILL.md is present
    const hasSkillMd = files.some(f => f.relativePath === 'SKILL.md')
    if (!hasSkillMd) {
      warnings.push(`Skill '${slug}' missing SKILL.md, skipping`)
      continue
    }

    auditFreeformFiles(files, `Skill '${slug}'`)

    entries.push({ slug, files })
  }

  return entries
}

// ============================================================
// Export: Automations
// ============================================================

/** Header keys that are known to carry secrets (case-insensitive match) */
const SECRET_HEADER_PATTERNS = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /api[-_]?key/i,
  /cookie/i,
  /token/i,
]

function isSecretHeader(key: string): boolean {
  return SECRET_HEADER_PATTERNS.some(p => p.test(key))
}

/** Returns true if the value references an env var template like $VAR_NAME or ${VAR} (safe to keep) */
function isTemplatedValue(value: string): boolean {
  return /^(?:Bearer\s+)?(?:\$CRAFT_WH_[A-Z0-9_]+|\$\{CRAFT_WH_[A-Z0-9_]+\})$/i.test(value.trim())
}

/**
 * Sanitize a single automation matcher for export.
 * Strips webhook auth credentials and known auth headers.
 */
function sanitizeAutomationMatcher(
  matcher: AutomationMatcher,
  label: string,
  warnings: string[],
  redactions: ResourceRedaction[],
): AutomationMatcher {
  // Deep clone to avoid mutating the original
  const sanitized: AutomationMatcher = JSON.parse(JSON.stringify(matcher))

  if (!sanitized.actions) return sanitized

  for (let actionIndex = 0; actionIndex < sanitized.actions.length; actionIndex++) {
    const action = sanitized.actions[actionIndex]!
    if (action.type !== 'webhook') continue
    const ref: ResourceRef = { type: 'automation', id: sanitized.id ?? label }
    const redact = (path: string, reason: ResourceRedaction['reason'], requiredName?: string) => {
      redactions.push({ resource: ref, path, reason, ...(requiredName ? { requiredName } : {}) })
    }

    // Strip auth field entirely (bearer tokens, basic auth passwords)
    if (action.auth) {
      delete (action as unknown as Record<string, unknown>).auth
      redact(`matcher.actions[${actionIndex}].auth`, 'credential')
      warnings.push(`Automation '${label}': stripped webhook auth credentials`)
    }

    // Strip known auth headers (unless templated)
    if (action.headers) {
      const keysToStrip = Object.keys(action.headers).filter(
        key => isSecretHeader(key) && !isTemplatedValue(action.headers![key]!),
      )
      for (const key of keysToStrip) {
        delete action.headers[key]
        redact(`matcher.actions[${actionIndex}].headers.${key}`, 'secret-header', key)
        warnings.push(`Automation '${label}': stripped webhook header '${key}'`)
      }
      // Clean up empty headers object
      if (Object.keys(action.headers).length === 0) {
        delete (action as unknown as Record<string, unknown>).headers
      }
    }

    action.url = sanitizeUrl(action.url, (path, name) => redact(path, 'secret-url', name), `matcher.actions[${actionIndex}].url`)
    if (action.body !== undefined) {
      action.body = sanitizeUnknown(
        action.body,
        `matcher.actions[${actionIndex}].body`,
        (path, name) => redact(path, 'credential', name),
        isTemplatedValue,
      )
    }
  }

  return sanitized
}

function exportAutomations(
  workspaceRootPath: string,
  selection: string[] | 'all',
  warnings: string[],
  redactions: ResourceRedaction[],
): AutomationBundleEntry[] {
  const automationsPath = join(workspaceRootPath, AUTOMATIONS_CONFIG_FILE)

  if (!existsSync(automationsPath)) {
    warnings.push('No automations.json found in workspace')
    return []
  }

  // Read and validate via the full validation pipeline
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(automationsPath, 'utf-8'))
  } catch (err) {
    warnings.push(`Failed to read automations.json: ${err}`)
    return []
  }

  const validation = validateAutomationsConfig(raw)
  if (!validation.valid || !validation.config) {
    warnings.push(`automations.json is invalid: ${validation.errors.join('; ')}`)
    return []
  }

  // Flatten { event: matchers[] } into individual entries
  const allEntries: AutomationBundleEntry[] = []
  for (const [event, matchers] of Object.entries(validation.config.automations)) {
    if (!matchers) continue
    for (const matcher of matchers) {
      // Ensure every matcher has an ID (backfill if missing)
      const id = matcher.id || generateShortId()
      allEntries.push({
        id,
        name: matcher.name,
        event,
        matcher: { ...matcher, id },
      })
    }
  }

  // Apply selection filter
  let selected: AutomationBundleEntry[]
  if (selection === 'all') {
    selected = allEntries
  } else {
    const matched = new Set<string>()
    selected = []
    for (const selector of selection) {
      const matches = allEntries.filter(
        e => e.id === selector || (e.name !== undefined && e.name === selector),
      )
      if (matches.length === 0) {
        warnings.push(`Automation selector '${selector}' did not match any automation`)
      } else if (matches.length > 1 && matches.every(m => m.id !== selector)) {
        // Name matched multiple — warn about ambiguity but include all
        warnings.push(`Automation name '${selector}' matched ${matches.length} automations`)
      }
      for (const m of matches) {
        if (!matched.has(m.id)) {
          matched.add(m.id)
          selected.push(m)
        }
      }
    }
  }

  // Sanitize each entry
  return selected.map(entry => ({
    ...entry,
    matcher: sanitizeAutomationMatcher(
      entry.matcher,
      entry.name ?? entry.id,
      warnings,
      redactions,
    ),
  }))
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate a ResourceBundle structure.
 * Returns { valid, errors } rather than a type guard, so callers get diagnostics.
 */
export function validateResourceBundle(bundle: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!bundle || typeof bundle !== 'object') {
    return { valid: false, errors: ['Bundle is not an object'] }
  }

  const b = bundle as Record<string, unknown>

  if (b.version !== 1 && b.version !== 2) {
    errors.push(`Unsupported bundle version: ${b.version}`)
  }

  if (b.version === 2) {
    if (b.kind !== RESOURCE_BUNDLE_KIND) errors.push(`Invalid bundle kind: ${b.kind}`)
    const integrity = b.integrity as Record<string, unknown> | undefined
    if (!integrity || integrity.algorithm !== 'sha256' || typeof integrity.digest !== 'string') {
      errors.push('Missing or invalid integrity metadata')
    } else if (!/^[a-f0-9]{64}$/.test(integrity.digest)) {
      errors.push('Invalid SHA-256 digest')
    } else if (computeBundleDigest(bundle as ResourceBundle) !== integrity.digest) {
      errors.push('Bundle integrity check failed')
    }
    if (integrity) rejectUnknownKeys(integrity, ['algorithm', 'digest'], 'integrity', errors)
    const manifest = b.manifest as Record<string, unknown> | undefined
    if (!manifest || !Array.isArray(manifest.items) || !Array.isArray(manifest.dependencies) || !Array.isArray(manifest.redactions)) {
      errors.push('Missing or invalid manifest')
    } else {
      rejectUnknownKeys(manifest, ['items', 'dependencies', 'redactions'], 'manifest', errors)
      const manifestIds = new Set<string>()
      for (let index = 0; index < manifest.items.length; index++) {
        const value = manifest.items[index]
        if (!value || typeof value !== 'object') { errors.push(`manifest.items[${index}]: invalid item`); continue }
        const item = value as Record<string, unknown>
        rejectUnknownKeys(item, ['type', 'id', 'name', 'selected', 'autoAdded'], `manifest.items[${index}]`, errors)
        const key = `${String(item.type)}:${String(item.id)}`
        if (!['source', 'skill', 'automation'].includes(String(item.type)) || typeof item.id !== 'string' || typeof item.selected !== 'boolean') errors.push(`manifest.items[${index}]: invalid resource reference`)
        if (item.name !== undefined && typeof item.name !== 'string') errors.push(`manifest.items[${index}]: name must be a string`)
        if (item.autoAdded !== undefined && typeof item.autoAdded !== 'boolean') errors.push(`manifest.items[${index}]: autoAdded must be a boolean`)
        if (manifestIds.has(key)) errors.push(`manifest.items[${index}]: duplicate resource reference '${key}'`)
        manifestIds.add(key)
      }
      for (let index = 0; index < manifest.dependencies.length; index++) {
        const value = manifest.dependencies[index]
        if (!value || typeof value !== 'object') { errors.push(`manifest.dependencies[${index}]: invalid dependency`); continue }
        const dependency = value as Record<string, unknown>
        const path = `manifest.dependencies[${index}]`
        rejectUnknownKeys(dependency, ['from', 'to', 'reason', 'external'], path, errors)
        validateResourceReference(dependency.from, ['source', 'skill', 'automation'], `${path}.from`, errors)
        validateResourceReference(dependency.to, ['source', 'skill', 'automation', 'label', 'llm-connection', 'model'], `${path}.to`, errors)
        if (!['automation-mention', 'skill-required-source', 'label', 'llm-connection', 'model'].includes(String(dependency.reason))) errors.push(`${path}: invalid reason`)
        if (dependency.external !== undefined && typeof dependency.external !== 'boolean') errors.push(`${path}: external must be a boolean`)
      }
      for (let index = 0; index < manifest.redactions.length; index++) {
        const value = manifest.redactions[index]
        if (!value || typeof value !== 'object') { errors.push(`manifest.redactions[${index}]: invalid redaction`); continue }
        const redaction = value as Record<string, unknown>
        const path = `manifest.redactions[${index}]`
        rejectUnknownKeys(redaction, ['resource', 'path', 'reason', 'requiredName'], path, errors)
        validateResourceReference(redaction.resource, ['source', 'skill', 'automation'], `${path}.resource`, errors)
        if (typeof redaction.path !== 'string' || redaction.path.length === 0) errors.push(`${path}: invalid path`)
        if (!['credential', 'secret-header', 'secret-env', 'secret-url', 'runtime-state'].includes(String(redaction.reason))) errors.push(`${path}: invalid reason`)
        if (redaction.requiredName !== undefined && typeof redaction.requiredName !== 'string') errors.push(`${path}: requiredName must be a string`)
      }
    }
  }

  if (typeof b.exportedAt !== 'number') {
    errors.push('Missing or invalid exportedAt')
  }
  if (b.sourceWorkspace !== undefined && typeof b.sourceWorkspace !== 'string') errors.push('sourceWorkspace must be a string')
  if (b.sourceVersion !== undefined && typeof b.sourceVersion !== 'string') errors.push('sourceVersion must be a string')

  if (!b.resources || typeof b.resources !== 'object') {
    errors.push('Missing or invalid resources')
    return { valid: false, errors }
  }

  const res = b.resources as Record<string, unknown>
  for (const key of Object.keys(b)) {
    if (!['kind', 'version', 'exportedAt', 'sourceWorkspace', 'sourceVersion', 'resources', 'manifest', 'integrity'].includes(key)) {
      errors.push(`Unknown bundle field: ${key}`)
    }
  }
  for (const key of Object.keys(res)) {
    if (!['sources', 'skills', 'automations'].includes(key)) errors.push(`Unknown resources field: ${key}`)
  }

  const secretPaths: string[] = []
  findStructuredSecrets(res, 'resources', secretPaths)
  for (const path of secretPaths) errors.push(`${path}: credential-like value is not allowed`)

  // Validate sources
  if (res.sources !== undefined) {
    if (!Array.isArray(res.sources)) {
      errors.push('resources.sources must be an array')
    } else {
      const slugs = new Set<string>()
      for (let i = 0; i < res.sources.length; i++) {
        const entry = res.sources[i]
        const prefix = `sources[${i}]`

        if (!entry || typeof entry !== 'object') {
          errors.push(`${prefix}: not an object`)
          continue
        }

        const e = entry as Record<string, unknown>
        rejectUnknownKeys(e, ['slug', 'config', 'files'], prefix, errors)

        if (typeof e.slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(e.slug)) {
          errors.push(`${prefix}: missing or invalid slug`)
          continue
        }

        if (slugs.has(e.slug as string)) {
          errors.push(`${prefix}: duplicate slug '${e.slug}'`)
        }
        slugs.add(e.slug as string)

        // Check for builtin/reserved slugs
        if (isBuiltinSource(e.slug as string)) {
          errors.push(`${prefix}: '${e.slug}' is a reserved builtin source slug`)
        }

        if (!e.config || typeof e.config !== 'object' || Array.isArray(e.config)) {
          errors.push(`${prefix}: missing or invalid config`)
        } else {
          const cfg = e.config as Record<string, unknown>
          rejectUnknownKeys(cfg, ['id', 'name', 'slug', 'enabled', 'provider', 'type', 'mcp', 'api', 'local', 'icon', 'tagline', 'brand', 'isAuthenticated', 'connectionStatus', 'createdAt', 'updatedAt'], `${prefix}.config`, errors)
          if (typeof cfg.slug === 'string' && cfg.slug !== e.slug) {
            errors.push(`${prefix}: config.slug '${cfg.slug}' does not match entry slug '${e.slug}'`)
          }
          if (cfg.mcp !== undefined && (!cfg.mcp || typeof cfg.mcp !== 'object' || Array.isArray(cfg.mcp))) errors.push(`${prefix}.config.mcp: invalid object`)
          else if (cfg.mcp) rejectUnknownKeys(cfg.mcp as Record<string, unknown>, ['transport', 'url', 'authType', 'clientId', 'command', 'args', 'headers', 'headerNames'], `${prefix}.config.mcp`, errors)
          if (cfg.api !== undefined && (!cfg.api || typeof cfg.api !== 'object' || Array.isArray(cfg.api))) errors.push(`${prefix}.config.api: invalid object`)
          else if (cfg.api) {
            const api = cfg.api as Record<string, unknown>
            rejectUnknownKeys(api, ['baseUrl', 'authType', 'headerName', 'headerNames', 'queryParam', 'authScheme', 'defaultHeaders', 'testEndpoint', 'renewEndpoint', 'googleService', 'googleScopes', 'googleOAuthClientId', 'slackService', 'slackUserScopes', 'microsoftService', 'microsoftScopes', 'oauth'], `${prefix}.config.api`, errors)
            if (api.testEndpoint && typeof api.testEndpoint === 'object') rejectUnknownKeys(api.testEndpoint as Record<string, unknown>, ['method', 'path', 'body', 'headers'], `${prefix}.config.api.testEndpoint`, errors)
            if (api.renewEndpoint && typeof api.renewEndpoint === 'object') rejectUnknownKeys(api.renewEndpoint as Record<string, unknown>, ['path', 'method', 'body', 'headers', 'tokenField', 'expiresInField', 'fallbackTtlSecs'], `${prefix}.config.api.renewEndpoint`, errors)
            if (api.oauth && typeof api.oauth === 'object') rejectUnknownKeys(api.oauth as Record<string, unknown>, ['authorizationUrl', 'tokenUrl', 'clientId', 'scopes', 'audience', 'extraParams'], `${prefix}.config.api.oauth`, errors)
          }
          if (cfg.local !== undefined && (!cfg.local || typeof cfg.local !== 'object' || Array.isArray(cfg.local))) errors.push(`${prefix}.config.local: invalid object`)
          else if (cfg.local) rejectUnknownKeys(cfg.local as Record<string, unknown>, ['path', 'format'], `${prefix}.config.local`, errors)
          if (b.version === 2) {
            try {
              const configValidation = validateSourceConfig(e.config as FolderSourceConfig)
              if (!configValidation.valid) {
                errors.push(...configValidation.errors.map(error => `${prefix}.config.${error.path}: ${error.message}`))
              }
            } catch {
              errors.push(`${prefix}: invalid source config`)
            }
          }
        }

        if (!Array.isArray(e.files)) {
          errors.push(`${prefix}: files must be an array`)
        } else {
          validateFileEntries(e.files as BundleFile[], prefix, errors)
          try { auditFreeformFiles(e.files as BundleFile[], prefix) } catch (error) { errors.push(String(error)) }
        }
      }
    }
  }

  // Validate skills
  if (res.skills !== undefined) {
    if (!Array.isArray(res.skills)) {
      errors.push('resources.skills must be an array')
    } else {
      const slugs = new Set<string>()
      for (let i = 0; i < res.skills.length; i++) {
        const entry = res.skills[i]
        const prefix = `skills[${i}]`

        if (!entry || typeof entry !== 'object') {
          errors.push(`${prefix}: not an object`)
          continue
        }

        const e = entry as Record<string, unknown>
        rejectUnknownKeys(e, ['slug', 'files'], prefix, errors)

        if (typeof e.slug !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(e.slug)) {
          errors.push(`${prefix}: missing or invalid slug`)
          continue
        }

        if (slugs.has(e.slug as string)) {
          errors.push(`${prefix}: duplicate slug '${e.slug}'`)
        }
        slugs.add(e.slug as string)

        if (!Array.isArray(e.files)) {
          errors.push(`${prefix}: files must be an array`)
        } else {
          // Validate SKILL.md is present
          const hasSkillMd = (e.files as BundleFile[]).some(f =>
            typeof f === 'object' && f && (f as BundleFile).relativePath === 'SKILL.md',
          )
          if (!hasSkillMd) {
            errors.push(`${prefix}: missing SKILL.md`)
          }
          validateFileEntries(e.files as BundleFile[], prefix, errors)
          try { auditFreeformFiles(e.files as BundleFile[], prefix) } catch (error) { errors.push(String(error)) }
        }
      }
    }
  }

  // Validate automations
  if (res.automations !== undefined) {
    if (!Array.isArray(res.automations)) {
      errors.push('resources.automations must be an array')
    } else {
      const ids = new Set<string>()
      for (let i = 0; i < res.automations.length; i++) {
        const entry = res.automations[i]
        const prefix = `automations[${i}]`

        if (!entry || typeof entry !== 'object') {
          errors.push(`${prefix}: not an object`)
          continue
        }

        const e = entry as Record<string, unknown>
        rejectUnknownKeys(e, ['id', 'name', 'event', 'matcher'], prefix, errors)

        if (typeof e.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(e.id)) {
          errors.push(`${prefix}: missing or invalid id`)
          continue
        }

        if (ids.has(e.id as string)) {
          errors.push(`${prefix}: duplicate id '${e.id}'`)
        }
        ids.add(e.id as string)

        if (typeof e.event !== 'string' || !e.event) {
          errors.push(`${prefix}: missing or invalid event`)
        } else if (!VALID_EVENTS.includes(e.event as string)) {
          errors.push(`${prefix}: unknown event type '${e.event}'`)
        }

        if (!e.matcher || typeof e.matcher !== 'object') {
          errors.push(`${prefix}: missing or invalid matcher`)
        } else {
          const m = e.matcher as Record<string, unknown>
          rejectUnknownKeys(m, ['id', 'name', 'matcher', 'cron', 'timezone', 'permissionMode', 'labels', 'enabled', 'conditions', 'telegramTopic', 'maxDepth', 'actions'], `${prefix}.matcher`, errors)
          if (typeof m.id === 'string' && m.id !== e.id) errors.push(`${prefix}: matcher.id '${m.id}' does not match entry id '${e.id}'`)
          if (!Array.isArray(m.actions) || m.actions.length === 0) {
            errors.push(`${prefix}: matcher must have at least one action`)
          } else {
            for (let actionIndex = 0; actionIndex < m.actions.length; actionIndex++) {
              const action = m.actions[actionIndex]
              const actionPath = `${prefix}.matcher.actions[${actionIndex}]`
              if (!action || typeof action !== 'object') {
                errors.push(`${actionPath}: action must be an object`)
                continue
              }
              const actionObject = action as Record<string, unknown>
              if (actionObject.type === 'prompt') rejectUnknownKeys(actionObject, ['type', 'prompt', 'llmConnection', 'model', 'thinkingLevel', 'waitForCompletion', 'reportBack', 'timeoutMs'], actionPath, errors)
              else if (actionObject.type === 'webhook') rejectUnknownKeys(actionObject, ['type', 'url', 'method', 'headers', 'bodyFormat', 'body', 'captureResponse'], actionPath, errors)
              else if (actionObject.type === 'decision') rejectUnknownKeys(actionObject, ['type', 'decision', 'reason', 'updatedInput'], actionPath, errors)
              else errors.push(`${actionPath}: unknown action type '${String(actionObject.type)}'`)
            }
            if (typeof e.event === 'string' && VALID_EVENTS.includes(e.event as string)) {
              const matcherValidation = validateAutomationsConfig({ version: 2, automations: { [e.event as string]: [m] } })
              if (!matcherValidation.valid) errors.push(`${prefix}: invalid matcher: ${matcherValidation.errors.join('; ')}`)
            }
          }
        }
      }
    }
  }

  // Validate total bundle size
  try {
    const size = Buffer.byteLength(JSON.stringify(bundle))
    if (size > MAX_BUNDLE_SIZE_BYTES) {
      errors.push(`Bundle size ${size} exceeds max ${MAX_BUNDLE_SIZE_BYTES}`)
    }
  } catch {
    errors.push('Bundle is not serializable')
  }

  return { valid: errors.length === 0, errors }
}

function findStructuredSecrets(value: unknown, path: string, output: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findStructuredSecrets(entry, `${path}[${index}]`, output))
    return
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && looksLikeSecretValue(value)) output.push(path)
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    if (SECRET_KEY_PATTERN.test(key) && typeof child === 'string' && !isSafeTemplate(child) && !isTemplatedValue(child)) {
      output.push(childPath)
      continue
    }
    if (SECRET_KEY_PATTERN.test(key) && child && typeof child === 'object') {
      output.push(childPath)
      continue
    }
    findStructuredSecrets(child, childPath, output)
  }
}

function validateFileEntries(files: BundleFile[], prefix: string, errors: string[]): void {
  const paths = new Set<string>()

  for (let j = 0; j < files.length; j++) {
    const file = files[j]
    if (!file || typeof file !== 'object') {
      errors.push(`${prefix}.files[${j}]: not an object`)
      continue
    }
    rejectUnknownKeys(file as unknown as Record<string, unknown>, ['relativePath', 'contentBase64', 'size'], `${prefix}.files[${j}]`, errors)

    // Check for duplicate paths
    if (paths.has(file.relativePath)) {
      errors.push(`${prefix}.files[${j}]: duplicate path '${file.relativePath}'`)
    }
    paths.add(file.relativePath)

    const fileError = validateBundleFile(file)
    if (fileError) {
      errors.push(`${prefix}.files[${j}]: ${fileError}`)
    }
  }
}

function loadExistingAutomations(workspaceRootPath: string): AutomationBundleEntry[] {
  const path = join(workspaceRootPath, AUTOMATIONS_CONFIG_FILE)
  if (!existsSync(path)) return []
  try {
    // Conflict detection must remain conservative even when the target config
    // contains another invalid matcher. Read only stable IDs/names here; the
    // actual import path still performs full schema validation before writing.
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { automations?: Record<string, unknown> }
    const entries: AutomationBundleEntry[] = []
    for (const [event, matchers] of Object.entries(raw.automations ?? {})) {
      if (!Array.isArray(matchers)) continue
      for (const value of matchers) {
        if (!value || typeof value !== 'object') continue
        const matcher = value as AutomationMatcher
        if (typeof matcher.id === 'string') entries.push({ id: matcher.id, name: typeof matcher.name === 'string' ? matcher.name : undefined, event, matcher })
      }
    }
    return entries
  } catch {
    return []
  }
}

function isHighRiskAutomation(entry: AutomationBundleEntry): boolean {
  return entry.matcher.permissionMode === 'allow-all' || entry.matcher.actions.some(action =>
    action.type === 'webhook' || action.type === 'decision',
  )
}

function fingerprintDirectory(path: string): string {
  const files = collectDirectoryFiles(path, { includeHidden: true })
  return createHash('sha256').update(canonicalize(files)).digest('hex')
}

function fingerprintValues(values: unknown[]): string | undefined {
  if (values.length === 0) return undefined
  return createHash('sha256').update(canonicalize(values)).digest('hex')
}

function uniqueImportId(base: string, used: Set<string>): string {
  const normalized = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'imported'
  let candidate = `${normalized}-imported`
  let suffix = 2
  while (used.has(candidate)) candidate = `${normalized}-imported-${suffix++}`
  return candidate
}

export function previewResourceImport(
  workspaceRootPath: string,
  bundle: ResourceBundle,
): ResourceImportPreview {
  workspaceRootPath = resolveFsPath(workspaceRootPath)
  const validation = validateResourceBundle(bundle)
  if (!validation.valid) {
    return {
      valid: false,
      version: bundle?.version === 1 || bundle?.version === 2 ? bundle.version : null,
      integrityVerified: false,
      errors: validation.errors,
      warnings: [],
      items: [],
    }
  }

  const warnings = bundle.version === 1 ? ['Legacy v1 bundle: integrity metadata is unavailable'] : []
  const existingSourceIds = new Set(listDirectorySlugs(getWorkspaceSourcesPath(workspaceRootPath)))
  const existingSkillIds = new Set(listDirectorySlugs(getWorkspaceSkillsPath(workspaceRootPath)))
  const existingAutomations = loadExistingAutomations(workspaceRootPath)
  const existingAutomationIds = new Set(existingAutomations.map(entry => entry.id))
  const sourceNameIds = new Map<string, string[]>()
  for (const slug of existingSourceIds) {
    const name = loadSourceConfig(workspaceRootPath, slug)?.name?.toLowerCase()
    if (name) sourceNameIds.set(name, [...(sourceNameIds.get(name) ?? []), slug])
  }
  const skillNameIds = new Map<string, string[]>()
  for (const slug of existingSkillIds) {
    try {
      const parsed = matter(readFileSync(join(getWorkspaceSkillsPath(workspaceRootPath), slug, 'SKILL.md'), 'utf-8'))
      if (typeof parsed.data.name === 'string') {
        const name = parsed.data.name.toLowerCase()
        skillNameIds.set(name, [...(skillNameIds.get(name) ?? []), slug])
      }
    } catch { /* invalid existing skills do not block preview */ }
  }
  const automationNameIds = new Map<string, string[]>()
  for (const entry of existingAutomations) {
    if (!entry.name) continue
    const name = entry.name.toLowerCase()
    automationNameIds.set(name, [...(automationNameIds.get(name) ?? []), entry.id])
  }
  const bundled = new Set<string>([
    ...(bundle.resources.sources ?? []).map(entry => `source:${entry.slug}`),
    ...(bundle.resources.skills ?? []).map(entry => `skill:${entry.slug}`),
    ...(bundle.resources.automations ?? []).map(entry => `automation:${entry.id}`),
  ])
  const suggestionIds = {
    source: new Set([...existingSourceIds, ...(bundle.resources.sources ?? []).map(entry => entry.slug)]),
    skill: new Set([...existingSkillIds, ...(bundle.resources.skills ?? []).map(entry => entry.slug)]),
    automation: new Set([...existingAutomationIds, ...(bundle.resources.automations ?? []).map(entry => entry.id)]),
  }

  const dependencies = bundle.manifest?.dependencies ?? []
  const redacted = new Set((bundle.manifest?.redactions ?? [])
    .filter(entry => entry.reason !== 'runtime-state')
    .map(entry => resourceKey(entry.resource)))
  const items: ResourceImportPreviewItem[] = []

  const dependencyAvailable = (dependency: ResourceDependency): boolean => {
    if (dependency.to.type === 'source') return existingSourceIds.has(dependency.to.id) || bundled.has(`source:${dependency.to.id}`)
    if (dependency.to.type === 'skill') {
      return existingSkillIds.has(dependency.to.id)
        || bundled.has(`skill:${dependency.to.id}`)
        || Boolean(loadSkillBySlug(workspaceRootPath, dependency.to.id))
    }
    return false
  }

  const addItem = (ref: ResourceRef, name: string | undefined, highRisk: boolean, requiresAuth = false) => {
    const identitySet = ref.type === 'source' ? existingSourceIds : ref.type === 'skill' ? existingSkillIds : existingAutomationIds
    const nameMap = ref.type === 'source' ? sourceNameIds : ref.type === 'skill' ? skillNameIds : automationNameIds
    const identityConflict = identitySet.has(ref.id)
    const nameConflict = Boolean(name && nameMap.has(name.toLowerCase()) && !identityConflict)
    const targetIds = identityConflict
      ? [ref.id]
      : nameConflict && name
        ? nameMap.get(name.toLowerCase()) ?? []
        : []
    const targetFingerprint = ref.type === 'automation'
      ? fingerprintValues(targetIds.map(id => existingAutomations.find(entry => entry.id === id)))
      : fingerprintValues(targetIds.map(id => ({
          id,
          digest: fingerprintDirectory(ref.type === 'source'
            ? getSourcePath(workspaceRootPath, id)
            : join(getWorkspaceSkillsPath(workspaceRootPath), id)),
        })))
    let suggestedId: string | undefined
    if (identityConflict || nameConflict) {
      const used = suggestionIds[ref.type]
      if (ref.type === 'automation') {
        do { suggestedId = generateShortId() } while (used.has(suggestedId))
      } else {
        suggestedId = uniqueImportId(ref.id, used)
      }
      used.add(suggestedId)
    }
    const missingDependencies = dependencies
      .filter(dependency => resourceKey(dependency.from) === resourceKey(ref))
      .filter(dependency => {
        if (dependency.to.type === 'source' || dependency.to.type === 'skill') return !dependencyAvailable(dependency)
        return false
      })
      .map(dependency => dependency.to)
    const itemWarnings = dependencies
      .filter(dependency => resourceKey(dependency.from) === resourceKey(ref) && dependency.external && !dependencyAvailable(dependency))
      .map(dependency => `External dependency must be verified: ${dependency.to.type}:${dependency.to.id}`)
    items.push({
      ...ref,
      ...(name ? { name } : {}),
      status: identityConflict ? 'identity-conflict' : nameConflict ? 'name-conflict' : 'new',
      ...(targetFingerprint ? { targetFingerprint } : {}),
      ...(suggestedId ? { suggestedId } : {}),
      needsConfiguration: requiresAuth || redacted.has(resourceKey(ref)),
      highRisk: highRisk || redacted.has(resourceKey(ref)),
      missingDependencies,
      warnings: itemWarnings,
    })
  }

  for (const entry of bundle.resources.sources ?? []) {
    const authType = entry.config.mcp?.authType ?? entry.config.api?.authType
    addItem({ type: 'source', id: entry.slug }, entry.config.name, entry.config.type === 'mcp', Boolean(authType && authType !== 'none'))
  }
  for (const entry of bundle.resources.skills ?? []) addItem({ type: 'skill', id: entry.slug }, readSkillName(entry), false)
  for (const entry of bundle.resources.automations ?? []) addItem({ type: 'automation', id: entry.id }, entry.name, isHighRiskAutomation(entry))

  return {
    valid: true,
    version: bundle.version,
    integrityVerified: bundle.version === 2,
    errors: [],
    warnings,
    items,
  }
}

// ============================================================
// Import
// ============================================================

/**
 * Import a ResourceBundle into a target workspace.
 *
 * Uses staging + atomic rename per resource to minimize watcher churn
 * and ensure true replacement on overwrite.
 *
 * @param workspaceRootPath - Absolute path to target workspace
 * @param bundle - The validated ResourceBundle to import
 * @param mode - 'skip' (keep existing) or 'overwrite' (replace)
 * @param deps - Injected dependencies for credential cleanup
 */
export async function importResources(
  workspaceRootPath: string,
  bundle: ResourceBundle,
  modeOrPlan: ResourceImportMode | ResourceImportPlan,
  deps: ResourceImportDeps,
): Promise<ResourceImportResult> {
  // NFC-resolve so Chinese workspace folder paths are stable
  workspaceRootPath = resolveFsPath(workspaceRootPath)
  // Validate bundle first
  const validation = validateResourceBundle(bundle)
  if (!validation.valid) {
    const errorMsg = `Invalid bundle: ${validation.errors.join('; ')}`
    const failedBucket = { imported: [], skipped: [], failed: [{ id: '*', error: errorMsg }], warnings: [] }
    return {
      sources: { ...failedBucket },
      skills: { ...failedBucket },
      automations: { ...failedBucket },
    }
  }

  const workspaceId = basename(workspaceRootPath)
  const preview = previewResourceImport(workspaceRootPath, bundle)
  const decisions = buildDecisionMap(modeOrPlan, preview)
  validateImportDecisionTargets(workspaceRootPath, bundle, decisions)
  const prepared = prepareImportEntries(
    bundle,
    decisions,
    preview,
    typeof modeOrPlan === 'string' ? modeOrPlan : undefined,
  )
  const sourcesResult = emptyBucketResult()
  const skillsResult = emptyBucketResult()
  const automationsResult = emptyBucketResult()

  sourcesResult.skipped.push(...prepared.skipped.sources)
  skillsResult.skipped.push(...prepared.skipped.skills)
  automationsResult.skipped.push(...prepared.skipped.automations)

  // Import in dependency order. Each item keeps its own atomic staging boundary.
  for (const item of prepared.sources) {
    mergeBucket(sourcesResult, await importSources(workspaceRootPath, workspaceId, [item.entry], item.mode, deps))
  }
  for (const item of prepared.skills) {
    mergeBucket(skillsResult, importSkills(workspaceRootPath, [item.entry], item.mode))
  }
  for (const item of prepared.automations) {
    mergeBucket(automationsResult, importAutomations(workspaceRootPath, [item.entry], item.mode))
  }

  for (const item of preview.items) {
    const decision = decisions.get(resourceKey(item))
    if (decision?.action === 'skip') continue
    if (item.type === 'source' && item.needsConfiguration) {
      sourcesResult.warnings.push(`Source '${decision?.newId ?? item.id}' requires credential reconfiguration`)
    }
    if (item.type === 'source') {
      const source = bundle.resources.sources?.find(entry => entry.slug === item.id)
      if (source?.config.type === 'mcp') sourcesResult.warnings.push(`MCP source '${decision?.newId ?? item.id}' was imported disabled`)
    }
    const automationCanEnable = !item.highRisk && !item.needsConfiguration && item.missingDependencies.length === 0
    if (item.type === 'automation' && !(decision?.enableAfterImport && automationCanEnable)) {
      automationsResult.warnings.push(`Automation '${decision?.newName ?? item.name ?? decision?.newId ?? item.id}' was imported disabled`)
    }
  }

  return {
    sources: sourcesResult,
    skills: skillsResult,
    automations: automationsResult,
  }
}

function mergeBucket(target: ImportBucketResult, source: ImportBucketResult): void {
  target.imported.push(...source.imported)
  target.skipped.push(...source.skipped)
  target.failed.push(...source.failed)
  target.warnings.push(...source.warnings)
}

function buildDecisionMap(
  modeOrPlan: ResourceImportMode | ResourceImportPlan,
  preview: ResourceImportPreview,
): Map<string, ResourceImportDecision> {
  if (typeof modeOrPlan !== 'string') {
    const known = new Set(preview.items.map(resourceKey))
    const mapped = new Map<string, ResourceImportDecision>()
    for (const decision of modeOrPlan.decisions) {
      const key = resourceKey(decision)
      if (!known.has(key)) throw new Error(`Import plan references unknown resource '${key}'`)
      if (mapped.has(key)) throw new Error(`Import plan contains duplicate decision for '${key}'`)
      if (!['skip', 'overwrite', 'rename'].includes(decision.action)) throw new Error(`Invalid import action for '${key}'`)
      mapped.set(key, decision)
    }
    for (const key of known) {
      if (!mapped.has(key)) throw new Error(`Import plan is missing a decision for '${key}'`)
    }
    return mapped
  }
  return new Map(preview.items.map(item => [resourceKey(item), {
    type: item.type,
    id: item.id,
    action: modeOrPlan === 'skip' && item.status !== 'new' ? 'skip' : 'overwrite',
  }]))
}

function validateImportDecisionTargets(
  workspaceRootPath: string,
  bundle: ResourceBundle,
  decisions: Map<string, ResourceImportDecision>,
): void {
  const existingSources = new Set(listDirectorySlugs(getWorkspaceSourcesPath(workspaceRootPath)))
  const existingSkills = new Set(listDirectorySlugs(getWorkspaceSkillsPath(workspaceRootPath)))
  const existingAutomations = new Set(loadExistingAutomations(workspaceRootPath).map(entry => entry.id))
  const claimed = new Set<string>()

  for (const decision of decisions.values()) {
    if (decision.action !== 'rename') continue
    const newId = decision.newId || (decision.type === 'automation' ? undefined : '')
    if (decision.type !== 'automation' && (!newId || !/^[a-z0-9][a-z0-9._-]*$/.test(newId))) {
      throw new Error(`Invalid renamed ${decision.type} slug for '${decision.id}'`)
    }
    if (decision.type === 'automation' && newId && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(newId)) {
      throw new Error(`Invalid renamed automation ID for '${decision.id}'`)
    }
    if (!newId) continue
    const key = `${decision.type}:${newId}`
    if (claimed.has(key)) throw new Error(`Multiple resources would be renamed to '${newId}'`)
    claimed.add(key)
    const exists = decision.type === 'source'
      ? existingSources.has(newId)
      : decision.type === 'skill'
        ? existingSkills.has(newId)
        : existingAutomations.has(newId)
    if (exists) throw new Error(`Rename target already exists for ${decision.type} '${newId}'`)
    const bundledIds = decision.type === 'source'
      ? bundle.resources.sources?.map(entry => entry.slug)
      : decision.type === 'skill'
        ? bundle.resources.skills?.map(entry => entry.slug)
        : bundle.resources.automations?.map(entry => entry.id)
    if (bundledIds?.includes(newId) && newId !== decision.id) throw new Error(`Rename target conflicts with bundled ${decision.type} '${newId}'`)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceAutomationMentions(prompt: string, renames: Map<string, string>): string {
  let output = prompt
  for (const [from, to] of renames) {
    output = output.replace(new RegExp(`(^|[\\s(])@${escapeRegExp(from)}(?=$|[^a-zA-Z0-9-])`, 'g'), `$1@${to}`)
  }
  return output
}

function rewriteSkillRequiredSources(entry: SkillBundleEntry, sourceRenames: Map<string, string>): SkillBundleEntry {
  const files = entry.files.map(file => {
    if (file.relativePath !== 'SKILL.md') return file
    const raw = Buffer.from(file.contentBase64, 'base64').toString('utf-8')
    const parsed = matter(raw)
    const required = parsed.data.requiredSources
    if (typeof required === 'string') parsed.data.requiredSources = sourceRenames.get(required) ?? required
    else if (Array.isArray(required)) parsed.data.requiredSources = required.map(value => typeof value === 'string' ? sourceRenames.get(value) ?? value : value)
    const next = matter.stringify(parsed.content, parsed.data)
    const content = Buffer.from(next, 'utf-8')
    return { ...file, contentBase64: content.toString('base64'), size: content.length }
  })
  return { ...entry, files }
}

function prepareImportEntries(
  bundle: ResourceBundle,
  decisions: Map<string, ResourceImportDecision>,
  preview: ResourceImportPreview,
  legacyMode?: ResourceImportMode,
): {
  sources: Array<{ entry: SourceBundleEntry; mode: ResourceImportMode }>
  skills: Array<{ entry: SkillBundleEntry; mode: ResourceImportMode }>
  automations: Array<{ entry: AutomationBundleEntry; mode: ResourceImportMode }>
  skipped: { sources: string[]; skills: string[]; automations: string[] }
} {
  const copy = JSON.parse(JSON.stringify(bundle)) as ResourceBundle
  const sourceRenames = new Map<string, string>()
  const skillRenames = new Map<string, string>()
  const skipped = { sources: [] as string[], skills: [] as string[], automations: [] as string[] }
  const sources: Array<{ entry: SourceBundleEntry; mode: ResourceImportMode }> = []
  const skills: Array<{ entry: SkillBundleEntry; mode: ResourceImportMode }> = []
  const automations: Array<{ entry: AutomationBundleEntry; mode: ResourceImportMode }> = []

  for (const item of preview.items) {
    const decision = decisions.get(resourceKey(item))
    if (decision?.expectedStatus && decision.expectedStatus !== item.status) {
      throw new Error(`Target changed after preview for ${item.type} '${item.id}'`)
    }
    if (decision?.expectedTargetFingerprint !== undefined && decision.expectedTargetFingerprint !== item.targetFingerprint) {
      throw new Error(`Target changed after preview for ${item.type} '${item.id}'`)
    }
    if (decision?.action === 'overwrite' && item.status === 'name-conflict') {
      throw new Error(`Cannot overwrite ${item.type} '${item.id}' because only its name conflicts`)
    }
  }

  for (const entry of copy.resources.sources ?? []) {
    // Apply the current sanitizer again on import so legacy v1 bundles cannot
    // restore runtime auth state or fields that newer exporters no longer emit.
    entry.config = sanitizeSourceConfig(entry.config, []).config
    const decision = decisions.get(resourceKey({ type: 'source', id: entry.slug }))
    if (decision?.action === 'skip') { skipped.sources.push(entry.slug); continue }
    if (decision?.action === 'rename') {
      if (!decision.newId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(decision.newId)) {
        throw new Error(`Invalid renamed source slug for '${entry.slug}'`)
      }
      sourceRenames.set(entry.slug, decision.newId)
      entry.slug = decision.newId
      entry.config.slug = decision.newId
      entry.config.id = `${decision.newId}_${randomUUID().slice(0, 8)}`
    }
    entry.config.enabled = entry.config.type === 'mcp' ? false : entry.config.enabled
    sources.push({ entry, mode: legacyMode ?? (decision?.action === 'overwrite' ? 'overwrite' : 'skip') })
  }

  for (let entry of copy.resources.skills ?? []) {
    const originalId = entry.slug
    const decision = decisions.get(resourceKey({ type: 'skill', id: originalId }))
    if (decision?.action === 'skip') { skipped.skills.push(originalId); continue }
    if (decision?.action === 'rename') {
      if (!decision.newId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(decision.newId)) {
        throw new Error(`Invalid renamed skill slug for '${originalId}'`)
      }
      skillRenames.set(originalId, decision.newId)
      entry.slug = decision.newId
    }
    entry = rewriteSkillRequiredSources(entry, sourceRenames)
    skills.push({ entry, mode: legacyMode ?? (decision?.action === 'overwrite' ? 'overwrite' : 'skip') })
  }

  const mentionRenames = new Map([...skillRenames, ...sourceRenames])
  for (const entry of copy.resources.automations ?? []) {
    const originalId = entry.id
    const decision = decisions.get(resourceKey({ type: 'automation', id: originalId }))
    if (decision?.action === 'skip') { skipped.automations.push(entry.name ?? originalId); continue }
    if (decision?.action === 'rename') {
      entry.id = decision.newId || generateShortId()
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.id)) throw new Error(`Invalid renamed automation ID for '${originalId}'`)
      entry.matcher.id = entry.id
    }
    if (decision?.newName) {
      entry.name = decision.newName
      entry.matcher.name = decision.newName
    }
    for (const action of entry.matcher.actions) {
      if (action.type === 'prompt') action.prompt = replaceAutomationMentions(action.prompt, mentionRenames)
    }
    const previewItem = preview.items.find(item => item.type === 'automation' && item.id === originalId)
    entry.matcher.enabled = Boolean(decision?.enableAfterImport && !previewItem?.highRisk && previewItem?.missingDependencies.length === 0)
    automations.push({ entry, mode: legacyMode ?? (decision?.action === 'overwrite' ? 'overwrite' : 'skip') })
  }

  return { sources, skills, automations, skipped }
}

function emptyBucketResult(): ImportBucketResult {
  return { imported: [], skipped: [], failed: [], warnings: [] }
}

// ============================================================
// Import: Sources
// ============================================================

async function importSources(
  workspaceRootPath: string,
  workspaceId: string,
  entries: SourceBundleEntry[],
  mode: ResourceImportMode,
  deps: ResourceImportDeps,
): Promise<ImportBucketResult> {
  const result = emptyBucketResult()
  const sourcesDir = getWorkspaceSourcesPath(workspaceRootPath)

  if (!existsSync(sourcesDir)) {
    mkdirSync(sourcesDir, { recursive: true })
  }

  for (const entry of entries) {
    try {
      // Check for reserved slugs
      if (isBuiltinSource(entry.slug)) {
        result.failed.push({ id: entry.slug, error: 'Cannot import builtin source slug' })
        continue
      }

      const targetDir = getSourcePath(workspaceRootPath, entry.slug)
      const exists = existsSync(targetDir)

      if (exists && mode === 'skip') {
        result.skipped.push(entry.slug)
        continue
      }

      // Stage under short ASCII temp name (Windows + Chinese parent paths)
      const tmpDir = join(sourcesDir, `.tmp-${safeTempNameSegment(entry.slug)}-${randomUUID().slice(0, 8)}`)
      mkdirSync(tmpDir, { recursive: true })

      try {
        // Write sanitized config.json (explicit UTF-8 for Chinese names/paths)
        writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(entry.config, null, 2), 'utf-8')

        // Restore all other files
        restoreFiles(tmpDir, entry.files)

        // Validate: config should load correctly
        const validation = validateSourceConfig(entry.config)
        if (!validation.valid) {
          const msgs = validation.errors.map(e => `${e.path}: ${e.message}`).join(', ')
          result.failed.push({ id: entry.slug, error: `Invalid source config: ${msgs}` })
          rmSync(tmpDir, { recursive: true, force: true })
          continue
        }

        // On overwrite: clear credentials before replacing tree
        if (exists) {
          try {
            await deps.clearSourceCredentials(workspaceId, entry.slug)
          } catch (err) {
            throw new Error(`Refusing to overwrite source because stored credentials could not be cleared: ${err}`)
          }
        }

        // Windows-safe finalize (rename with copy fallback)
        finalizeStagedDirectory(tmpDir, targetDir)
        result.imported.push(entry.slug)
      } catch (err) {
        if (existsSync(tmpDir)) {
          rmSync(tmpDir, { recursive: true, force: true })
        }
        throw err
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.failed.push({ id: entry.slug, error: message })
    }
  }

  return result
}

// ============================================================
// Import: Skills
// ============================================================

function importSkills(
  workspaceRootPath: string,
  entries: SkillBundleEntry[],
  mode: ResourceImportMode,
): ImportBucketResult {
  const result = emptyBucketResult()
  const skillsDir = getWorkspaceSkillsPath(workspaceRootPath)

  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true })
  }

  for (const entry of entries) {
    try {
      const targetDir = join(skillsDir, entry.slug)
      const exists = existsSync(targetDir)

      if (exists && mode === 'skip') {
        result.skipped.push(entry.slug)
        continue
      }

      // Stage under short ASCII temp name (Windows + Chinese parent paths)
      const tmpDir = join(skillsDir, `.tmp-${safeTempNameSegment(entry.slug)}-${randomUUID().slice(0, 8)}`)
      mkdirSync(tmpDir, { recursive: true })

      try {
        // Restore all files
        restoreFiles(tmpDir, entry.files)

        // Validate: SKILL.md should exist
        if (!existsSync(join(tmpDir, 'SKILL.md'))) {
          result.failed.push({ id: entry.slug, error: 'SKILL.md missing after restore' })
          rmSync(tmpDir, { recursive: true, force: true })
          continue
        }

        // Windows-safe finalize (rename with copy fallback)
        finalizeStagedDirectory(tmpDir, targetDir)
        result.imported.push(entry.slug)
      } catch (err) {
        if (existsSync(tmpDir)) {
          rmSync(tmpDir, { recursive: true, force: true })
        }
        throw err
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.failed.push({ id: entry.slug, error: message })
    }
  }

  return result
}

// ============================================================
// Import: Automations
// ============================================================

/** Display label for an automation entry (name if available, otherwise ID) */
function automationLabel(entry: AutomationBundleEntry): string {
  return entry.name ?? entry.id
}

/**
 * Find a matcher by ID across all event arrays.
 * Returns { event, index } if found, undefined otherwise.
 */
function findMatcherById(
  automations: Record<string, AutomationMatcher[]>,
  id: string,
): { event: string; index: number } | undefined {
  for (const [event, matchers] of Object.entries(automations)) {
    for (let i = 0; i < matchers.length; i++) {
      if (matchers[i]?.id === id) return { event, index: i }
    }
  }
  return undefined
}

/**
 * Filter JSONL file to remove entries matching a set of matcher IDs.
 * Used for selective history/retry-queue cleanup on overwrite.
 */
function filterJsonlByMatcherIds(filePath: string, idsToRemove: Set<string>): void {
  if (!existsSync(filePath) || idsToRemove.size === 0) return

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n')
    const kept: string[] = []

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line)
        if (entry.matcherId && idsToRemove.has(entry.matcherId)) continue
        // History entries use automationId
        if (entry.automationId && idsToRemove.has(entry.automationId)) continue
        kept.push(line)
      } catch {
        // Keep unparseable lines (don't silently drop data)
        kept.push(line)
      }
    }

    writeFileSync(filePath, kept.length > 0 ? kept.join('\n') + '\n' : '', 'utf-8')
  } catch {
    // Non-critical: cleanup failure doesn't block import
  }
}

function importAutomations(
  workspaceRootPath: string,
  entries: AutomationBundleEntry[],
  mode: ResourceImportMode,
): ImportBucketResult {
  const result = emptyBucketResult()
  const configPath = join(workspaceRootPath, AUTOMATIONS_CONFIG_FILE)

  // Read existing config (if present)
  let existingConfig: { version?: number; automations: Record<string, AutomationMatcher[]> }

  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
      const validation = validateAutomationsConfig(raw)
      if (validation.valid && validation.config) {
        existingConfig = {
          version: (raw as Record<string, unknown>).version as number | undefined,
          automations: validation.config.automations as Record<string, AutomationMatcher[]>,
        }
      } else if (mode === 'overwrite') {
        // Existing config is invalid but we're overwriting — start fresh
        result.warnings.push('Existing automations.json is invalid, starting fresh in overwrite mode')
        existingConfig = { version: 2, automations: {} }
      } else {
        // Skip mode + invalid existing config — can't safely merge
        const errorMsg = `Cannot merge into invalid existing automations.json: ${validation.errors.join('; ')}`
        for (const entry of entries) {
          result.failed.push({ id: automationLabel(entry), error: errorMsg })
        }
        return result
      }
    } catch (err) {
      if (mode === 'overwrite') {
        result.warnings.push(`Existing automations.json is unreadable (${err}), starting fresh in overwrite mode`)
        existingConfig = { version: 2, automations: {} }
      } else {
        const errorMsg = `Cannot read existing automations.json: ${err}`
        for (const entry of entries) {
          result.failed.push({ id: automationLabel(entry), error: errorMsg })
        }
        return result
      }
    }
  } else {
    // No existing file — create new
    existingConfig = { version: 2, automations: {} }
  }

  const overwrittenIds = new Set<string>()

  // Merge entries
  for (const entry of entries) {
    // Backfill ID if missing
    const id = entry.id || generateShortId()
    const matcher: AutomationMatcher = { ...entry.matcher, id }
    const label = entry.name ?? id

    // Check if automation with this ID already exists
    const existing = findMatcherById(existingConfig.automations, id)

    if (existing) {
      if (mode === 'skip') {
        result.skipped.push(label)
        continue
      }
      // Overwrite: remove old, insert new at same position
      existingConfig.automations[existing.event]!.splice(existing.index, 1)
      // Clean up empty event arrays
      if (existingConfig.automations[existing.event]!.length === 0) {
        delete existingConfig.automations[existing.event]
      }
      overwrittenIds.add(id)
    }

    // Insert into the target event's matcher array
    if (!existingConfig.automations[entry.event]) {
      existingConfig.automations[entry.event] = []
    }
    existingConfig.automations[entry.event]!.push(matcher)
    result.imported.push(label)
  }

  // Validate the merged full config (schema + semantic: regex, cron, timezone, conditions)
  const mergedValidation = validateAutomationsConfig({
    version: existingConfig.version,
    automations: existingConfig.automations,
  })

  if (!mergedValidation.valid) {
    // Reject the entire import — merged config is invalid
    const errorMsg = `Merged automations config is invalid: ${mergedValidation.errors.join('; ')}`
    result.imported = []
    result.skipped = []
    for (const entry of entries) {
      result.failed.push({ id: automationLabel(entry), error: errorMsg })
    }
    return result
  }

  // Write atomically: temp file + rename
  try {
    const configObj = {
      version: existingConfig.version ?? 2,
      automations: existingConfig.automations,
    }
    const tmpPath = configPath + `.tmp-${randomUUID().slice(0, 8)}`
    writeFileSync(tmpPath, JSON.stringify(configObj, null, 2) + '\n', 'utf-8')
    renameSync(tmpPath, configPath)
  } catch (err) {
    const errorMsg = `Failed to write automations.json: ${err}`
    result.imported = []
    for (const entry of entries) {
      result.failed.push({ id: automationLabel(entry), error: errorMsg })
    }
    return result
  }

  // Selectively clear history + retry queue for overwritten matcher IDs
  if (overwrittenIds.size > 0) {
    const historyPath = join(workspaceRootPath, AUTOMATIONS_HISTORY_FILE)
    const retryPath = join(workspaceRootPath, AUTOMATIONS_RETRY_QUEUE_FILE)
    filterJsonlByMatcherIds(historyPath, overwrittenIds)
    filterJsonlByMatcherIds(retryPath, overwrittenIds)
    result.warnings.push(`Cleared history/retry entries for ${overwrittenIds.size} overwritten automation(s)`)
  }

  return result
}
