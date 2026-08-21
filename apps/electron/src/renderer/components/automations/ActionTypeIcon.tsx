import { Ban, MessageSquare, Shield, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ActionTypeIcon({ type, className }: { type: 'prompt' | 'webhook' | 'decision'; className?: string }) {
  const Icon = type === 'webhook' ? Webhook : type === 'decision' ? Shield : MessageSquare
  return <Icon className={cn('text-foreground/50', className)} />
}

export function DecisionActionIcon({ decision, className }: { decision: 'block' | 'modify'; className?: string }) {
  const Icon = decision === 'block' ? Ban : Shield
  return <Icon className={cn('text-foreground/50', className)} />
}
