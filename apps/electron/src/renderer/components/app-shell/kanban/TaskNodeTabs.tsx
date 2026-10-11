/*
 * Adapted from Bencho's GlassIconBar: https://bencho.dev/blocks/icon-bar
 * MIT License — Copyright (c) 2026 Lorenzo Cabra
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import * as React from 'react'
import { ClipboardList, FileCheck2, History } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

const items = [
  { value: 'responsibility', label: 'tasks.graphResponsibilities', Icon: ClipboardList },
  { value: 'results', label: 'tasks.graphResults', Icon: FileCheck2 },
  { value: 'runtime', label: 'tasks.graphRecords', Icon: History },
]
type Indicator = { position: number; width: number }

export function TaskNodeTabs({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const track = React.useRef<HTMLDivElement>(null)
  const previous = React.useRef<Indicator>()
  const [indicator, setIndicator] = React.useState<Indicator>()
  const [phase, setPhase] = React.useState('idle')

  React.useLayoutEffect(() => {
    const button = track.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
    if (!button) return
    const target = { position: button.offsetLeft, width: button.offsetWidth }
    const from = previous.current
    previous.current = target
    let timer: number | undefined
    if (!from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('idle'); setIndicator(target)
    } else {
      const start = Math.min(from.position, target.position)
      const end = Math.max(from.position + from.width, target.position + target.width)
      setPhase('stretch'); setIndicator({ position: start, width: end - start })
      timer = window.setTimeout(() => {
        setPhase('settle'); setIndicator(target)
      }, 150)
    }
    const observer = new ResizeObserver(() => {
      const next = { position: button.offsetLeft, width: button.offsetWidth }
      if (next.position === previous.current?.position && next.width === previous.current.width) return
      window.clearTimeout(timer)
      previous.current = next
      setPhase('idle'); setIndicator(next)
    })
    if (track.current) observer.observe(track.current)
    return () => { window.clearTimeout(timer); observer.disconnect() }
  }, [value])

  return <div ref={track} className="mx-5 min-w-0 shrink-0">
    <TabsList className="task-inspector-tabs" aria-label={label}>
      <span className="task-inspector-tab-indicator" data-phase={phase} aria-hidden="true"
        style={indicator ? { transform: `translate3d(${indicator.position}px, 0, 0)`, width: indicator.width } : { opacity: 0 }} />
      {items.map(({ value: itemValue, label: labelKey, Icon }) => <Tooltip key={itemValue} delayDuration={400}>
        <TooltipTrigger asChild>
          <TabsTrigger value={itemValue} aria-label={t(labelKey)}>
            <span className="flex min-w-0 max-w-full items-center">
              <Icon size={18} className="shrink-0" aria-hidden="true" />
              <AnimatePresence initial={false}>
                {value === itemValue && <motion.span
                  key="label" aria-hidden="true"
                  className="min-w-0 overflow-hidden whitespace-nowrap text-xs font-medium"
                  initial={{ width: 0, marginLeft: 0, opacity: 0 }}
                  animate={{ width: 'auto', marginLeft: 6, opacity: 1 }}
                  exit={{ width: 0, marginLeft: 0, opacity: 0, transition: { duration: reduceMotion ? 0 : 0.16 } }}
                  transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                >{t(labelKey)}</motion.span>}
              </AnimatePresence>
            </span>
          </TabsTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t(labelKey)}</TooltipContent>
      </Tooltip>)}
    </TabsList>
  </div>
}
