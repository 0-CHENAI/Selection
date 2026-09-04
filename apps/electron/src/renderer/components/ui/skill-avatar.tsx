/**
 * SkillAvatar - Thin wrapper around EntityIcon for skills.
 * Use `fluid` for fill-parent sizing.
 */

import { Zap } from 'lucide-react'
import { EntityIcon, type IconComponent } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import type { IconSize } from '@craft-agent/shared/icons'
import type { LoadedSkill } from '../../../shared/types'
import { resolveSkillTitle } from '@craft-agent/shared/display-titles'

interface SkillAvatarProps {
  /** LoadedSkill object */
  skill: LoadedSkill
  /** Size variant */
  size?: IconSize
  /** Fill parent container (h-full w-full). Overrides size. */
  fluid?: boolean
  /** Additional className overrides */
  className?: string
  /** Workspace ID for loading local icons */
  workspaceId?: string
  /** Drop EntityIcon background, ring, and radius. */
  chromeless?: boolean
  /** Render icon content with no container div. */
  bare?: boolean
  /** Override the default Zap fallback icon. */
  fallbackIcon?: IconComponent
}

export function SkillAvatar({
  skill,
  size = 'md',
  fluid,
  className,
  workspaceId,
  chromeless,
  bare,
  fallbackIcon,
}: SkillAvatarProps) {
  const icon = useEntityIcon({
    workspaceId: workspaceId ?? '',
    entityType: 'skill',
    identifier: skill.slug,
    iconPath: skill.iconPath,
    iconValue: skill.metadata.icon,
  })

  return (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={fallbackIcon ?? Zap}
      alt={resolveSkillTitle(skill)}
      className={className}
      containerClassName={fluid ? 'h-full w-full' : undefined}
      chromeless={chromeless}
      bare={bare}
    />
  )
}
