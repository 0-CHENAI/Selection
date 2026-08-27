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

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Command as CommandPrimitive } from "cmdk"
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
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff, Loader2 } from "lucide-react"
import { pickTierDefaults, resolveTierModels, type PiModelInfo } from "./tier-models"
import {
  buildCustomEndpointModelSubmission,
  resolveCustomEndpointPayload,
  resolvePiAuthProviderForSubmit,
  resolvePresetStateForBaseUrlChange,
  type PresetKey,
} from "./submit-helpers"
import { RemoteModelsPicker } from "./RemoteModelsPicker"
import {
  buildModelLimitOptions,
  DEFAULT_MODEL_CONTEXT_WINDOW_PRESET,
  DEFAULT_MODEL_MAX_OUTPUT_PRESET,
  fetchOpenAiCompatibleModels,
  findRemoteModel,
  lookupRecordByModelId,
  MODEL_CONTEXT_WINDOW_PRESETS,
  MODEL_MAX_OUTPUT_PRESETS,
  parseSelectedModels,
  persistCustomContextWindow,
  persistCustomMaxTokens,
  isValidModelLimitCombination,
  resolveCatalogOrOverrideLimit,
  resolveModelLimitSource,
  resolveModelLimitsStatus,
  resolveMaxTokensForContext,
  resolveRemoteModelSupportsImages,
  setHasModelId,
  toggleSelectedModel,
  type ModelLimitSource,
  type ModelLimitPreset,
  type RemoteModel,
} from "./fetch-openai-models.ts"
import { formatModelTokenLimit } from '@/components/app-shell/input/model-picker-helpers'

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
  /** Pre-fill values when editing an existing connection */
  initialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    modelImageCaps?: Record<string, boolean>
    modelContextWindows?: Record<string, number>
    modelMaxTokens?: Record<string, number>
    /** Pre-fill the protocol toggle for custom endpoints */
    customApi?: CustomEndpointApi
  }
}

interface Preset {
  key: PresetKey
  label: string
  url: string
  placeholder?: string
}

// Pi API key presets (OpenAI Compatible + first-party Pi providers).
const ANTHROPIC_PRESETS: Preset[] = [
  { key: 'order-openai', label: 'ORDER (OpenAI)', url: 'https://order.ai.jxepdi.top/v1', placeholder: 'Paste your ORDER key...' },
  { key: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'openai-eu', label: 'OpenAI EU', url: 'https://eu.api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'openai-us', label: 'OpenAI US', url: 'https://us.api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'google', label: 'Google AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta', placeholder: 'AIza...' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', placeholder: 'sk-or-...' },
  { key: 'azure-openai-responses', label: 'Azure OpenAI', url: '', placeholder: 'Paste your key here...' },
  { key: 'amazon-bedrock', label: 'Amazon Bedrock', url: 'https://bedrock-runtime.us-east-1.amazonaws.com', placeholder: 'AKIA...' },
  { key: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', placeholder: 'gsk_...' },
  { key: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1', placeholder: 'Paste your key here...' },
  { key: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', placeholder: 'sk-...' },
  { key: 'xai', label: 'xAI (Grok)', url: 'https://api.x.ai/v1', placeholder: 'xai-...' },
  { key: 'cerebras', label: 'Cerebras', url: 'https://api.cerebras.ai/v1', placeholder: 'csk-...' },
  { key: 'zai', label: 'z.ai (GLM)', url: 'https://api.z.ai/api/coding/paas/v4', placeholder: 'Paste your key here...' },
  { key: 'huggingface', label: 'Hugging Face', url: 'https://router.huggingface.co/v1', placeholder: 'hf_...' },
  { key: 'minimax-global', label: 'Minimax Global', url: 'https://api.minimax.io/anthropic', placeholder: 'Paste your key here...' },
  { key: 'minimax-cn', label: 'Minimax CN', url: 'https://api.minimaxi.com/anthropic', placeholder: 'Paste your key here...' },
  { key: 'kimi-coding', label: 'Kimi (Coding)', url: 'https://api.kimi.com/coding', placeholder: 'sk-kimi-...' },
  { key: 'vercel-ai-gateway', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh', placeholder: 'Paste your key here...' },
  { key: 'manifest', label: 'Manifest', url: 'https://app.manifest.build/v1', placeholder: 'mnfst_...' },
  { key: 'custom', label: 'Custom', url: '', placeholder: 'Paste your key here...' },
]

/**
 * Presets without a Pi SDK provider entry that nonetheless expose a known
 * OpenAI-compatible protocol. They behave like 'custom' on submit (customEndpoint
 * gets pinned to openai-completions) but stay branded in the dropdown.
 */
const OPENAI_COMPAT_CUSTOM_URL_PRESETS: ReadonlySet<string> = new Set(['manifest', 'order-openai'])

/**
 * Branded Anthropic-compatible gateways (ORDER Anthropic path has no /v1).
 */
const ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS: ReadonlySet<string> = new Set()

// OpenAI provider presets - for Codex backend
// Only direct OpenAI is supported; 3PP providers (OpenRouter, Vercel, Ollama) should be
// configured via the Anthropic/Claude connection which routes through the Claude Agent SDK.
const OPENAI_PRESETS: Preset[] = [
  { key: 'openai', label: 'OpenAI', url: '' },
]

// Pi provider presets - unified API for 20+ LLM providers
const PI_PRESETS: Preset[] = [
  { key: 'pi', label: 'Selection Backend (Direct)', url: '' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'custom', label: 'Custom', url: '' },
]

// Google AI Studio preset - single endpoint, no custom URL needed
const GOOGLE_PRESETS: Preset[] = [
  { key: 'google', label: 'Google AI Studio', url: '' },
]

/** Presets that require the Pi SDK for authentication — hidden in Anthropic API Key mode */
const PI_ONLY_PRESET_KEYS: ReadonlySet<string> = new Set(['minimax-global', 'minimax-cn'])
const DEFAULT_ENDPOINT_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'pi', 'google'])

const COMPAT_ANTHROPIC_DEFAULTS = 'claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5'
const COMPAT_OPENAI_DEFAULTS = 'openai/gpt-5.2-codex, openai/gpt-5.1-codex-mini'
const COMPAT_MINIMAX_DEFAULTS = 'MiniMax-M2.5, MiniMax-M2.5-highspeed'
const COMPAT_KIMI_DEFAULTS = 'k2p5, kimi-k2-thinking'

const ORDER_PRESETS: Preset[] = [
  { key: 'order-openai', label: 'ORDER (OpenAI)', url: 'https://order.ai.jxepdi.top/v1', placeholder: 'Paste your ORDER key...' },
]

function getPresetsForProvider(
  providerType: 'anthropic' | 'openai' | 'pi' | 'google' | 'pi_api_key',
  presetFilter?: 'order',
): Preset[] {
  if (presetFilter === 'order') return ORDER_PRESETS
  if (providerType === 'pi_api_key') return ANTHROPIC_PRESETS
  if (providerType === 'google') return GOOGLE_PRESETS
  if (providerType === 'pi') return PI_PRESETS
  if (providerType === 'openai') return OPENAI_PRESETS
  // Anthropic mode: exclude presets that only work via Pi SDK
  return ANTHROPIC_PRESETS.filter(p => !PI_ONLY_PRESET_KEYS.has(p.key))
}

function getPresetForUrl(url: string, presets: Preset[]): PresetKey {
  const match = presets.find(p => p.key !== 'custom' && p.url === url)
  return match?.key ?? 'custom'
}

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

function ModelLimitSelect({
  id,
  label,
  value,
  source,
  presets,
  upperExclusive,
  invalid,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: number
  source: ModelLimitSource
  presets: readonly ModelLimitPreset[]
  upperExclusive?: number
  invalid?: boolean
  disabled?: boolean
  onChange: (next: number) => void
}) {
  const { t } = useTranslation()
  const options = buildModelLimitOptions(presets, value, upperExclusive)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-muted-foreground font-normal text-xs">
        <span>{label}</span>
        <span className="tabular-nums text-foreground/50">{formatModelTokenLimit(value)}</span>
        <ModelLimitSourceChip source={source} />
      </Label>
      <Select
        value={String(value)}
        onValueChange={(next) => onChange(Number(next))}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          aria-invalid={invalid || undefined}
          className={cn(
            'border-0 bg-background/80 shadow-minimal tabular-nums',
            invalid && 'ring-1 ring-destructive/50',
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={String(option.value)}
              disabled={option.readOnly}
            >
              {option.readOnly
                ? t('apiSetup.modelLimitCurrentValue', {
                    label: option.label,
                    value: option.value.toLocaleString(),
                  })
                : option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
    if (initialValues?.customApi === 'openai-completions') return initialValues.customApi
    return 'openai-completions'
  })
  const [modelError, setModelError] = useState<string | null>(null)

  // Bedrock auth state
  const [bedrockAuthMethod, setBedrockAuthMethod] = useState<'iam_credentials' | 'environment'>('iam_credentials')
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('')
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('')
  const [awsSessionToken, setAwsSessionToken] = useState('')
  const [awsRegion, setAwsRegion] = useState('us-east-1')

  // Pi model tier state (for providers with many models like OpenRouter, Vercel)
  const [piModels, setPiModels] = useState<PiModelInfo[]>([])
  const [piModelsLoading, setPiModelsLoading] = useState(false)
  const [bestModel, setBestModel] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [cheapModel, setCheapModel] = useState('')
  const [openTier, setOpenTier] = useState<string | null>(null)
  const [tierFilter, setTierFilter] = useState('')
  const [tierDropdownPosition, setTierDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const tierFilterInputRef = useRef<HTMLInputElement>(null)
  const hydratedTierProviderRef = useRef<string | null>(null)
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([])
  const [remoteModelsLoading, setRemoteModelsLoading] = useState(false)
  const [remoteModelsError, setRemoteModelsError] = useState<string | null>(null)
  const [remoteModelsFailed, setRemoteModelsFailed] = useState(false)
  const [remoteModelsNonce, setRemoteModelsNonce] = useState(0)
  const remoteModelsAbortRef = useRef<AbortController | null>(null)
  const [modelImageCaps, setModelImageCaps] = useState<Record<string, boolean>>(
    () => ({ ...initialValues?.modelImageCaps }),
  )
  const [modelContextWindows, setModelContextWindows] = useState<Record<string, number>>(
    () => ({ ...initialValues?.modelContextWindows }),
  )
  const [modelMaxTokens, setModelMaxTokens] = useState<Record<string, number>>(
    () => ({ ...initialValues?.modelMaxTokens }),
  )
  const [editedContextIds, setEditedContextIds] = useState<Set<string>>(() => new Set())
  const [editedMaxTokenIds, setEditedMaxTokenIds] = useState<Set<string>>(() => new Set())
  const [limitError, setLimitError] = useState<string | null>(null)
  const [limitNotice, setLimitNotice] = useState<string | null>(null)

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

  // Fetch Pi SDK models when a provider is selected in pi_api_key flow.
  // Returns all models sorted by cost (expensive-first) for the searchable tier dropdowns.
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

      if (hydratedTierProviderRef.current !== provider) {
        const tiers = resolveTierModels(result.models, provider === initialPreset ? initialValues?.models : undefined)
        setBestModel(tiers.best)
        setDefaultModel(tiers.default_)
        setCheapModel(tiers.cheap)
        hydratedTierProviderRef.current = provider
      }
    } catch (err) {
      console.error('[ApiKeyInput] Failed to load models for', provider, err)
      setPiModels([])
    } finally {
      setPiModelsLoading(false)
    }
  }, [initialPreset, initialValues?.models, isPiApiKeyFlow])

  useEffect(() => {
    loadPiModels(activePreset)
  }, [activePreset, loadPiModels])

  // Custom OpenAI-compatible endpoints: read /v1/models after the user pastes a key.
  // ORDER uses the catalog for the picker; custom/Manifest use it to prefill limits.
  useEffect(() => {
    if (!isCustomEndpointForm) {
      setRemoteModels([])
      setRemoteModelsError(null)
      setRemoteModelsFailed(false)
      setRemoteModelsLoading(false)
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
          setRemoteModels(models)
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
  }, [isCustomEndpointForm, isOrderPreset, apiKey, baseUrl, remoteModelsNonce, t])

  // Whether to show 3 tier dropdowns instead of text input
  const hasPiModels = isPiApiKeyFlow
    && piModels.length > 0
    && !isDefaultProviderPreset
    && activePreset !== 'custom'
    && !isBedrock
    && !OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(activePreset)
    && !ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS.has(activePreset)

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key !== 'custom') {
      setLastNonCustomPreset(preset.key)
    }
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    // Pin protocol for branded ORDER / Manifest-style gateways
    if (OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(preset.key) || preset.key === 'custom') {
      setCustomApi('openai-completions')
    }
    setModelError(null)
    setLimitError(null)
    setLimitNotice(null)
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
    } else if (
      preset.key === 'custom'
      || OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(preset.key)
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
      } else if (presetKey === 'openrouter' || presetKey === 'vercel-ai-gateway' || presetKey === 'custom') {
        setConnectionDefaultModel(providerType === 'openai' ? COMPAT_OPENAI_DEFAULTS : COMPAT_ANTHROPIC_DEFAULTS)
      }
    }
  }

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

    // Pi API key flow with tier dropdowns — submit selected models
    if (hasPiModels) {
      if (!bestModel || !defaultModel || !cheapModel) {
        setModelError('Please select a model for each tier.')
        return
      }
      const models: string[] = [bestModel, defaultModel, cheapModel]
      onSubmit({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        connectionDefaultModel: bestModel,
        models,
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
          contextWindow,
          maxTokens,
        })
      })
      : parsedModels

    const isUsingDefaultEndpoint = isDefaultProviderPreset || !effectiveBaseUrl
    const requiresModel = !isDefaultProviderPreset && !!effectiveBaseUrl
    if (requiresModel && parsedModels.length === 0) {
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

  const tierConfigs = [
    { label: t('apiSetup.modelTier.best'), desc: t('apiSetup.modelTier.bestDesc'), value: bestModel, onChange: setBestModel },
    { label: t('apiSetup.modelTier.balanced'), desc: t('apiSetup.modelTier.balancedDesc'), value: defaultModel, onChange: setDefaultModel },
    { label: t('apiSetup.modelTier.fast'), desc: t('apiSetup.modelTier.fastDesc'), value: cheapModel, onChange: setCheapModel },
  ]
  const activeTierConfig = openTier ? tierConfigs.find(tier => tier.label === openTier) : null

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
              className="flex h-6 items-center gap-1 rounded-[6px] bg-background shadow-minimal pl-2.5 pr-2 text-[12px] font-medium text-foreground/50 hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {presetDisplayLabel(presets.find(p => p.key === activePreset) ?? presets[0]!)}
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu">
              {presets.map((preset) => (
                <StyledDropdownMenuItem
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset)}
                  className="justify-between"
                >
                  {presetDisplayLabel(preset)}
                  <Check className={cn("size-3", activePreset === preset.key ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
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

      {/* Model Selection — 3 tier dropdowns for Pi providers, text input for custom/compat */}
      {hasPiModels ? (
        <div className="space-y-3">
          {piModelsLoading ? (
            <div className="flex items-center gap-2 py-3 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="text-xs">{t("apiSetup.loadingModels")}</span>
            </div>
          ) : (
            <>
              {tierConfigs.map(({ label, desc, value }) => (
                <div key={label} className="space-y-1.5">
                  <Label className="text-muted-foreground font-normal text-xs">
                    {label}{' '}
                    <span className="text-foreground/30">· {desc}</span>
                  </Label>
                  <button
                    type="button"
                    disabled={isDisabled}
                    onClick={(e) => {
                      if (openTier === label) {
                        setOpenTier(null)
                        setTierFilter('')
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTierDropdownPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width })
                        setOpenTier(label)
                        setTierFilter('')
                        setTimeout(() => tierFilterInputRef.current?.focus(), 0)
                      }
                    }}
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-md px-3 text-sm",
                      "bg-foreground-2 shadow-minimal transition-colors",
                      "hover:bg-background focus:outline-none focus:bg-background",
                      isDisabled && "opacity-50 pointer-events-none"
                    )}
                  >
                    <span className="truncate text-foreground">
                      {piModels.find(m => m.id === value)?.name ?? t('apiSetup.selectModel')}
                    </span>
                    <ChevronDown className="size-3 opacity-50 shrink-0" />
                  </button>
                </div>
              ))}
              {activeTierConfig && tierDropdownPosition && (
                <>
                  <div
                    className="fixed inset-0 z-floating-backdrop"
                    onClick={() => { setOpenTier(null); setTierFilter('') }}
                  />
                  <div
                    className="fixed z-floating-menu min-w-[200px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small"
                    style={{
                      top: tierDropdownPosition.top,
                      left: tierDropdownPosition.left,
                      width: tierDropdownPosition.width,
                    }}
                  >
                    <CommandPrimitive
                      className="min-w-[200px]"
                      shouldFilter={false}
                    >
                      <div className="border-b border-border/50 px-3 py-2">
                        <CommandPrimitive.Input
                          ref={tierFilterInputRef}
                          value={tierFilter}
                          onValueChange={setTierFilter}
                          placeholder={t("apiSetup.searchModels")}
                          autoFocus
                          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground placeholder:select-none"
                        />
                      </div>
                      <CommandPrimitive.List className="max-h-[240px] overflow-y-auto p-1">
                        {piModels
                          .filter((m) => {
                            const query = tierFilter.toLowerCase()
                            return m.name.toLowerCase().includes(query)
                              || m.id.toLowerCase().includes(query)
                          })
                          .map((model) => (
                            <CommandPrimitive.Item
                              key={model.id}
                              value={model.id}
                              onSelect={() => {
                                activeTierConfig.onChange(model.id)
                                setOpenTier(null)
                                setTierFilter('')
                              }}
                              className={cn(
                                "flex cursor-pointer select-none items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-[13px]",
                                "outline-none data-[selected=true]:bg-foreground/5"
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="truncate">{model.name}</span>
                                {model.reasoning && (
                                  <span className="text-[10px] text-foreground/30 shrink-0">{t('apiSetup.reasoning')}</span>
                                )}
                              </div>
                              <Check className={cn("size-3 shrink-0", activeTierConfig.value === model.id ? "opacity-100" : "opacity-0")} />
                            </CommandPrimitive.Item>
                          ))}
                      </CommandPrimitive.List>
                    </CommandPrimitive>
                  </div>
                </>
              )}
              {modelError && (
                <p className="text-xs text-destructive">{modelError}</p>
              )}
            </>
          )}
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
            setLimitNotice(null)
          }}
          onRetry={() => setRemoteModelsNonce((n) => n + 1)}
        />
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
                setModelError(null)
                setLimitError(null)
                setLimitNotice(null)
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
          {(activePreset === 'custom' || !activePreset) && (
            <p className="text-xs text-foreground/30">
              {t('apiSetup.customEndpointRequired')}
            </p>
          )}
        </div>
      )}

      {showCustomModelLimits && (
        <div className="space-y-3">
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
              <div key={id} className="space-y-2.5 rounded-md bg-foreground-2 p-3">
                <p className="truncate text-xs font-medium text-foreground/80">{remote?.name ?? id}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <ModelLimitSelect
                    id={`context-window-${id}`}
                    label={t('apiSetup.contextWindow')}
                    value={contextWindow}
                    source={contextSource}
                    presets={MODEL_CONTEXT_WINDOW_PRESETS}
                    disabled={isDisabled}
                    onChange={(next) => {
                      setEditedContextIds((prev) => new Set(prev).add(id))
                      setModelContextWindows((prev) => ({ ...prev, [id]: next }))
                      const adjustedMax = resolveMaxTokensForContext(maxTokens, next)
                      if (adjustedMax !== maxTokens) {
                        setEditedMaxTokenIds((prev) => new Set(prev).add(id))
                        setModelMaxTokens((prev) => ({ ...prev, [id]: adjustedMax }))
                        setLimitNotice(t('apiSetup.modelLimitAdjusted', {
                          model: remote?.name ?? id,
                          value: formatModelTokenLimit(adjustedMax),
                        }))
                      } else {
                        setLimitNotice(null)
                      }
                      setLimitError(null)
                    }}
                  />
                  <ModelLimitSelect
                    id={`max-tokens-${id}`}
                    label={t('apiSetup.maxOutputTokens')}
                    value={maxTokens}
                    source={maxSource}
                    presets={MODEL_MAX_OUTPUT_PRESETS}
                    upperExclusive={contextWindow}
                    invalid={limitsInvalid}
                    disabled={isDisabled}
                    onChange={(next) => {
                      setEditedMaxTokenIds((prev) => new Set(prev).add(id))
                      setModelMaxTokens((prev) => ({ ...prev, [id]: next }))
                      setLimitError(null)
                      setLimitNotice(null)
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 pt-0.5">
                  <div className="min-w-0">
                    <Label htmlFor={`multimodal-${id}`} className="text-xs font-normal">
                      {t('apiSetup.multimodal')}
                    </Label>
                    <p id={`multimodal-hint-${id}`} className="text-[11px] text-foreground/40">
                      {t('apiSetup.multimodalHint')}
                    </p>
                  </div>
                  <Switch
                    id={`multimodal-${id}`}
                    checked={supportsImages}
                    onCheckedChange={(checked) => {
                      setModelImageCaps((prev) => ({ ...prev, [id]: checked }))
                    }}
                    disabled={isDisabled}
                    aria-label={`${remote?.name ?? id}: ${t('apiSetup.multimodal')}`}
                    aria-describedby={`multimodal-hint-${id}`}
                  />
                </div>
              </div>
            )
          })}
          {limitError && (
            <p className="text-xs text-destructive" role="alert">{limitError}</p>
          )}
          {limitNotice && !limitError && (
            <p className="text-xs text-foreground/50" role="status">{limitNotice}</p>
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
