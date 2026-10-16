/**
 * Brand mark for one API-setup preset.
 *
 * Each provider import is a single file from `@lobehub/icons-static-svg`.
 * Custom and Selection Backend use the bundled Selection mark. Other brands
 * missing from LobeHub use the same letter tile.
 */

import selectionIcon from '@/assets/selection-icon.svg'

import aistudio from '@lobehub/icons-static-svg/icons/aistudio.svg'
import azure from '@lobehub/icons-static-svg/icons/azure.svg'
import bedrock from '@lobehub/icons-static-svg/icons/bedrock.svg'
import cerebras from '@lobehub/icons-static-svg/icons/cerebras.svg'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek.svg'
import githubcopilot from '@lobehub/icons-static-svg/icons/githubcopilot.svg'
import groq from '@lobehub/icons-static-svg/icons/groq.svg'
import huggingface from '@lobehub/icons-static-svg/icons/huggingface.svg'
import kimi from '@lobehub/icons-static-svg/icons/kimi.svg'
import minimax from '@lobehub/icons-static-svg/icons/minimax.svg'
import mistral from '@lobehub/icons-static-svg/icons/mistral.svg'
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg'
import openai from '@lobehub/icons-static-svg/icons/openai.svg'
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg'
import vercel from '@lobehub/icons-static-svg/icons/vercel.svg'
import xai from '@lobehub/icons-static-svg/icons/xai.svg'
import zai from '@lobehub/icons-static-svg/icons/zai.svg'
import { SELECTION_APP_ICON_SLUG, presetMonogram } from './provider-presets'

const LOBE_ICONS: Readonly<Record<string, string>> = {
  aistudio,
  azure,
  bedrock,
  cerebras,
  deepseek,
  githubcopilot,
  groq,
  huggingface,
  kimi,
  minimax,
  mistral,
  moonshot,
  openai,
  openrouter,
  vercel,
  xai,
  zai,
}

interface PresetBrandMarkProps {
  slug: string | null
  label: string
  size?: number
}

export function PresetBrandMark({ slug, label, size = 14 }: PresetBrandMarkProps) {
  const src = slug === SELECTION_APP_ICON_SLUG
    ? selectionIcon
    : (slug ? LOBE_ICONS[slug] : undefined)
  if (!src) {
    return (
      <span
        aria-hidden
        className="inline-flex shrink-0 items-center justify-center rounded-[3px] bg-foreground/10 font-semibold leading-none text-foreground/70"
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.62)) }}
      >
        {presetMonogram(label)}
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className="inline-block shrink-0 bg-current"
      style={{
        width: size,
        height: size,
        mask: `url("${src}") center / contain no-repeat`,
        WebkitMask: `url("${src}") center / contain no-repeat`,
      }}
    />
  )
}
