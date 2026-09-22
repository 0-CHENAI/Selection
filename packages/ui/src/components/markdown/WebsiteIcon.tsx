import * as React from 'react'
import { Globe } from 'lucide-react'

/** Only send public hostnames to the favicon service, never paths or credentials. */
export function websiteIconUrl(href: string): string | null {
  try {
    const url = new URL(href)
    if (!['https:', 'http:'].includes(url.protocol)) return null
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (!host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')
      || host.endsWith('.internal') || host.endsWith('.test') || host.includes(':')
      || /^[\d.]+$/.test(host)) return null
    // Same favicon service used by the application's source logos.
    return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=32&url=${encodeURIComponent(`https://${host}`)}`
  } catch {
    return null
  }
}

/** Decorative, inline favicon; fixed geometry avoids moving link text on load. */
export function WebsiteIcon({ href }: { href: string }) {
  const src = websiteIconUrl(href)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = React.useState<string | null>(null)
  return (
    <span aria-hidden="true" className="relative mr-1 inline-flex size-[1em] overflow-hidden rounded-full bg-foreground/[0.06] align-[-0.125em]">
      {(!src || loadedSrc !== src || failedSrc === src) && <Globe className="absolute inset-0 size-full text-muted-foreground" />}
      {src && failedSrc !== src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 !m-0 !inline-block !size-full rounded-full object-contain opacity-0"
          onLoad={event => { event.currentTarget.style.opacity = '1'; setLoadedSrc(src) }}
          onError={() => setFailedSrc(src)}
        />
      )}
    </span>
  )
}
