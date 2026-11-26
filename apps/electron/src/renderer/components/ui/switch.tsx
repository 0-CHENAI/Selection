"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import type { NativeSwitchAPI, NativeSwitchProps } from "../../../shared/types"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { cn } from "@/lib/utils"

interface NativeSwitchInstance {
  id: number
  button: HTMLButtonElement
  fullyVisible: boolean
  pending?: Promise<void>
  created: boolean
  lastKey: string
  dispose: () => void
}

const nativeInstances = new Map<number, NativeSwitchInstance>()
const pendingUpdates = new Set<Promise<void>>()
let frame = 0
let nextSwitchId = 1
let openOverlays = 0
let clearingSwitches: Promise<void> | undefined

function invalidateNativeSwitch(inst: NativeSwitchInstance): void {
  inst.lastKey = ''
  inst.button.removeAttribute('data-native-switch-visible')
}

// AppKit views sit above the web contents. Keep the EditPopover portal unmounted
// until main has removed both existing views and any create/update already sent.
export function useNativeSwitchSafeOpen(open: boolean): boolean {
  const api = typeof window === 'undefined' ? undefined : window.nativeSwitch
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    if (!open || !api?.available) {
      setReady(false)
      return
    }
    openOverlays++
    let active = true
    if (!clearingSwitches) {
      for (const inst of nativeInstances.values()) invalidateNativeSwitch(inst)
      clearingSwitches = Promise.all(pendingUpdates)
        .then(() => api.destroyAll())
        .then(() => {
          for (const inst of nativeInstances.values()) inst.created = false
        })
        .finally(() => { clearingSwitches = undefined })
    }
    void clearingSwitches.then(() => {
      if (active) setReady(true)
    }, (error) => {
      // Main could not confirm removal. Do not put an interactive portal under AppKit.
      if (active) console.warn('[native-switch] could not clear switches for EditPopover:', error)
    })
    return () => {
      active = false
      openOverlays--
    }
  }, [api, open])
  return open && (!api?.available || ready)
}

function isOverlayOpen(): boolean {
  return hasOpenOverlay() || Boolean(document.querySelector(
    '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]'
  ))
}

function isSwitchExposed(button: HTMLButtonElement, { x, y, width, height }: DOMRect): boolean {
  // The centered small NSSwitch is 44 points wide, including its hit area.
  const overhang = Math.max(0, (44 - width) / 2)
  if (x - overhang < 0 || y < 0 || x + width + overhang > window.innerWidth || y + height > window.innerHeight) return false
  const midX = x + width / 2
  const midY = y + height / 2
  // Sticky content can cover a switch without changing its intersection ratio.
  return [
    [midX, midY], [x + 1, midY], [x + width - 1, midY], [midX, y + 1], [midX, y + height - 1],
  ].every(([px, py]) => button.contains(document.elementFromPoint(px, py))) &&
    (!overhang || [x - overhang + 0.5, x + width + overhang - 0.5].every((px) => {
      const hit = document.elementFromPoint(px, midY)
      return hit === button.parentElement || button.contains(hit)
    }))
}

async function syncNativeInstance(api: NativeSwitchAPI, inst: NativeSwitchInstance, payload: NativeSwitchProps, key: string): Promise<void> {
  const { id, button } = inst
  try {
    const ok = inst.created ? await api.update(id, payload) : await api.create(id, payload)
    if (!nativeInstances.has(id)) {
      // A create may finish after the button's unmount and initial destroy.
      if (ok) await api.destroy(id)
      return
    }
    if (ok === null) {
      invalidateNativeSwitch(inst)
      return
    }
    if (!ok) {
      inst.dispose()
      return
    }
    inst.created = true
    if (inst.lastKey === key) {
      button.toggleAttribute('data-native-switch-visible', payload.visible)
    }
  } catch {
    inst.dispose()
  } finally {
    inst.pending = undefined
  }
}

function nativeSyncFrame(): void {
  frame = 0
  const api = window.nativeSwitch
  if (!api) return
  if (openOverlays || clearingSwitches) {
    frame = requestAnimationFrame(nativeSyncFrame)
    return
  }
  const zoom = api.getZoomFactor()
  const dark = document.documentElement.classList.contains('dark')
  const overlayOpen = isOverlayOpen()
  for (const inst of nativeInstances.values()) {
    const { button } = inst
    const rect = button.getBoundingClientRect()
    const { x, y, width, height } = rect
    // Native views cannot be clipped by web scroll containers or layered under portals.
    const visible = zoom === 1 && !overlayOpen && inst.fullyVisible && !button.matches(':focus-visible') &&
      button.checkVisibility({ visibilityProperty: true }) &&
      isSwitchExposed(button, rect)
    const on = button.getAttribute('aria-checked') === 'true'
    const enabled = !button.disabled
    const key = visible ? [x, y, width, height, on, enabled, dark].join('|') : 'hidden'
    if (!visible && inst.lastKey !== key) invalidateNativeSwitch(inst)
    if (inst.pending || (!visible && !inst.created)) continue
    if (key === inst.lastKey) continue
    inst.lastKey = key
    const pending = syncNativeInstance(api, inst, { x, y, width, height, visible, on, enabled, appearance: dark ? 'dark' : 'light' }, key)
    inst.pending = pending
    pendingUpdates.add(pending)
    void pending.then(() => pendingUpdates.delete(pending))
  }
  if (nativeInstances.size > 0) {
    frame = requestAnimationFrame(nativeSyncFrame)
  }
}

const Switch = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(function Switch(
  { className, ...props },
  forwardedRef,
) {
  const ref = React.useRef<HTMLButtonElement | null>(null)
  const setRef = React.useCallback((button: HTMLButtonElement | null) => {
    ref.current = button
    if (typeof forwardedRef === 'function') forwardedRef(button)
    else if (forwardedRef) forwardedRef.current = button
  }, [forwardedRef])
  React.useLayoutEffect(() => {
    const button = ref.current
    const api = window.nativeSwitch
    if (!button || !api?.available) return
    const id = nextSwitchId++
    const observer = new IntersectionObserver(([entry]) => {
      inst.fullyVisible = entry.isIntersecting && entry.intersectionRatio === 1
    }, { threshold: 1 })
    const unsubscribeGeometry = api.onGeometryChange(() => invalidateNativeSwitch(inst))
    const unsubscribeClick = api.onClick(id, () => {
      if (!button.isConnected || button.disabled || openOverlays || clearingSwitches ||
          api.getZoomFactor() !== 1 || isOverlayOpen() || !isSwitchExposed(button, button.getBoundingClientRect())) return
      button.focus({ preventScroll: true })
      if (button.isConnected) button.click()
      // The Radix button is authoritative, including when its click or change is rejected.
      inst.lastKey = ''
    })
    const inst: NativeSwitchInstance = {
      id,
      button,
      fullyVisible: false,
      created: false,
      lastKey: '',
      dispose: () => {
        if (!nativeInstances.delete(id)) return
        observer.disconnect()
        unsubscribeClick()
        unsubscribeGeometry()
        invalidateNativeSwitch(inst)
        // Destroy requests also cover a create that has been sent but hasn't replied.
        if (inst.created || inst.pending) void api.destroy(id).catch(() => undefined)
        if (nativeInstances.size === 0) {
          cancelAnimationFrame(frame)
          frame = 0
        }
      },
    }
    nativeInstances.set(id, inst)
    observer.observe(button)
    if (!frame) frame = requestAnimationFrame(nativeSyncFrame)
    return inst.dispose
  }, [])

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      ref={setRef}
      className={cn(
        "peer data-[state=checked]:bg-foreground data-[state=unchecked]:bg-foreground/25 focus-visible:border-foreground/30 focus-visible:ring-foreground/15 in-[.dark]:data-[state=unchecked]:bg-foreground/20 inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border border-transparent px-px transition-colors outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 data-[native-switch-visible]:opacity-0",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[18px] rounded-full bg-white shadow-xs transition-transform data-[state=checked]:translate-x-[16px] in-[.dark]:data-[state=checked]:bg-background motion-reduce:transition-none"
        )}
      />
    </SwitchPrimitive.Root>
  )
})

export { Switch }
