import * as React from 'react'
import { createPortal } from 'react-dom'
import { X, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Tpl } from './data'

// Values mirrored from DSH Desktop packages/ppt-runtime/adapter/lib/client.js
// (OfficePptInputAccessory + ._selectionPreview / ._selectionFrame / ._selectionRemove)
export const DSH = {
  width: 92,                 // width: clamp(76px, 10vw, 92px); aspect-ratio 16/9
  restRotate: -3,            // transform: rotate(-3deg) scale(1)
  entryScale: 0.92,          // SELECTED_PREVIEW_ENTRY_TRANSFORM = rotate(-3deg) scale(.92)
  durationMs: 200,           // SELECTED_PREVIEW_DURATION_MS
  ease: [0.34, 1.56, 0.64, 1] as const, // transition: transform .2s cubic-bezier(.34,1.56,.64,1)
  radius: 9,                 // border-radius: 9px; border: 2px solid business-primary
  shadow: '0 4px 14px rgba(0,0,0,.18)', // box-shadow: 0 4px 14px #0000002e
  removeShadow: '0 3px 10px rgba(0,0,0,.28)',
}
export const TILT_SLOT_PAD = { left: 16, top: 16, bottom: 12 }
// attachment-row variant: a bit taller than the 64px PDF chip, bottoms aligned
export const ATTACH_CARD = { width: 124, pad: { left: 2, top: 0, bottom: 0 }, gap: 8 }
// fanned inner pages (card-local px / deg, transform-origin 20% 80%)
export const FAN = [{ r: 8, x: 12, y: -3 }, { r: 4, x: 6, y: -1.5 }]
export const CTRL = { size: 20, xOff: 8, menuOff: 9 } // × at top/right −8, ⋯ at right/bottom −9
/** Min visual gap (hover worst case; ≈12px at rest) between the outermost painted pixel of the tilted card (pages / × / ⋯) and the next chip. */
export const VISUAL_GAP = 10

/**
 * Exact painted extent of the tilted card in its own untransformed box coords
 * (0..width × 0..h), covering the cover, both fanned pages and the × / ⋯ circles,
 * for the worst case (hover: rotate −1.5deg, scale 1.03) and rest (−3deg, scale 1).
 */
export function tiltExtent(width: number) {
  const h = width * 9 / 16
  const rad = (d: number) => d * Math.PI / 180
  const rot = (p: [number, number], o: [number, number], d: number): [number, number] => {
    const c = Math.cos(rad(d)), s = Math.sin(rad(d)), x = p[0] - o[0], y = p[1] - o[1]
    return [o[0] + x * c - y * s, o[1] + x * s + y * c]
  }
  const corners: [number, number][] = [[0, 0], [width, 0], [width, h], [0, h]]
  const local: [number, number][] = [...corners]
  for (const f of FAN) for (const p of corners) { const q = rot(p, [0.2 * width, 0.8 * h], f.r); local.push([q[0] + f.x, q[1] + f.y]) }
  const r = CTRL.size / 2
  const circles: [number, number][] = [[width + CTRL.xOff - r, -CTRL.xOff + r], [width + CTRL.menuOff - r, h + CTRL.menuOff - r]]
  let right = -Infinity, top = Infinity, left = Infinity, bottom = -Infinity
  for (const [deg, sc] of [[DSH.restRotate, 1], [DSH.restRotate + 1.5, 1.03]]) {
    const c: [number, number] = [width / 2, h / 2]
    const tf = (p: [number, number]): [number, number] => { const q = rot(p, c, deg); return [c[0] + (q[0] - c[0]) * sc, c[1] + (q[1] - c[1]) * sc] }
    for (const p of local) { const q = tf(p); right = Math.max(right, q[0]); left = Math.min(left, q[0]); top = Math.min(top, q[1]); bottom = Math.max(bottom, q[1]) }
    for (const p of circles) { const q = tf(p); right = Math.max(right, q[0] + r * sc); top = Math.min(top, q[1] - r * sc) }
  }
  return { right, left, top, bottom, overhangRight: right - width, overhangTop: -top }
}
/** Trailing space after the card box so the next chip starts VISUAL_GAP px after the outermost painted pixel (row gap included). */
export function attachTrail(width = ATTACH_CARD.width) {
  return Math.ceil(tiltExtent(width).overhangRight + VISUAL_GAP - ATTACH_CARD.gap)
}

export function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-6 || d === 0) break; t -= e / d }
    return sy(t)
  }
}
export const dshEase = cubicBezier(...DSH.ease)

/** Selected-template card that sits at the start of the prompt row (DSH: conversation.input.accessory). */
export function TiltedTemplate({ tpl, pages, hover = 0, settle = 1, spread = 1, opacity = 1, slotWidth, menu, width = DSH.width, pad = TILT_SLOT_PAD, trail = 10, collapse }: {
  tpl: Tpl; pages: string[]; hover?: number; settle?: number; spread?: number; opacity?: number; slotWidth?: number; menu?: React.ReactNode
  width?: number; pad?: { left: number; top: number; bottom: number }; trail?: number; collapse?: number
}) {
  const h = width * 9 / 16
  const scale = (DSH.entryScale + (1 - DSH.entryScale) * dshEase(settle)) * (1 + 0.03 * hover)
  const rot = DSH.restRotate + 1.5 * hover
  const showControls = hover > 0 || !!menu
  return <div data-tilt-slot className="shrink-0 self-end overflow-visible" style={{ marginRight: collapse === undefined ? undefined : -ATTACH_CARD.gap * (1 - collapse), width: slotWidth ?? (width + pad.left + trail), paddingLeft: pad.left, paddingTop: pad.top, paddingBottom: pad.bottom }}>
    <span aria-label={`已选模板：${tpl.title}`} className="relative block" style={{ width, height: h, transformOrigin: '50% 50%', transform: `rotate(${rot}deg) scale(${scale})`, opacity }}>
      {/* two inner pages fanned behind the cover */}
      {[{ src: pages[1], ...FAN[0] }, { src: pages[0], ...FAN[1] }].map((p, i) => <span key={i} className="absolute inset-0 overflow-hidden bg-white"
        style={{ borderRadius: DSH.radius - 1, border: '1px solid rgba(0,0,0,.08)', boxShadow: '0 2px 6px rgba(0,0,0,.10)', transform: `translate(${p.x * spread}px, ${p.y * spread}px) rotate(${p.r * spread}deg)`, transformOrigin: '20% 80%' }}>
        <img src={p.src} className="h-full w-full object-cover" />
      </span>)}
      <span className="absolute inset-0 block overflow-hidden bg-background" style={{ borderRadius: DSH.radius, border: '2px solid var(--accent)', boxShadow: DSH.shadow }}>
        <img src={tpl.thumb} className="h-full w-full object-cover" />
      </span>
      <button aria-label="移除模板" className="absolute z-[2] grid place-items-center rounded-full text-white"
        style={{ top: -CTRL.xOff, right: -CTRL.xOff, width: CTRL.size, height: CTRL.size, background: 'rgba(17,17,17,.88)', border: '1px solid rgba(255,255,255,.3)', boxShadow: DSH.removeShadow, opacity: showControls ? Math.max(hover, menu ? 1 : 0) : 0, transform: `rotate(3deg) scale(${0.88 + 0.12 * Math.max(hover, menu ? 1 : 0)})` }}>
        <X className="size-3" strokeWidth={2.5} />
      </button>
      {(menu || hover > 0) && <span className="absolute z-[2]" style={{ right: -CTRL.menuOff, bottom: -CTRL.menuOff, transform: `rotate(3deg) scale(${menu ? 1 : 0.88 + 0.12 * hover})`, opacity: menu ? 1 : hover }}>{menu ?? <MenuDot />}</span>}
    </span>
  </div>
}

export const MenuDot = React.forwardRef<HTMLButtonElement, { open?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>>(function MenuDot({ open, className, ...rest }, ref) {
  return <button ref={ref} {...rest} aria-label="模板选项" className={cn(className, 'grid size-5 place-items-center rounded-full bg-background text-foreground/70 shadow-minimal ring-1 ring-border', open && 'ring-accent/40 text-accent')}>
    <MoreHorizontal className="size-3.5" />
  </button>
})

/** Damped spring (k=230, c=22, m=1 → ζ≈0.73), used for the gallery→input flight. */
export function spring(t: number) {
  if (t <= 0) return 0
  const k = 230, c = 22, w0 = Math.sqrt(k), z = c / (2 * w0), wd = w0 * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t))
}

export function FakeCursor({ x, y, pressed }: { x: number; y: number; pressed?: boolean }) {
  return createPortal(<svg width="22" height="22" viewBox="0 0 22 22" className="pointer-events-none fixed z-[200]" style={{ left: x - 4, top: y - 2, transform: `scale(${pressed ? 0.88 : 1})`, transformOrigin: '4px 2px', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.35))' }}>
    <path d="M4 2 L4 18 L8.2 14.2 L11 20.5 L13.6 19.4 L10.9 13.2 L16.6 13.2 Z" fill="#111" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>, document.body)
}
