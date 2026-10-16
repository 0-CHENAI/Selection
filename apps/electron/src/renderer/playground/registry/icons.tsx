import type { ComponentEntry } from './types'
import { CraftAgentsLogo } from '@/components/icons/CraftAgentsLogo'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { PanelLeftRounded } from '@/components/icons/PanelLeftRounded'
import { SquarePenRounded } from '@/components/icons/SquarePenRounded'
import { ConnectionIcon } from '@/components/icons/ConnectionIcon'

function ConnectionIconSamples() {
  const rows = [
    {
      name: 'ORDER',
      providerType: 'pi_compat' as const,
      baseUrl: 'https://order.ai.jxepdi.top/v1',
      piAuthProvider: 'openai',
    },
    {
      name: 'DeepSeek',
      providerType: 'pi' as const,
      piAuthProvider: 'deepseek',
    },
    {
      name: 'Amazon Bedrock',
      providerType: 'pi' as const,
      piAuthProvider: 'amazon-bedrock',
    },
  ]
  return (
    <div className="w-[420px] overflow-hidden rounded-xl bg-background shadow-minimal">
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-2 border-b border-border/40 px-4 py-3 last:border-b-0">
          <ConnectionIcon connection={row} size={14} />
          <span className="text-sm font-medium">{row.name}</span>
        </div>
      ))}
    </div>
  )
}

export const iconComponents: ComponentEntry[] = [
  {
    id: 'connection-icon-samples',
    name: 'Connection icons',
    category: 'Icons',
    description: 'Provider marks used in the connection list, including ORDER',
    component: ConnectionIconSamples,
    props: [],
    variants: [],
  },
  {
    id: 'craft-agents-logo',
    name: 'CraftAgentsLogo',
    category: 'Icons',
    description: 'Selection swan product mark',
    component: CraftAgentsLogo,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes for sizing and styling',
        control: { type: 'string' },
        defaultValue: 'h-8',
      },
    ],
    variants: [
      { name: 'Small', props: { className: 'h-6' } },
      { name: 'Medium', props: { className: 'h-8' } },
      { name: 'Large', props: { className: 'h-12' } },
    ],
  },
  {
    id: 'craft-agents-symbol',
    name: 'CraftAgentsSymbol',
    category: 'Icons',
    description: 'Selection swan product mark',
    component: CraftAgentsSymbol,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes for sizing',
        control: { type: 'string' },
        defaultValue: 'h-6 w-6',
      },
    ],
    variants: [
      { name: 'Small', props: { className: 'h-4 w-4' } },
      { name: 'Medium', props: { className: 'h-6 w-6' } },
      { name: 'Large', props: { className: 'h-10 w-10' } },
    ],
  },
  {
    id: 'panel-left-rounded',
    name: 'PanelLeftRounded',
    category: 'Icons',
    description: 'Sidebar toggle icon with rounded corners',
    component: PanelLeftRounded,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes',
        control: { type: 'string' },
        defaultValue: 'h-5 w-5',
      },
    ],
    variants: [
      { name: 'Default', props: { className: 'h-5 w-5' } },
      { name: 'Large', props: { className: 'h-8 w-8' } },
      { name: 'Muted', props: { className: 'h-5 w-5 text-muted-foreground' } },
    ],
  },
  {
    id: 'square-pen-rounded',
    name: 'SquarePenRounded',
    category: 'Icons',
    description: 'New chat/compose icon with rounded corners',
    component: SquarePenRounded,
    props: [
      {
        name: 'className',
        description: 'Tailwind classes',
        control: { type: 'string' },
        defaultValue: 'h-5 w-5',
      },
    ],
    variants: [
      { name: 'Default', props: { className: 'h-5 w-5' } },
      { name: 'Large', props: { className: 'h-8 w-8' } },
      { name: 'Primary', props: { className: 'h-5 w-5 text-foreground' } },
    ],
  },
]
