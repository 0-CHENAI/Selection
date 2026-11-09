import { selectionProGlyphPath } from '@/assets/selection-pro-glyph'

export function ProIdentityGlyph({ id }: { id: string }) {
  return (
    <svg className="pro-identity-mode" viewBox="32 10 104 30.5">
      <defs>
        <path id={`${id}-glyph`} d={selectionProGlyphPath} />
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--pro-glass-highlight)" />
          <stop offset="0.24" stopColor="currentColor" stopOpacity="0.85" />
          <stop offset="0.47" stopColor="var(--pro-glass-highlight)" stopOpacity="0.8" />
          <stop offset="0.54" stopColor="currentColor" stopOpacity="0.42" />
          <stop offset="0.8" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="1" stopColor="var(--pro-glass-highlight)" />
        </linearGradient>
        <linearGradient id={`${id}-light`} className="pro-identity-reflection"
          gradientUnits="userSpaceOnUse" x1="32" y1="27" x2="136" y2="27" gradientTransform="rotate(-28 84 27)">
          <stop offset="0.45" stopColor="var(--pro-glass-reflection)" stopOpacity="0" />
          <stop offset="0.72" stopColor="var(--pro-glass-reflection)" stopOpacity="0.3" />
          <stop offset="0.84" stopColor="var(--pro-glass-reflection)" />
          <stop offset="1" stopColor="var(--pro-glass-reflection)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="pro-identity-ink">
        <use href={`#${id}-glyph`} fill="currentColor" className="pro-identity-base" />
        <use href={`#${id}-glyph`} fill={`url(#${id}-body)`} className="pro-identity-glass" />
        <use href={`#${id}-glyph`} fill={`url(#${id}-light)`} opacity="0.45" />
        <use href={`#${id}-glyph`} className="pro-identity-rim" fill="none" stroke={`url(#${id}-light)`} />
      </g>
      <use href={`#${id}-glyph`} className="pro-identity-edge-trace" fill="none"
        stroke="var(--pro-glass-reflection)" strokeWidth="1.1" strokeLinecap="round" strokeDasharray="18 78" />
    </svg>
  )
}
