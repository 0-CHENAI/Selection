"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import type { NativeSwitchProps } from "../../../shared/types"
import { hasOpenOverlay } from "@/lib/overlay-detection"
import { cn } from "@/lib/utils"

interface NativeSwitchInstance {
  id: number
  button: HTMLButtonElement
  fullyVisible: boolean
  pending: boolean
  created: boolean
  lastKey: string
  dispose: () => void
}

const nativeInstances = new Map<number, NativeSwitchInstance>()
let frame = 0
let nextSwitchId = 1

async function syncNativeInstance(inst: NativeSwitchInstance, payload: NativeSwitchProps): Promise<void> {
  const api = window.nativeSwitch
  if (!api) return
  inst.pending = true
  try {
    const ok = inst.created ? await api.update(inst.id, payload) : await api.create(inst.id, payload)
    if (!ok) throw new Error('Native switch unavailable')
    inst.created = true
    if (!nativeInstances.has(inst.id)) {
      await api.destroy(inst.id)
      return
    }
    inst.button.toggleAttribute('data-native-switch-visible', payload.visible)
  } catch {
    inst.dispose()
  } finally {
    inst.pending = false
  }
}

function nativeSyncFrame(): void {
  frame = 0
  const dark = document.documentElement.classList.contains('dark')
  const overlayOpen = hasOpenOverlay() || Boolean(document.querySelector(
    '[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]'
  ))
  for (const inst of nativeInstances.values()) {
    if (inst.pending) continue
    const { button } = inst
    const { x, y, width, height } = button.getBoundingClientRect()
    // Native views cannot be clipped by web scroll containers or layered under portals.
    const visible = !overlayOpen && inst.fullyVisible && !button.matches(':focus-visible') &&
      button.checkVisibility({ visibilityProperty: true }) &&
      x >= 0 && y >= 0 && x + width <= window.innerWidth && y + height <= window.innerHeight
    if (!visible && !inst.created) continue
    const on = button.getAttribute('aria-checked') === 'true'
    const enabled = !button.disabled
    const key = [x, y, width, height, visible, on, enabled, dark, window.devicePixelRatio].join('|')
    if (key === inst.lastKey) continue
    inst.lastKey = key
    void syncNativeInstance(inst, { x, y, width, height, visible, on, enabled, appearance: dark ? 'dark' : 'light' })
  }
  if (nativeInstances.size > 0) {
    frame = requestAnimationFrame(nativeSyncFrame)
  }
}

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useLayoutEffect(() => {
    const button = ref.current
    const api = window.nativeSwitch
    if (!button || !api?.available) return
    const id = nextSwitchId++
    const observer = new IntersectionObserver(([entry]) => {
      inst.fullyVisible = entry.isIntersecting && entry.intersectionRatio >= 0.999
    }, { threshold: 0.999 })
    const unsubscribe = api.onChange(id, (on) => {
      if ((button.getAttribute('aria-checked') === 'true') !== on) button.click()
      // A controlled switch may reject the change; reassert the DOM state.
      inst.lastKey = ''
    })
    const inst: NativeSwitchInstance = {
      id,
      button,
      fullyVisible: false,
      pending: false,
      created: false,
      lastKey: '',
      dispose: () => {
        if (!nativeInstances.delete(id)) return
        observer.disconnect()
        unsubscribe()
        button.removeAttribute('data-native-switch-visible')
        if (inst.created) void api.destroy(id).catch(() => undefined)
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
      ref={ref}
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
}

export { Switch }
