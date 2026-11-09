import * as React from 'react'

export const DEFAULT_TOOLTIP_Z_CLASS = 'z-tooltip'
export const NESTED_TOOLTIP_Z_CLASS = 'z-nested-tooltip'

export const ERROR_TOOLTIP_CONTENT_CLASS =
  'max-w-[min(24rem,calc(100vw-1.5rem))] max-h-[min(15rem,calc(100vh-2rem))] overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] select-text'

export const ERROR_TOOLTIP_COLLISION_PADDING = 8

export function tooltipZIndexClass(insideOverlayLayer: boolean): string {
  return insideOverlayLayer ? NESTED_TOOLTIP_Z_CLASS : DEFAULT_TOOLTIP_Z_CLASS
}

const OverlayLayerContext = React.createContext(false)

export function OverlayLayerProvider({ children }: { children: React.ReactNode }) {
  return (
    <OverlayLayerContext.Provider value={true}>
      {children}
    </OverlayLayerContext.Provider>
  )
}

export function useOverlayLayer(): boolean {
  return React.useContext(OverlayLayerContext)
}
