/**
 * HeaderMenu
 *
 * A "..." dropdown menu for panel headers with built-in Open in New Window action.
 * Pass page-specific menu items as children; they appear above the separator.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, AppWindow } from 'lucide-react'
import { HeaderIconButton } from './HeaderIconButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from './dropdown-menu'
import {
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from './styled-dropdown'

interface HeaderMenuProps {
  /** Route string for Open in New Window action */
  route: string
  /** Page-specific menu items (rendered before Open in New Window) */
  children?: React.ReactNode
  /**
   * @deprecated External docs links removed. Kept optional so existing call
   * sites compile without change; the prop is ignored.
   */
  helpFeature?: string
}

export function HeaderMenu({ route, children }: HeaderMenuProps) {
  const { t } = useTranslation()
  const handleOpenInNewWindow = async () => {
    const separator = route.includes('?') ? '&' : '?'
    const url = `craftagents://${route}${separator}window=focused`
    try {
      await window.electronAPI?.openUrl(url)
    } catch (error) {
      console.error('[HeaderMenu] openUrl failed:', error)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton icon={<MoreHorizontal className="h-4 w-4" />} />
      </DropdownMenuTrigger>
      <StyledDropdownMenuContent align="end">
        {children}
        {children && <StyledDropdownMenuSeparator />}
        <StyledDropdownMenuItem onClick={handleOpenInNewWindow}>
          <AppWindow className="h-3.5 w-3.5" />
          <span className="flex-1">{t("sessionMenu.openInNewWindow")}</span>
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
