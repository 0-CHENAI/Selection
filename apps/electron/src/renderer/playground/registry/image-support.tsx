import * as React from 'react'
import { Check } from 'lucide-react'
import type { ComponentEntry } from './types'
import { ImageSupportWarningBanner } from '@/components/app-shell/input/ImageSupportWarningBanner'

function BannerDemo({
  modelName,
}: {
  modelName: string
}) {
  return (
    <div className="w-full max-w-[640px] mx-auto p-6">
      <div className="rounded-2xl border border-border/50 shadow-middle bg-background/40 backdrop-blur-sm">
        <ImageSupportWarningBanner modelName={modelName} />
        <div className="px-4 py-6 text-foreground/40 text-sm">
          Imagine the chat input here. Banner sits above any staged attachments.
        </div>
      </div>
    </div>
  )
}

interface PickerRowProps {
  modelName: string
  isSelected: boolean
}

function PickerRow({
  modelName,
  isSelected,
}: PickerRowProps) {
  return (
    <div className="w-[260px] mx-auto rounded-md bg-background/80 border border-border/50 px-1 py-1">
      <div className="flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer hover:bg-foreground/5">
        <div className="text-left">
          <div className="font-medium text-sm">{modelName}</div>
        </div>
        {isSelected && (
          <Check className="h-3 w-3 text-foreground ml-3 shrink-0" />
        )}
      </div>
    </div>
  )
}

export const imageSupportComponents: ComponentEntry[] = [
  {
    id: 'image-support-banner',
    name: 'Image Support — Pre-flight Banner',
    category: 'Chat Inputs',
    description:
      'Inline warning rendered above the chat input when the user has staged images on a custom-endpoint model that is configured as text-only.',
    component: BannerDemo,
    layout: 'centered',
    props: [
      {
        name: 'modelName',
        description: 'Display name of the active text-only model',
        control: { type: 'string' },
        defaultValue: 'qwen3-coder',
      },
    ],
    variants: [
      {
        name: 'Default',
        description: 'Generic text-only custom-endpoint model with images staged',
        props: { modelName: 'qwen3-coder' },
      },
      {
        name: 'Long model name',
        description: 'Verifies wrapping behaviour for long names',
        props: { modelName: 'minimax-text-01-very-long-id-no-images-here' },
      },
    ],
    mockData: () => ({}),
  },
  {
    id: 'image-support-picker-row',
    name: 'Image Support — Picker Row',
    category: 'Chat Inputs',
    description:
      'A single chat-input model picker row. Multimodal capability is configured in Settings, not here.',
    component: PickerRow,
    layout: 'centered',
    props: [
      {
        name: 'modelName',
        control: { type: 'string' },
        defaultValue: 'qwen3-coder',
      },
      {
        name: 'isSelected',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'Unselected',
        props: { modelName: 'Opus', isSelected: false },
      },
      {
        name: 'Selected',
        props: { modelName: 'Opus', isSelected: true },
      },
    ],
    mockData: () => ({}),
  },
]
