import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { MoreHorizontal, X } from 'lucide-react'
import type { PptRequest, PptTemplate } from '@craft-agent/shared/protocol'
import { pptComposerAtomFamily, pptComposerOverrideAtomFamily } from '@/atoms/ppt'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { resolvePptTemplate } from './template-lookup'
import { usePptCatalog } from './usePptCatalog'
import { TemplateOptions } from './TemplateOptions'
import { attachTrail, CARD_HEIGHT, CARD_WIDTH, CTRL, FAN, tiltExtent } from './geometry'
import './ppt-picker.css'

export function SelectedTemplate({ composerKey, disabled }: { composerKey: string; disabled?: boolean }) {
  const [, setRequest] = useAtom(pptComposerAtomFamily(composerKey))
  const override = useAtomValue(pptComposerOverrideAtomFamily(composerKey))
  const { catalog } = usePptCatalog()
  const template = resolvePptTemplate(catalog?.templates, override?.templateId)
  if (!override?.templateId || !template) return null
  return <TemplateCard template={template} composerKey={composerKey} disabled={disabled} onRemove={() => setRequest(null)} />
}

function TemplateCard({ template, composerKey, disabled, onRemove }: { template: PptTemplate; composerKey: string; disabled?: boolean; onRemove: () => void }) {
  const { t } = useTranslation()
  const [request, setRequest] = useAtom(pptComposerAtomFamily(composerKey))
  const { catalog } = usePptCatalog()
  const patch = (value: Partial<PptRequest>) => setRequest(previous => ({ ...previous, ...value }))
  const parent = catalog?.templates.find(item => item.id === template.id || item.variants?.some(variant => variant.id === template.id))
  return <AttachedCoverCard
    id={template.id}
    cover={template.cover}
    pages={template.referencePages}
    title={template.title}
    label={t('ppt.selectedTemplate', { title: template.title })}
    flightKey={composerKey}
    disabled={disabled}
    onRemove={onRemove}
    removeLabel={t('ppt.removeTemplate')}
    menuLabel={t('ppt.options')}
    menuClassName="w-[300px] p-1.5"
    testIds={{ root: 'ppt-selected-template', remove: 'ppt-remove-template', menu: 'ppt-template-options', panel: 'ppt-options-panel' }}
    menu={() => <TemplateOptions request={request ?? undefined} themes={catalog?.themes ?? []} variants={parent?.variants} baseTemplate={parent?.variants?.length ? { id: parent.id, title: parent.title } : undefined} onChange={patch} />}
  />
}

export interface AttachedCoverCardProps {
  /** Changes when a different item is attached; replays the pop-in. */
  id: string
  cover: string
  /** Pages fanned behind the cover; the cover repeats when there are fewer. */
  pages?: readonly string[]
  title: string
  label: string
  flightKey: string
  disabled?: boolean
  onRemove: () => void
  removeLabel: string
  menuLabel: string
  /** Popover content behind ⋯. `close` hides the popover. */
  menu: (close: () => void) => React.ReactNode
  menuClassName?: string
  testIds: { root: string; remove: string; menu: string; panel: string }
}

/** The attached-template card in the input box: tilted cover over fanned pages, × to remove, ⋯ for a menu. Shared by PPT and Word / Excel. */
export function AttachedCoverCard({ id, cover, pages = [], title, label, flightKey, disabled, onRemove, removeLabel, menuLabel, menu, menuClassName, testIds }: AttachedCoverCardProps) {
  const reduced = useReducedMotion()
  const [open, setOpen] = React.useState(false)
  const [hover, setHover] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const extent = tiltExtent(CARD_WIDTH)
  const tilt = hover ? -1.5 : -3
  const left = Math.ceil(Math.max(2, -extent.left))
  React.useLayoutEffect(() => {
    const target = ref.current
    const source = consumeTemplateFlight(flightKey)
    if (!target || reduced || !source) return
    const destination = target.getBoundingClientRect()
    const image = document.createElement('img')
    image.src = cover
    image.className = 'ppt-template-flight'
    Object.assign(image.style, { position: 'fixed', left: `${source.x}px`, top: `${source.y}px`, width: `${source.width}px`, height: `${source.height}px`, objectFit: 'cover', borderRadius: '9px', pointerEvents: 'none' })
    document.body.appendChild(image)
    const animation = image.animate([{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }, { transform: `translate(${destination.x - source.x}px, ${destination.y - source.y}px) rotate(-3deg)`, width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px`, opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.22,.75,.25,1)' })
    animation.onfinish = () => image.remove()
    return () => { animation.cancel(); image.remove() }
  }, [id, cover, flightKey, reduced])
  return <motion.div layout={!reduced} data-testid={testIds.root} className="relative h-16 shrink-0 self-end" style={{ width: CARD_WIDTH + attachTrail() + left }}>
    <motion.div ref={ref} key={id} initial={reduced ? false : { scale: .92, rotate: -3 }} animate={{ scale: hover ? 1.03 : 1, rotate: tilt }} transition={{ duration: reduced ? 0 : .2, ease: [.34, 1.56, .64, 1] }} className="absolute" style={{ width: CARD_WIDTH, height: CARD_HEIGHT, left, top: `calc(50% - ${CARD_HEIGHT / 2}px)` }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocusCapture={() => setHover(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHover(false) }} aria-label={label}>
      {FAN.map((fan, index) => <span key={index} className="absolute inset-0 overflow-hidden rounded-lg border border-black/10 bg-background shadow-minimal" style={{ transform: `translate(${fan.x}px,${fan.y}px) rotate(${fan.r}deg)`, transformOrigin: '20% 80%' }}><img src={pages[index] ?? cover} alt="" className="h-full w-full object-cover" /></span>)}
      <span className="ppt-template-cover absolute inset-0 overflow-hidden rounded-[9px] border-2 border-accent bg-background"><img src={cover} alt={title} className="h-full w-full object-cover" /></span>
      <button type="button" data-testid={testIds.remove} disabled={disabled} onClick={onRemove} aria-label={removeLabel} className="ppt-template-remove absolute z-10 grid place-items-center rounded-full border border-white/30 bg-black/90 text-white transition-opacity motion-reduce:transition-none" style={{ top: -CTRL.xOff, right: -CTRL.xOff, width: CTRL.size, height: CTRL.size, opacity: hover || open ? 1 : 0, transform: `rotate(${-tilt}deg)` }}><X className="size-3" /></button>
      <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" disabled={disabled} data-testid={testIds.menu} aria-label={menuLabel} className="absolute z-10 grid size-5 place-items-center rounded-full border border-border bg-background text-foreground shadow-minimal" style={{ right: -CTRL.menuOff, bottom: -CTRL.menuOff, transform: `rotate(${-tilt}deg)` }}><MoreHorizontal className="size-3.5" /></button></PopoverTrigger>
        <PopoverContent side="bottom" align="start" className={menuClassName ?? 'w-[300px] p-1.5'} data-testid={testIds.panel}>
          {menu(() => setOpen(false))}
        </PopoverContent>
      </Popover>
    </motion.div>
  </motion.div>
}

const flights = new Map<string, DOMRect>()
export function queueTemplateFlight(key: string, source: DOMRect) { flights.set(key, source) }
export function consumeTemplateFlight(key: string) { const source = flights.get(key); flights.delete(key); return source }
