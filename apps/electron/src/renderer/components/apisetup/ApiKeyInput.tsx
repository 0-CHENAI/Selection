import { parseTokenCount, formatTokenInput } from './token-count-input'
import { MIN_CUSTOM_CONTEXT_WINDOW, MAX_CUSTOM_CONTEXT_WINDOW, MIN_CUSTOM_MAX_TOKENS, MAX_CUSTOM_MAX_TOKENS } from '@config/model-image-support'
import {
  CUSTOM_MODEL_FETCH_DEBOUNCE_MS,
  customEndpointModelsBlockSave,
  customModelFieldMode,
  selectionAfterAutoFetch,
} from '@config/custom-endpoint-models'
import { THINKING_LEVELS, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
/**
 * ApiKeyInput - Reusable API key entry form control
 *
 * Renders a password input for the API key, a preset selector for Base URL,
 * and an optional Model override field.
 *
 * Does NOT include layout wrappers or action buttons — the parent
 * controls placement via the form ID ("api-key-form") for submit binding.
 *
 * Used in: Onboarding CredentialsStep, Settings API dialog
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff, Loader2 } from "lucide-react"
import type { PiModelInfo } from "./tier-models"
import { PresetBrandMark } from "./PresetBrandMark"
import { buildPiApiKeyModels, piCatalogToRemoteModels } from "./pi-model-submission"
import {
  ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS,
  DEFAULT_ENDPOINT_PROVIDERS,
  OPENAI_COMPAT_CUSTOM_URL_PRESETS,
  getPresetForUrl,
  getPresetsForProvider,
  presetBrandSlug,
  sortNamedPresets,
  type Preset,
} from "./provider-presets"
import {
  buildCustomEndpointModelSubmission,
  resolveCustomEndpointPayload,
  shouldAutoProbeModelCatalog,
  showCustomFormatPicker,
  resolvePiAuthProviderForSubmit,
  resolvePresetStateForBaseUrlChange,
  type PresetKey,
} from "./submit-helpers"
import { RemoteModelsPicker } from "./RemoteModelsPicker"
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_PRESET,
  DEFAULT_MODEL_MAX_OUTPUT_PRESET,
  fetchOpenAiCompatibleModels,
  findRemoteModel,
  lookupRecordByModelId,
  parseSelectedModels,
  persistCustomContextWindow,
  persistCustomMaxTokens,
  isValidModelLimitCombination,
  resolveCatalogOrOverrideLimit,
  resolveModelLimitSource,
  resolveModelLimitsStatus,
  resolveRemoteModelSupportsImages,
  setHasModelId,
  toggleSelectedModel,
  type ModelLimitSource,
  type RemoteModel,
} from "./fetch-openai-models.ts"

import {
  DEFAULT_CUSTOM_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MAX_TOKENS,
  type CustomEndpointApi,
  type CustomEndpointConfig,
} from '@config/llm-connections'

export type ApiKeyStatus = 'idle' | 'validating' | 'success' | 'error'

export type { CustomEndpointApi }

export type SubmittedConnectionModel = string | {
  id: string
  name?: string
  shortName?: string
  supportedThinkingLevels?: Array<'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
  supportsImages?: boolean
  contextWindow?: number
  maxTokens?: number
}

export interface ApiKeySubmitData {
  apiKey: string
  baseUrl?: string
  connectionDefaultModel?: string
  models?: SubmittedConnectionModel[]
  piAuthProvider?: string
  modelSelectionMode?: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
  /** Custom endpoint protocol — set when user configures an arbitrary API endpoint */
  customEndpoint?: CustomEndpointConfig
  /** IAM credentials for Pi+Bedrock (piAuthProvider='amazon-bedrock') setup */
  iamCredentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
  /** AWS region for Pi+Bedrock */
  awsRegion?: string
  /** Bedrock authentication method — determines auth type for Pi+Bedrock connections */
  bedrockAuthMethod?: 'iam_credentials' | 'environment'
}

/** OAuth-based setup methods that can be reached from the endpoint dropdown. */
export type OAuthSetupMethod = 'pi_chatgpt_oauth' | 'pi_copilot_oauth' | 'pi_kimi_oauth'

/** Account sign-in providers shown in the endpoint dropdown's OAuth section. */
export const OAUTH_PROVIDER_OPTIONS: ReadonlyArray<{ method: OAuthSetupMethod; label: string }> = [
  { method: 'pi_chatgpt_oauth', label: 'ChatGPT Plus / Pro' },
  { method: 'pi_copilot_oauth', label: 'GitHub Copilot' },
  { method: 'pi_kimi_oauth', label: 'Kimi Code' },
]

export interface ApiKeyInputProps {
  /** Current validation status */
  status: ApiKeyStatus
  /** Error message to display when status is 'error' */
  errorMessage?: string
  /** Called when the form is submitted with the key and optional endpoint config */
  onSubmit: (data: ApiKeySubmitData) => void
  /** Form ID for external submit button binding (default: "api-key-form") */
  formId?: string
  /** Disable the input (e.g. during validation) */
  disabled?: boolean
  /** Provider type determines which presets and placeholders to show */
  providerType?: 'anthropic' | 'openai' | 'pi' | 'google' | 'pi_api_key'
  /** Limit the endpoint dropdown (ORDER onboarding: Anthropic / OpenAI compatible only) */
  presetFilter?: 'order'
  /**
   * When provided, the endpoint dropdown also lists account sign-in (OAuth)
   * providers. Selecting one hands control back to the parent so it can switch
   * to the matching OAuth flow instead of API-key entry.
   */
  onSelectOAuthMethod?: (method: OAuthSetupMethod) => void
  /** Pre-fill values when editing an existing connection */
  initialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    modelImageCaps?: Record<string, boolean>
    modelThinkingLevels?: Record<string, Array<'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>>
    modelContextWindows?: Record<string, number>
    modelMaxTokens?: Record<string, number>
    /** Pre-fill the protocol toggle for custom endpoints */
    customApi?: CustomEndpointApi
  }
}

const COMPAT_ANTHROPIC_DEFAULTS = 'claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5'
const COMPAT_OPENAI_DEFAULTS = 'openai/gpt-5.2-codex, openai/gpt-5.1-codex-mini'
const COMPAT_MINIMAX_DEFAULTS = 'MiniMax-M2.5, MiniMax-M2.5-highspeed'
const COMPAT_KIMI_DEFAULTS = 'k3, kimi-for-coding, kimi-for-coding-highspeed'

function parseModelList(value: string): string[] {
  return parseSelectedModels(value)
}

function ModelLimitSourceChip({ source }: { source: ModelLimitSource }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex h-4 items-center rounded-full px-1.5 text-[10px] font-medium',
        source === 'catalog' && 'bg-success/12 text-success',
        source === 'manual' && 'bg-foreground/10 text-foreground/75',
        source === 'default' && 'bg-foreground/5 text-foreground/40',
      )}
    >
      {t(`apiSetup.modelLimitSource.${source}`)}
    </span>
  )
}

function ModelLimitInput({ id, label, value, source, upperExclusive, invalid, disabled, onChange }: {
  id: string
  label: string
  value: number
  source: ModelLimitSource
  upperExclusive?: number
  invalid?: boolean
  disabled?: boolean
  onChange: (next: number) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(() => formatTokenInput(value))
  const lastEmitted = useRef(value)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (value !== lastEmitted.current) setDraft(formatTokenInput(value))
    lastEmitted.current = value
  }, [value])
  const parsed = parseTokenCount(draft)
  const minimum = upperExclusive ? MIN_CUSTOM_MAX_TOKENS : MIN_CUSTOM_CONTEXT_WINDOW
  const maximum = upperExclusive ? Math.min(upperExclusive - 1, MAX_CUSTOM_MAX_TOKENS) : MAX_CUSTOM_CONTEXT_WINDOW
  const valid = parsed !== undefined && parsed >= minimum && parsed <= maximum
  const error = t('apiSetup.tokenInputError', { min: minimum.toLocaleString(), max: maximum.toLocaleString() })
  useEffect(() => { inputRef.current?.setCustomValidity(valid ? '' : error) }, [valid, error])
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-muted-foreground font-normal text-xs">
        {label}<ModelLimitSourceChip source={source} />
      </Label>
      <input ref={inputRef} id={id} type="text" required value={draft} disabled={disabled}
        onInvalid={event => {
          let container = event.currentTarget.closest('details')
          while (container) { container.open = true; container = container.parentElement?.closest('details') ?? null }
        }}
        placeholder="128K" aria-invalid={!valid || invalid || undefined} aria-describedby={!valid ? `${id}-hint` : undefined}
        className={cn('h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring', !valid && 'border-destructive')}
        onChange={event => {
          const text = event.currentTarget.value
          setDraft(text)
          const next = parseTokenCount(text)
          const accepted = next !== undefined && next >= minimum && next <= maximum
          event.currentTarget.setCustomValidity(accepted ? '' : error)
          if (accepted) { lastEmitted.current = next; onChange(next) }
        }} />
      {!valid && <p id={`${id}-hint`} className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

// ============================================================
// Pi model tier selection (for providers with many models)
// ============================================================

export function ApiKeyInput({
  status,
  errorMessage,
  onSubmit,
  formId = "api-key-form",
  disabled,
  providerType = 'pi_api_key',
  presetFilter,
  onSelectOAuthMethod,
  initialValues,
}: ApiKeyInputProps) {
  // Get presets based on provider type
  const presets = getPresetsForProvider(providerType, presetFilter)
  const defaultPreset = presets[0]

  // Compute initial preset: explicit (Pi piAuthProvider), derived from URL, or default
  const initialPreset = initialValues?.activePreset
    ?? (initialValues?.baseUrl ? getPresetForUrl(initialValues.baseUrl, presets) : defaultPreset.key)

  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? '')
  const [showValue, setShowValue] = useState(!!initialValues?.apiKey)
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? defaultPreset.url)
  const [activePreset, setActivePreset] = useState<PresetKey>(initialPreset)
  const [lastNonCustomPreset, setLastNonCustomPreset] = useState<PresetKey | null>(
    initialPreset !== 'custom' ? initialPreset : defaultPreset.key
  )
  const [connectionDefaultModel, setConnectionDefaultModel] = useState(initialValues?.connectionDefaultModel ?? '')
  const [customApi, setCustomApi] = useState<CustomEndpointApi>(() => {
    if (initialValues?.customApi === 'anthropic-messages' || initialValues?.customApi === 'openai-completions') {
      return initialValues.customApi
    }
    return 'openai-completions'
  })
  const [modelError, setModelError] = useState<string | null>(null)

  // Bedrock auth state
  const [bedrockAuthMethod, setBedrockAuthMethod] = useState<'iam_credentials' | 'environment'>('iam_credentials')
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('')
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('')
  const [awsSessionToken, setAwsSessionToken] = useState('')
  const [awsRegion, setAwsRegion] = useState('us-east-1')

  const [piModels, setPiModels] = useState<PiModelInfo[]>([])
  const [piModelsLoading, setPiModelsLoading] = useState(false)
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([])
  const [remoteModelsLoading, setRemoteModelsLoading] = useState(false)
  const [remoteModelsError, setRemoteModelsError] = useState<string | null>(null)
  const [remoteModelsFailed, setRemoteModelsFailed] = useState(false)
  const [remoteModelsNonce, setRemoteModelsNonce] = useState(0)
  const remoteModelsAbortRef = useRef<AbortController | null>(null)
  const fetchModelsAbortRef = useRef<AbortController | null>(null)
  const fetchRequestSignatureRef = useRef('')
  const modelsEditedRef = useRef(false)
  const [modelsEdited, setModelsEdited] = useState(() => Boolean(initialValues?.connectionDefaultModel?.trim()))
  const [fetchModelsPhase, setFetchModelsPhase] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [modelFetchNonce, setModelFetchNonce] = useState(0)
  modelsEditedRef.current = modelsEdited
  const [modelImageCaps, setModelImageCaps] = useState<Record<string, boolean>>(
    () => ({ ...initialValues?.modelImageCaps }),
  )
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, ThinkingLevel[]>>(() => ({ ...initialValues?.modelThinkingLevels }))
  const [modelContextWindows, setModelContextWindows] = useState<Record<string, number>>(
    () => ({ ...initialValues?.modelContextWindows }),
  )
  const [modelMaxTokens, setModelMaxTokens] = useState<Record<string, number>>(
    () => ({ ...initialValues?.modelMaxTokens }),
  )
  const [editedContextIds, setEditedContextIds] = useState<Set<string>>(() => new Set())
  const [editedMaxTokenIds, setEditedMaxTokenIds] = useState<Set<string>>(() => new Set())
  const [limitError, setLimitError] = useState<string | null>(null)

  const isDisabled = disabled || status === 'validating'

  const isPiApiKeyFlow = providerType === 'pi_api_key'
  const isOrderPreset = activePreset === 'order-openai'
  const isCustomEndpointForm = (
    activePreset === 'custom' || OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(activePreset)
  ) && !!baseUrl.trim()
  const isBedrock = activePreset === 'amazon-bedrock'
  // Hide endpoint/model fields for providers with well-known endpoints handled by the SDK
  const isDefaultProviderPreset = DEFAULT_ENDPOINT_PROVIDERS.has(activePreset)

  // Provider-specific placeholders from the active preset
  const activePresetObj = presets.find(p => p.key === activePreset)
  const apiKeyPlaceholder =
    activePreset === 'order-openai'
      ? t('apiSetup.pasteOrderKey')
      : (activePresetObj?.placeholder && !activePresetObj.placeholder.toLowerCase().startsWith('paste')
        ? activePresetObj.placeholder
        : providerType === 'google' ? 'AIza...'
        : providerType === 'pi' ? 'pi-...'
        : providerType === 'openai' ? 'sk-...'
        : t('apiSetup.pasteKey'))

  const presetDisplayLabel = (preset: Preset) => {
    if (preset.key === 'order-openai') {
      return presetFilter === 'order'
        ? t('apiSetup.format.openaiCompatible')
        : t('apiSetup.preset.orderOpenai')
    }
    if (preset.key === 'custom') return t('apiSetup.preset.custom')
    return preset.label
  }

  const sortedPresets = useMemo(
    () => sortNamedPresets(presets.map((preset) => ({ ...preset, label: presetDisplayLabel(preset) }))),
    // presetDisplayLabel closes over the active locale via t().
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presets, presetFilter, t],
  )
  const oauthOptions = useMemo(
    () => sortNamedPresets(OAUTH_PROVIDER_OPTIONS.map((option) => ({ ...option, key: option.method }))),
    [],
  )

  const loadPiModels = useCallback(async (provider: string) => {
    if (
      !isPiApiKeyFlow
      || !provider
      || provider === 'custom'
      || DEFAULT_ENDPOINT_PROVIDERS.has(provider)
      || OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(provider)
      || ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS.has(provider)
    ) {
      setPiModels([])
      return
    }
    setPiModelsLoading(true)
    try {
      const result = await window.electronAPI.getPiProviderModels(provider)
      setPiModels(result.models)
    } catch (err) {
      console.error('[ApiKeyInput] Failed to load models for', provider, err)
      setPiModels([])
    } finally {
      setPiModelsLoading(false)
    }
  }, [isPiApiKeyFlow])

  useEffect(() => {
    loadPiModels(activePreset)
  }, [activePreset, loadPiModels])

  // Branded OpenAI presets still read /v1/models after the key is pasted.
  // Custom endpoints use the debounced server fetch below.
  useEffect(() => {
    if (activePreset === 'custom') return

    if (!isCustomEndpointForm || !shouldAutoProbeModelCatalog(activePreset, customApi)) {
      remoteModelsAbortRef.current?.abort()
      setRemoteModels([])
      setRemoteModelsError(null)
      setRemoteModelsFailed(false)
      setRemoteModelsLoading(false)
      setFetchModelsPhase('idle')
      return
    }

    const key = apiKey.trim()
    const endpoint = baseUrl.trim()
    if (key.length < 8 || !endpoint) {
      remoteModelsAbortRef.current?.abort()
      setRemoteModels([])
      setRemoteModelsError(null)
      setRemoteModelsFailed(false)
      setRemoteModelsLoading(false)
      return
    }

    const controller = new AbortController()
    remoteModelsAbortRef.current?.abort()
    remoteModelsAbortRef.current = controller
    setRemoteModelsLoading(true)
    setRemoteModelsError(null)
    setRemoteModelsFailed(false)

    const timer = setTimeout(() => {
      fetchOpenAiCompatibleModels(endpoint, key, controller.signal)
        .then((models) => {
          if (controller.signal.aborted) return
          setRemoteModels(piCatalogToRemoteModels(models))
          setRemoteModelsFailed(false)
          setRemoteModelsError(isOrderPreset && models.length === 0 ? t('apiSetup.noModels') : null)
          setModelImageCaps((prev) => {
            const next = { ...prev }
            for (const model of models) {
              if (next[model.id] === undefined && typeof model.supportsImages === 'boolean') {
                next[model.id] = model.supportsImages
              }
            }
            return next
          })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          console.error('[ApiKeyInput] /v1/models failed', err)
          setRemoteModels([])
          setRemoteModelsFailed(true)
          // Custom URLs often lack this route — keep defaults editable instead of blocking.
          setRemoteModelsError(isOrderPreset ? t('apiSetup.fetchModelsFailed') : null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setRemoteModelsLoading(false)
        })
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [activePreset, isCustomEndpointForm, customApi, isOrderPreset, apiKey, baseUrl, remoteModelsNonce, t])

  const usesPiModelPicker = isPiApiKeyFlow
    && !isDefaultProviderPreset
    && activePreset !== 'custom'
    && !isBedrock
    && !OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(activePreset)
    && !ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS.has(activePreset)
  const piRemoteModels = useMemo(() => piCatalogToRemoteModels(piModels), [piModels])

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key !== 'custom') {
      setLastNonCustomPreset(preset.key)
    }
    if (preset.key === 'custom') {
      setBaseUrl('')
      setModelsEdited(false)
      setConnectionDefaultModel('')
      setRemoteModels([])
      setRemoteModelsError(null)
      setRemoteModelsFailed(false)
      setFetchModelsPhase('idle')
      fetchRequestSignatureRef.current = ''
    } else {
      setBaseUrl(preset.url)
    }
    // Pin protocol for branded ORDER / Manifest-style gateways
    if (OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(preset.key) || preset.key === 'custom') {
      setCustomApi('openai-completions')
    }
    setModelError(null)
    setLimitError(null)
    // Pre-fill recommended model for Ollama; clear for all others
    // (Default provider presets hide the field entirely, others default to provider model IDs when empty)
    if (preset.key === 'ollama') {
      setConnectionDefaultModel('qwen3-coder')
    } else if (preset.key === 'openrouter' || preset.key === 'vercel-ai-gateway') {
      setConnectionDefaultModel(providerType === 'openai' ? COMPAT_OPENAI_DEFAULTS : COMPAT_ANTHROPIC_DEFAULTS)
    } else if (preset.key === 'minimax-global' || preset.key === 'minimax-cn') {
      setConnectionDefaultModel(COMPAT_MINIMAX_DEFAULTS)
    } else if (preset.key === 'kimi-coding') {
      setConnectionDefaultModel(COMPAT_KIMI_DEFAULTS)
    } else if (preset.key === 'manifest') {
      setConnectionDefaultModel('auto')
    } else if (preset.key === 'order-openai') {
      // Same hint for both ORDER endpoints — user fills Opus / Laufry / Maylo etc.
      setConnectionDefaultModel('')
    } else if (preset.key === 'custom') {
      setConnectionDefaultModel('')
    } else if (
      OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(preset.key)
      || ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS.has(preset.key)
    ) {
      setConnectionDefaultModel(
        OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(preset.key) || providerType === 'openai'
          ? COMPAT_OPENAI_DEFAULTS
          : COMPAT_ANTHROPIC_DEFAULTS,
      )
    } else {
      setConnectionDefaultModel('')
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    const presetKey = getPresetForUrl(value, presets)
    const currentPresetObj = presets.find(p => p.key === activePreset)
    const nextPresetState = resolvePresetStateForBaseUrlChange({
      matchedPreset: presetKey,
      activePreset,
      activePresetHasEmptyUrl: currentPresetObj?.url === '',
      lastNonCustomPreset,
    })
    setActivePreset(nextPresetState.activePreset)
    setLastNonCustomPreset(nextPresetState.lastNonCustomPreset)
    setModelError(null)
    if (!connectionDefaultModel.trim()) {
      if (presetKey === 'ollama') {
        setConnectionDefaultModel('qwen3-coder')
      } else if (presetKey === 'manifest') {
        setConnectionDefaultModel('auto')
      } else if (presetKey === 'minimax-global' || presetKey === 'minimax-cn') {
        setConnectionDefaultModel(COMPAT_MINIMAX_DEFAULTS)
      } else if (presetKey === 'kimi-coding') {
        setConnectionDefaultModel(COMPAT_KIMI_DEFAULTS)
      } else if (presetKey === 'openrouter' || presetKey === 'vercel-ai-gateway') {
        setConnectionDefaultModel(providerType === 'openai' ? COMPAT_OPENAI_DEFAULTS : COMPAT_ANTHROPIC_DEFAULTS)
      }
    }
  }

  const handleFetchModels = useCallback(async (controller: AbortController) => {
    const endpoint = baseUrl.trim()
    const key = apiKey.trim()
    if (!endpoint || !key) return
    const signature = `${customApi}|${endpoint}|${key}`
    fetchRequestSignatureRef.current = signature
    setFetchModelsPhase('loading')
    setRemoteModelsError(null)
    setRemoteModelsFailed(false)
    setRemoteModelsLoading(true)
    try {
      const fetchModels = window.electronAPI?.fetchCustomEndpointModels
      if (!fetchModels) {
        if (controller.signal.aborted || fetchRequestSignatureRef.current !== signature) return
        setFetchModelsPhase('error')
        setRemoteModelsFailed(true)
        setRemoteModels([])
        return
      }
      const result = await fetchModels({ baseUrl: endpoint, apiKey: key, api: customApi })
      if (controller.signal.aborted || fetchRequestSignatureRef.current !== signature) return
      if (!result.ok) {
        setFetchModelsPhase('error')
        setRemoteModelsFailed(true)
        setRemoteModels([])
        return
      }
      const models = piCatalogToRemoteModels(result.models)
      setRemoteModels(models)
      setRemoteModelsFailed(false)
      if (models.length === 0) {
        setFetchModelsPhase('empty')
        return
      }
      setConnectionDefaultModel((prev) => selectionAfterAutoFetch({
        current: prev,
        fetchedIds: models.map((model) => model.id),
        preserveExisting: modelsEditedRef.current,
      }))
      setModelImageCaps((prev) => {
        const next = { ...prev }
        for (const model of models) {
          if (next[model.id] === undefined && typeof model.supportsImages === 'boolean') {
            next[model.id] = model.supportsImages
          }
        }
        return next
      })
      setModelError(null)
      setFetchModelsPhase('ready')
    } catch {
      if (controller.signal.aborted || fetchRequestSignatureRef.current !== signature) return
      setFetchModelsPhase('error')
      setRemoteModelsFailed(true)
      setRemoteModels([])
    } finally {
      if (!controller.signal.aborted && fetchRequestSignatureRef.current === signature) {
        setRemoteModelsLoading(false)
      }
    }
  }, [apiKey, baseUrl, customApi])

  useEffect(() => {
    if (activePreset !== 'custom') return
    const endpoint = baseUrl.trim()
    const key = apiKey.trim()
    if (!endpoint || !key) {
      fetchModelsAbortRef.current?.abort()
      fetchRequestSignatureRef.current = ''
      setFetchModelsPhase('idle')
      setRemoteModelsLoading(false)
      setRemoteModels([])
      setRemoteModelsFailed(false)
      setRemoteModelsError(null)
      if (!modelsEditedRef.current) setConnectionDefaultModel('')
      return
    }
    setFetchModelsPhase('loading')
    setRemoteModels([])
    setRemoteModelsFailed(false)
    setRemoteModelsError(null)
    if (!modelsEditedRef.current) setConnectionDefaultModel('')
    const controller = new AbortController()
    fetchModelsAbortRef.current?.abort()
    fetchModelsAbortRef.current = controller
    const timer = setTimeout(() => {
      void handleFetchModels(controller)
    }, CUSTOM_MODEL_FETCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [activePreset, apiKey, baseUrl, customApi, handleFetchModels, modelFetchNonce])

  const resolveEditableLimits = (id: string) => {
    const remote = findRemoteModel(remoteModels, id)
    const contextOverride = lookupRecordByModelId(modelContextWindows, id)
      ?? lookupRecordByModelId(initialValues?.modelContextWindows, id)
    const maxOverride = lookupRecordByModelId(modelMaxTokens, id)
      ?? lookupRecordByModelId(initialValues?.modelMaxTokens, id)
    const contextWindow = resolveCatalogOrOverrideLimit({
      edited: setHasModelId(editedContextIds, id),
      override: contextOverride,
      catalog: remote?.contextWindow,
      fallback: DEFAULT_MODEL_CONTEXT_WINDOW_PRESET,
      fallbackAliases: [DEFAULT_CUSTOM_CONTEXT_WINDOW],
    })
    const maxTokens = resolveCatalogOrOverrideLimit({
      edited: setHasModelId(editedMaxTokenIds, id),
      override: maxOverride,
      catalog: remote?.maxTokens,
      fallback: DEFAULT_MODEL_MAX_OUTPUT_PRESET,
      fallbackAliases: [DEFAULT_CUSTOM_MAX_TOKENS],
    })
    return {
      remote,
      contextWindow,
      maxTokens,
      contextSource: resolveModelLimitSource({
        edited: setHasModelId(editedContextIds, id),
        override: contextOverride,
        catalog: remote?.contextWindow,
        displayed: contextWindow,
        fallback: DEFAULT_MODEL_CONTEXT_WINDOW_PRESET,
        fallbackAliases: [DEFAULT_CUSTOM_CONTEXT_WINDOW],
      }),
      maxSource: resolveModelLimitSource({
        edited: setHasModelId(editedMaxTokenIds, id),
        override: maxOverride,
        catalog: remote?.maxTokens,
        displayed: maxTokens,
        fallback: DEFAULT_MODEL_MAX_OUTPUT_PRESET,
        fallbackAliases: [DEFAULT_CUSTOM_MAX_TOKENS],
      }),
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const effectivePiAuthProvider = isPiApiKeyFlow
      ? resolvePiAuthProviderForSubmit(activePreset, lastNonCustomPreset)
      : undefined

    // Pi API key providers: the checked catalog models are the enabled set.
    // The first checked id is the default. Summaries still prefer a
    // mini/flash/haiku model inside that set.
    if (usesPiModelPicker && piModels.length > 0) {
      const selected = parseModelList(connectionDefaultModel)
      if (selected.length === 0) {
        setModelError(t('apiSetup.defaultModelRequired'))
        return
      }
      onSubmit({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        connectionDefaultModel: selected[0],
        models: buildPiApiKeyModels(selected, piModels, {
          contextWindows: modelContextWindows,
          maxTokens: modelMaxTokens,
        }),
        piAuthProvider: effectivePiAuthProvider,
        modelSelectionMode: 'userDefined3Tier',
      })
      return
    }

    // Bedrock — routes through Pi SDK with piAuthProvider='amazon-bedrock'.
    // Submit with auth method and optional IAM credentials.
    if (isBedrock) {
      if (bedrockAuthMethod === 'iam_credentials' && !awsAccessKeyId.trim()) {
        setModelError(t('apiSetup.accessKeyRequired'))
        return
      }
      if (bedrockAuthMethod === 'iam_credentials' && !awsSecretAccessKey.trim()) {
        setModelError(t('apiSetup.secretKeyRequired'))
        return
      }
      const parsedModels = parseModelList(connectionDefaultModel)
      onSubmit({
        apiKey: '',
        piAuthProvider: effectivePiAuthProvider,
        bedrockAuthMethod,
        awsRegion: awsRegion.trim() || 'us-east-1',
        ...(bedrockAuthMethod === 'iam_credentials' ? {
          iamCredentials: {
            accessKeyId: awsAccessKeyId.trim(),
            secretAccessKey: awsSecretAccessKey.trim(),
            ...(awsSessionToken.trim() ? { sessionToken: awsSessionToken.trim() } : {}),
          },
        } : {}),
        connectionDefaultModel: parsedModels[0],
        models: parsedModels.length > 0 ? parsedModels : undefined,
      })
      return
    }

    const effectiveBaseUrl = baseUrl.trim()

    const parsedModels = parseModelList(connectionDefaultModel)
    if (selectedLimitRows.some((row) => (
      !isValidModelLimitCombination(row.maxTokens, row.contextWindow)
    ))) {
      setLimitError(t('apiSetup.modelLimitInvalid'))
      return
    }
    const submittedModels = (isCustomEndpointForm && parsedModels.length > 0)
      ? parsedModels.map((id) => {
        const { remote, contextWindow: rawContextWindow, maxTokens: rawMaxTokens } = resolveEditableLimits(id)
        const contextWindow = persistCustomContextWindow(rawContextWindow)
        const maxTokens = persistCustomMaxTokens(rawMaxTokens, contextWindow)
        const supportsImages = resolveRemoteModelSupportsImages(
          remote ?? { id, name: id },
          lookupRecordByModelId(modelImageCaps, id),
        )
        return buildCustomEndpointModelSubmission({
          id,
          name: remote?.name,
          includeDisplayNames: isOrderPreset,
          supportsImages,
          supportedThinkingLevels: modelThinkingLevels[id] ?? (initialValues ? undefined : []),
          contextWindow,
          maxTokens,
        })
      })
      : parsedModels

    const isUsingDefaultEndpoint = isDefaultProviderPreset || !effectiveBaseUrl
    const requiresModel = !isDefaultProviderPreset && !!effectiveBaseUrl
    if (activePreset === 'custom' && effectiveBaseUrl) {
      const block = customEndpointModelsBlockSave({
        hasSelection: parsedModels.length > 0,
        phase: fetchModelsPhase,
      })
      if (block === 'pending') {
        setModelError(t('apiSetup.modelsAwaitingFetch'))
        return
      }
      if (block === 'missing') {
        setModelError(t('apiSetup.defaultModelRequired'))
        return
      }
    } else if (requiresModel && parsedModels.length === 0) {
      setModelError(t('apiSetup.defaultModelRequired'))
      return
    }

    // Include custom endpoint protocol when user configured a custom base URL.
    // Branded openai-compat presets (e.g. Manifest) are pinned to openai-completions
    // and routed via the Pi SDK's openai adapter.
    const { customEndpoint, piAuthProvider: resolvedPiAuthProvider } = resolveCustomEndpointPayload({
      activePreset,
      baseUrl: effectiveBaseUrl,
      customApi,
      brandedOpenAiCompatPresets: OPENAI_COMPAT_CUSTOM_URL_PRESETS,
      brandedAnthropicCompatPresets: ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS,
      fallbackPiAuthProvider: effectivePiAuthProvider,
    })

    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: isUsingDefaultEndpoint ? undefined : effectiveBaseUrl,
      connectionDefaultModel: parsedModels[0],
      models: submittedModels.length > 0 ? submittedModels : undefined,
      piAuthProvider: resolvedPiAuthProvider,
      modelSelectionMode: isPiApiKeyFlow
        ? (parsedModels.length > 0 ? 'userDefined3Tier' : 'automaticallySyncedFromProvider')
        : (isOrderPreset && parsedModels.length > 0 ? 'userDefined3Tier' : undefined),
      customEndpoint,
    })
  }

  const selectedCustomModelIds = parseModelList(connectionDefaultModel)
  const showCustomModelLimits = isCustomEndpointForm
    && !isBedrock
    && selectedCustomModelIds.length > 0
  const selectedLimitRows = showCustomModelLimits
    ? selectedCustomModelIds.map((id) => ({ id, ...resolveEditableLimits(id) }))
    : []
  const limitsStatusKey = {
    detecting: 'apiSetup.modelLimitsDetecting',
    detected: 'apiSetup.modelLimitsDetected',
    unavailable: 'apiSetup.modelLimitsUnavailable',
    defaults: 'apiSetup.modelLimitsUsingDefaults',
    hint: 'apiSetup.modelLimitsHint',
  }[resolveModelLimitsStatus({
    loading: remoteModelsLoading,
    catalogFilled: selectedLimitRows.some((row) => (
      row.contextSource === 'catalog' || row.maxSource === 'catalog'
    )),
    fetchFailed: remoteModelsFailed,
    hasKey: apiKey.trim().length >= 8,
  })]

  const activePresetForMenu = sortedPresets.find(preset => preset.key === activePreset) ?? sortedPresets[0]

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* API Key — hidden for Bedrock (uses IAM/Environment auth) */}
      {!isBedrock && (<div className="space-y-2">
        <Label htmlFor="api-key">{t('apiSetup.apiKey')}</Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="api-key"
            type={showValue ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyPlaceholder}
            className={cn(
              "pr-10 border-0 bg-transparent shadow-none",
              status === 'error' && "focus-visible:ring-destructive"
            )}
            disabled={isDisabled}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowValue(!showValue)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showValue ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>)}

      {presetFilter !== 'order' && presets.length > 1 && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="base-url">{t('apiSetup.endpoint')}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className="flex h-6 items-center gap-1.5 rounded-[6px] bg-background shadow-minimal pl-1.5 pr-2 text-[12px] font-medium text-foreground/50 hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {activePresetForMenu && (
                <PresetBrandMark
                  slug={presetBrandSlug(activePresetForMenu.key)}
                  label={activePresetForMenu.label}
                />
              )}
              <span className="truncate">{activePresetForMenu?.label}</span>
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu">
              {sortedPresets.map((preset) => (
                <StyledDropdownMenuItem
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset)}
                  className="justify-between"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <PresetBrandMark slug={presetBrandSlug(preset.key)} label={preset.label} />
                    <span className="truncate">{preset.label}</span>
                  </span>
                  <Check className={cn("size-3", activePreset === preset.key ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
              {onSelectOAuthMethod && (
                <>
                  <StyledDropdownMenuSeparator />
                  <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
                    {t('apiSetup.oauthSignIn')}
                  </div>
                  {oauthOptions.map((option) => (
                    <StyledDropdownMenuItem
                      key={option.method}
                      onClick={() => onSelectOAuthMethod(option.method)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <PresetBrandMark slug={presetBrandSlug(option.method)} label={option.label} />
                        <span className="truncate">{option.label}</span>
                      </span>
                    </StyledDropdownMenuItem>
                  ))}
                </>
              )}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Base URL input - hidden for default provider presets (Anthropic/OpenAI) and Bedrock */}
        {!isDefaultProviderPreset && !isBedrock && (
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background"
          )}>
            <Input
              id="base-url"
              type="text"
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder={t('apiSetup.endpointPlaceholder')}
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
        )}
        {showCustomFormatPicker(activePreset) && (
          <div className="space-y-1.5">
            <Label>{t('apiSetup.protocol')}</Label>
            <div className={cn(
              "flex rounded-md shadow-minimal overflow-hidden bg-foreground-2",
              isDisabled && "opacity-50 pointer-events-none",
            )}>
              {([
                { value: 'openai-completions' as const, label: t('apiSetup.format.openaiCompatible') },
                { value: 'anthropic-messages' as const, label: t('apiSetup.format.anthropicCompatible') },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  disabled={isDisabled}
                  aria-pressed={customApi === value}
                  onClick={() => setCustomApi(value)}
                  className={cn(
                    "flex-1 py-1.5 text-[12px] font-medium transition-colors",
                    customApi === value
                      ? "bg-background text-foreground shadow-minimal"
                      : "text-foreground/50 hover:text-foreground/70",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">{t('apiSetup.protocolHint')}</p>
          </div>
        )}
      </div>
      )}

      {/* Bedrock Auth Section */}
      {isBedrock && (
        <>
          {/* Auth Method Toggle */}
          <div className="space-y-2">
            <Label>{t('apiSetup.authentication')}</Label>
            <div className={cn(
              "flex rounded-md shadow-minimal overflow-hidden",
              "bg-foreground-2",
              isDisabled && "opacity-50 pointer-events-none"
            )}>
              {([
                { value: 'iam_credentials' as const, label: t('apiSetup.credentials.iam') },
                { value: 'environment' as const, label: t('apiSetup.credentials.environment') },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setBedrockAuthMethod(value)}
                  className={cn(
                    "flex-1 py-1.5 text-[12px] font-medium transition-colors",
                    bedrockAuthMethod === value
                      ? "bg-background text-foreground shadow-minimal"
                      : "text-foreground/50 hover:text-foreground/70"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* IAM Credential Fields */}
          {bedrockAuthMethod === 'iam_credentials' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="aws-access-key-id" className="text-muted-foreground font-normal text-xs">
                  {t('apiSetup.accessKeyId')}
                </Label>
                <div className={cn("rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
                  <Input
                    id="aws-access-key-id"
                    type="text"
                    value={awsAccessKeyId}
                    onChange={(e) => setAwsAccessKeyId(e.target.value)}
                    placeholder="AKIA..."
                    className="border-0 bg-transparent shadow-none"
                    disabled={isDisabled}
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aws-secret-key" className="text-muted-foreground font-normal text-xs">
                  {t('apiSetup.secretAccessKeyLabel')}
                </Label>
                <div className={cn("relative rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
                  <Input
                    id="aws-secret-key"
                    type={showValue ? 'text' : 'password'}
                    value={awsSecretAccessKey}
                    onChange={(e) => setAwsSecretAccessKey(e.target.value)}
                    placeholder={t("apiSetup.secretAccessKey")}
                    className="pr-10 border-0 bg-transparent shadow-none"
                    disabled={isDisabled}
                  />
                  <button
                    type="button"
                    onClick={() => setShowValue(!showValue)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showValue ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aws-session-token" className="text-muted-foreground font-normal text-xs">
                  {t('apiSetup.sessionToken')} <span className="text-foreground/30">· {t('common.optional')}</span>
                </Label>
                <div className={cn("rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
                  <Input
                    id="aws-session-token"
                    type="text"
                    value={awsSessionToken}
                    onChange={(e) => setAwsSessionToken(e.target.value)}
                    placeholder={t("apiSetup.temporaryCredentials")}
                    className="border-0 bg-transparent shadow-none"
                    disabled={isDisabled}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Environment info */}
          {bedrockAuthMethod === 'environment' && (
            <div className="rounded-md bg-foreground-2 p-3">
              <p className="text-xs text-foreground/50">
                {t('apiSetup.awsEnvHint')}
              </p>
            </div>
          )}

          {/* AWS Region */}
          <div className="space-y-1.5">
            <Label htmlFor="aws-region" className="text-muted-foreground font-normal text-xs">
              {t('apiSetup.awsRegion')}
            </Label>
            <div className={cn("rounded-md shadow-minimal transition-colors", "bg-foreground-2 focus-within:bg-background")}>
              <Input
                id="aws-region"
                type="text"
                value={awsRegion}
                onChange={(e) => setAwsRegion(e.target.value)}
                placeholder="us-east-1"
                className="border-0 bg-transparent shadow-none"
                disabled={isDisabled}
              />
            </div>
          </div>
        </>
      )}

      {/* Model selection — same multi-select as the OAuth / catalog picker */}
      {usesPiModelPicker && (piModelsLoading || piModels.length > 0) ? (
        <div className="space-y-2">
          <RemoteModelsPicker
            models={piRemoteModels}
            value={connectionDefaultModel}
            loading={piModelsLoading}
            disabled={isDisabled}
            error={modelError}
            hint={t('apiSetup.modelListHint')}
            onToggle={(id) => {
              setConnectionDefaultModel((prev) => toggleSelectedModel(prev, id))
              setModelError(null)
              setLimitError(null)
            }}
          />
        </div>
      ) : isOrderPreset && (remoteModelsLoading || remoteModels.length > 0 || apiKey.trim().length < 8) ? (
        <RemoteModelsPicker
          models={remoteModels}
          value={connectionDefaultModel}
          loading={remoteModelsLoading}
          disabled={isDisabled}
          error={remoteModelsError}
          hint={t('apiSetup.orderModelHint')}
          waitingForKey={apiKey.trim().length < 8}
          onToggle={(id) => {
            setConnectionDefaultModel((prev) => toggleSelectedModel(prev, id))
            setModelError(null)
            setLimitError(null)
          }}
          onRetry={() => setRemoteModelsNonce((n) => n + 1)}
        />
      ) : !isDefaultProviderPreset && showCustomFormatPicker(activePreset) ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-muted-foreground font-normal">
              {t('apiSetup.defaultModel')}{' '}
              <span className="text-foreground/30">· {baseUrl.trim() ? t('apiSetup.required') : t('common.optional')}</span>
            </Label>
            <button
              type="button"
              onClick={() => setModelFetchNonce((n) => n + 1)}
              disabled={isDisabled || fetchModelsPhase === 'loading' || !baseUrl.trim() || !apiKey.trim()}
              aria-busy={fetchModelsPhase === 'loading'}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] bg-background px-2.5 text-[12px] font-medium text-foreground shadow-minimal",
                "hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              {fetchModelsPhase === 'loading' && <Loader2 className="size-3 animate-spin" />}
              {fetchModelsPhase === 'loading' ? t('apiSetup.fetchingModels') : t('apiSetup.refetchModels')}
            </button>
          </div>
          {customModelFieldMode(fetchModelsPhase, remoteModels.length) === 'picker' ? (
            <RemoteModelsPicker
              hideLabel
              models={remoteModels}
              value={connectionDefaultModel}
              loading={false}
              disabled={isDisabled}
              hint={`${t('apiSetup.fetchModelsReady', { count: remoteModels.length })} ${t('apiSetup.modelListHint')}`}
              onToggle={(id) => {
                setModelsEdited(true)
                setConnectionDefaultModel((prev) => toggleSelectedModel(prev, id))
                setModelError(null)
                setLimitError(null)
              }}
            />
          ) : customModelFieldMode(fetchModelsPhase, remoteModels.length) === 'manual' ? (
            <>
              <div className={cn(
                "rounded-md shadow-minimal transition-colors",
                "bg-foreground-2 focus-within:bg-background",
                modelError && "ring-1 ring-destructive/40"
              )}>
                <Input
                  id="connection-default-model"
                  type="text"
                  value={connectionDefaultModel}
                  onChange={(e) => {
                    setConnectionDefaultModel(e.target.value)
                    setModelsEdited(true)
                    setModelError(null)
                    setLimitError(null)
                  }}
                  placeholder={t('apiSetup.modelListPlaceholder')}
                  className="border-0 bg-transparent shadow-none"
                  disabled={isDisabled}
                />
              </div>
              <p className={cn(
                "text-xs",
                fetchModelsPhase === 'error' ? "text-destructive" : "text-muted-foreground",
              )}>
                {fetchModelsPhase === 'error' ? t('apiSetup.fetchModelsUnavailable') : t('apiSetup.fetchModelsEmpty')}
              </p>
              <p className="text-xs text-foreground/30">{t('apiSetup.modelListHint')}</p>
            </>
          ) : (
            <div className="flex min-h-9 items-center gap-2 rounded-md bg-foreground-2 px-3 text-muted-foreground shadow-minimal">
              {fetchModelsPhase === 'loading' && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
              <span className="text-xs">
                {fetchModelsPhase === 'loading'
                  ? t('apiSetup.fetchingModels')
                  : t('apiSetup.modelsAwaitingFetch')}
              </span>
            </div>
          )}
          {connectionDefaultModel.trim() && customModelFieldMode(fetchModelsPhase, remoteModels.length) === 'pending' && (
            <p className="text-xs text-foreground/70">{connectionDefaultModel}</p>
          )}
          {modelError && (
            <p className="text-xs text-destructive">{modelError}</p>
          )}
        </div>
      ) : !isDefaultProviderPreset && (
        <div className="space-y-2">
          <Label htmlFor="connection-default-model" className="text-muted-foreground font-normal">
            {t('apiSetup.defaultModel')}{' '}
            <span className="text-foreground/30">
              · {!isBedrock && baseUrl.trim() ? t('apiSetup.required') : t('common.optional')}
            </span>
          </Label>
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background",
            modelError && "ring-1 ring-destructive/40"
          )}>
            <Input
              id="connection-default-model"
              type="text"
              value={connectionDefaultModel}
              onChange={(e) => {
                setConnectionDefaultModel(e.target.value)
                setModelsEdited(true)
                setModelError(null)
                setLimitError(null)
              }}
              placeholder={
                activePreset === 'order-openai'
                  ? t('apiSetup.modelListPlaceholderOrder')
                  : t('apiSetup.modelListPlaceholder')
              }
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
          {modelError && (
            <p className="text-xs text-destructive">{modelError}</p>
          )}
          <p className="text-xs text-foreground/30">
            {t('apiSetup.modelListHint')}
          </p>
          {!activePreset && (
            <p className="text-xs text-foreground/30">
              {t('apiSetup.customEndpointRequired')}
            </p>
          )}
        </div>
      )}

      {showCustomModelLimits && (
        <div className="space-y-5">
          <div className="space-y-1">
            <Label className="text-muted-foreground font-normal">
              {t('apiSetup.modelLimitsTitle')}
            </Label>
            <p className="flex items-center gap-1.5 text-xs text-foreground/40">
              {remoteModelsLoading && (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              )}
              <span>{t(limitsStatusKey)}</span>
            </p>
          </div>
          {selectedLimitRows.map(({ id, remote, contextWindow, maxTokens, contextSource, maxSource }) => {
            const supportsImages = resolveRemoteModelSupportsImages(
              remote ?? { id, name: id },
              lookupRecordByModelId(modelImageCaps, id),
            )
            const limitsInvalid = !isValidModelLimitCombination(maxTokens, contextWindow)
            return (
              <section key={id} className="rounded-xl border border-border bg-background p-4">
                <header className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="min-w-0 truncate text-sm font-semibold" title={remote?.name ?? id}>{remote?.name ?? id}</h3>
                  <div className="flex shrink-0 items-center gap-2">
                    <Label htmlFor={`multimodal-${id}`} className="text-xs font-normal text-muted-foreground">{t('apiSetup.multimodal')}</Label>
                    <Switch id={`multimodal-${id}`} checked={supportsImages} disabled={isDisabled}
                      onCheckedChange={checked => setModelImageCaps(prev => ({ ...prev, [id]: checked }))}
                      aria-label={`${remote?.name ?? id}: ${t('apiSetup.multimodal')}`} />
                  </div>
                </header>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ModelLimitInput
                      id={`context-window-${id}`}
                      label={t('apiSetup.contextWindow')}
                      value={contextWindow}
                      source={contextSource}
                      disabled={isDisabled}
                      onChange={(next) => {
                        setEditedContextIds((prev) => new Set(prev).add(id))
                        setModelContextWindows((prev) => ({ ...prev, [id]: next }))
                        // Do not mutate output capacity while the user is typing
                        // a context limit. Validate both fields on submission.
                        setLimitError(null)
                      }}
                    />
                    <ModelLimitInput
                      id={`max-tokens-${id}`}
                      label={t('apiSetup.maxOutputTokens')}
                      value={maxTokens}
                      source={maxSource}
                      upperExclusive={contextWindow}
                      invalid={limitsInvalid}
                      disabled={isDisabled}
                      onChange={(next) => {
                        setEditedMaxTokenIds((prev) => new Set(prev).add(id))
                        setModelMaxTokens((prev) => ({ ...prev, [id]: next }))
                        setLimitError(null)
                      }}
                    />
                </div>
                <details className="group/advanced mt-4 border-t border-border pt-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span>{t('apiSetup.advancedModelSettings')}</span>
                    <ChevronDown className="size-3.5 transition-transform group-open/advanced:rotate-180" />
                  </summary>
                  <div className="space-y-4 pt-4">

                  <fieldset className="space-y-2" disabled={isDisabled}>
                    <legend className="text-xs">{t('apiSetup.supportedThinkingLevels')}</legend>
                    <p className="text-xs text-muted-foreground">{t(initialValues && modelThinkingLevels[id] === undefined ? 'apiSetup.thinkingLevelsUnchangedHint' : 'apiSetup.supportedThinkingLevelsHint')}</p>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {THINKING_LEVELS.map(level => <label key={level.id} className={cn("relative flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors focus-within:ring-2 focus-within:ring-ring", modelThinkingLevels[id]?.includes(level.id) ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-foreground/5")}>
                        <input type="checkbox" className="sr-only" checked={modelThinkingLevels[id]?.includes(level.id) ?? false}
                          onChange={e => setModelThinkingLevels(prev => ({ ...prev, [id]: e.target.checked ? [...(prev[id] ?? []), level.id] : (prev[id] ?? []).filter(v => v !== level.id) }))} />
                        <span className="min-w-0 flex-1"><span className="block font-medium">{t(level.nameKey, { lng: 'zh-Hans' })}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{t(level.nameKey, { lng: 'en' })}</span></span>
                        <Check aria-hidden="true" className={cn("size-3.5 shrink-0", modelThinkingLevels[id]?.includes(level.id) ? "opacity-100" : "opacity-0")} />
                      </label>)}
                    </div>
                  </fieldset>

                  </div>
                </details>
              </section>
            )
          })}
          {limitError && (
            <p className="text-xs text-destructive" role="alert">{limitError}</p>
          )}
        </div>
      )}

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </form>
  )
}
