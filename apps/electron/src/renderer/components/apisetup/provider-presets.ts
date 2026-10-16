/**
 * API setup provider presets.
 *
 * The dropdown is sorted by the visible brand name (case-insensitive).
 * Icons come from `@lobehub/icons-static-svg`, one file per brand.
 * Custom and Selection Backend use the in-app Selection mark.
 * Presets LobeHub does not publish stay on a letter placeholder.
 */

export interface Preset {
  key: string
  label: string
  url: string
  placeholder?: string
  /** Provider is available only through the Pi runtime, not the legacy Anthropic path. */
  piOnly?: boolean
}

export function sortNamedPresets<T extends { key: string; label: string }>(presets: readonly T[]): T[] {
  return [...presets].sort((a, b) => {
    const byLabel = a.label.localeCompare(b.label, 'en', { sensitivity: 'base', numeric: true })
    if (byLabel !== 0) return byLabel
    return a.key.localeCompare(b.key, 'en', { sensitivity: 'base' })
  })
}

/** First letter of the visible name. Shared by every preset that has no LobeHub mark. */
export function presetMonogram(label: string): string {
  const first = Array.from(label.trim())[0]
  return first ? first.toLocaleUpperCase() : '?'
}

/** In-app Selection mark. Not a LobeHub slug. */
export const SELECTION_APP_ICON_SLUG = 'selection'

/**
 * Icon slug for a setup preset or OAuth row.
 * `selection` is the bundled app mark. Null means a letter placeholder.
 */
const PRESET_ICON_SLUG: Readonly<Record<string, string>> = {
  custom: SELECTION_APP_ICON_SLUG,
  pi: SELECTION_APP_ICON_SLUG,
  openai: 'openai',
  'openai-eu': 'openai',
  'openai-us': 'openai',
  google: 'aistudio',
  openrouter: 'openrouter',
  'azure-openai-responses': 'azure',
  'amazon-bedrock': 'bedrock',
  groq: 'groq',
  mistral: 'mistral',
  deepseek: 'deepseek',
  xai: 'xai',
  cerebras: 'cerebras',
  zai: 'zai',
  huggingface: 'huggingface',
  'minimax-global': 'minimax',
  'minimax-cn': 'minimax',
  'kimi-coding': 'kimi',
  moonshotai: 'moonshot',
  'moonshotai-cn': 'moonshot',
  'vercel-ai-gateway': 'vercel',
  pi_chatgpt_oauth: 'openai',
  pi_copilot_oauth: 'githubcopilot',
  pi_kimi_oauth: 'kimi',
}

export function presetBrandSlug(presetKey: string): string | null {
  return PRESET_ICON_SLUG[presetKey] ?? null
}

/** Slugs the preset dropdown actually renders. Keep this aligned with PresetBrandMark imports. */
export const USED_LOBE_ICON_SLUGS: readonly string[] = [
  'aistudio',
  'azure',
  'bedrock',
  'cerebras',
  'deepseek',
  'githubcopilot',
  'groq',
  'huggingface',
  'kimi',
  'minimax',
  'mistral',
  'moonshot',
  'openai',
  'openrouter',
  'vercel',
  'xai',
  'zai',
]

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
  { key: 'minimax-global', label: 'Minimax Global', url: 'https://api.minimax.io/anthropic', placeholder: 'Paste your key here...', piOnly: true },
  { key: 'minimax-cn', label: 'Minimax CN', url: 'https://api.minimaxi.com/anthropic', placeholder: 'Paste your key here...', piOnly: true },
  { key: 'kimi-coding', label: 'Kimi (Coding)', url: 'https://api.kimi.com/coding', placeholder: 'sk-kimi-...' },
  { key: 'moonshotai', label: 'Moonshot AI', url: 'https://api.moonshot.ai/v1', placeholder: 'sk-...', piOnly: true },
  { key: 'moonshotai-cn', label: 'Moonshot AI (CN)', url: 'https://api.moonshot.cn/v1', placeholder: 'sk-...', piOnly: true },
  { key: 'vercel-ai-gateway', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh', placeholder: 'Paste your key here...' },
  { key: 'manifest', label: 'Manifest', url: 'https://app.manifest.build/v1', placeholder: 'mnfst_...' },
  { key: 'custom', label: 'Custom', url: '', placeholder: 'Paste your key here...' },
]

/**
 * Presets without a Pi SDK provider entry that nonetheless expose a known
 * OpenAI-compatible protocol. They behave like 'custom' on submit (customEndpoint
 * gets pinned to openai-completions) but stay branded in the dropdown.
 */
export const OPENAI_COMPAT_CUSTOM_URL_PRESETS: ReadonlySet<string> = new Set(['manifest', 'order-openai'])

/** Branded Anthropic-compatible gateways (ORDER Anthropic path has no /v1). */
export const ANTHROPIC_COMPAT_CUSTOM_URL_PRESETS: ReadonlySet<string> = new Set()

const OPENAI_PRESETS: Preset[] = [
  { key: 'openai', label: 'OpenAI', url: '' },
]

const PI_PRESETS: Preset[] = [
  { key: 'pi', label: 'Selection Backend (Direct)', url: '' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { key: 'custom', label: 'Custom', url: '' },
]

const GOOGLE_PRESETS: Preset[] = [
  { key: 'google', label: 'Google AI Studio', url: '' },
]

export const DEFAULT_ENDPOINT_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'pi', 'google'])

const ORDER_PRESETS: Preset[] = [
  { key: 'order-openai', label: 'ORDER (OpenAI)', url: 'https://order.ai.jxepdi.top/v1', placeholder: 'Paste your ORDER key...' },
]

export function getPresetsForProvider(
  providerType: 'anthropic' | 'openai' | 'pi' | 'google' | 'pi_api_key',
  presetFilter?: 'order',
): Preset[] {
  if (presetFilter === 'order') return sortNamedPresets(ORDER_PRESETS)
  if (providerType === 'pi_api_key') return sortNamedPresets(ANTHROPIC_PRESETS)
  if (providerType === 'google') return sortNamedPresets(GOOGLE_PRESETS)
  if (providerType === 'pi') return sortNamedPresets(PI_PRESETS)
  if (providerType === 'openai') return sortNamedPresets(OPENAI_PRESETS)
  return sortNamedPresets(ANTHROPIC_PRESETS.filter(preset => !preset.piOnly))
}

export function getPresetForUrl(url: string, presets: readonly Preset[]): string {
  const match = presets.find(preset => preset.key !== 'custom' && preset.url === url)
  return match?.key ?? 'custom'
}
