/**
 * MessagingPlatformIcon
 *
 * Parallel of ConnectionIcon (for LLM providers) but for messaging platforms.
 * Renders the Lark / Feishu brand mark. Falls back to a colored
 * platform-initial badge if the SVG import fails at runtime.
 *
 * SVGs in `assets/messaging-icons/` are shorthand brand marks tuned for a
 * prototype — for production we should swap in the official marks from each
 * platform's press kit.
 */

import larkIcon from '@/assets/messaging-icons/lark.svg'

type MessagingPlatform = 'lark'

const platformIcons: Record<MessagingPlatform, string> = {
  lark: larkIcon,
}

const platformFallback: Record<MessagingPlatform, { bg: string; initial: string }> = {
  lark: { bg: '#00D6B9', initial: 'L' },
}

interface MessagingPlatformIconProps {
  platform: MessagingPlatform
  /** Size in pixels (default: 16). */
  size?: number
  className?: string
}

export function MessagingPlatformIcon({
  platform,
  size = 16,
  className = '',
}: MessagingPlatformIconProps) {
  const src = platformIcons[platform]
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={`rounded-[3px] flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  const { bg, initial } = platformFallback[platform]
  return (
    <div
      className={`rounded-[3px] flex items-center justify-center flex-shrink-0 text-white font-semibold ${className}`}
      style={{ width: size, height: size, backgroundColor: bg, fontSize: Math.round(size * 0.6) }}
    >
      {initial}
    </div>
  )
}
