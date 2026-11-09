import { cn } from '@/lib/utils'

export function TitleSlug({
  title,
  slug,
  className,
}: {
  title: string
  slug: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate">{title}</div>
      <div className="truncate font-mono text-[11px] leading-tight text-muted-foreground">{slug}</div>
    </div>
  )
}
