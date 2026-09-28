#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const REPO = join(ROOT, '../..')
const ICTOOL = '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool'
const OUT = join(ROOT, 'swan')
const ICON = join(OUT, 'SelectionSwan.icon')
const ASSETS = join(ICON, 'Assets')
const BLACK_SWAN = join(REPO, 'apps/electron/src/renderer/assets/selection-swan-black.svg')

function extractPath(svg) {
  const match = svg.match(/<path[^>]*d="([^"]+)"/)
  if (!match) throw new Error('swan path missing')
  return match[1]
}

const PATH = extractPath(readFileSync(BLACK_SWAN, 'utf8'))

function canvasSwan({ fill = '#000', stroke = fill, strokeWidth = 0 } = {}) {
  const strokeAttrs = strokeWidth
    ? ` stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"`
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(194 152) scale(5.625)">
    <path fill="${fill}" fill-rule="nonzero" d="${PATH}"${strokeAttrs}/>
  </g>
</svg>
`
}

function srgb(r, g, b, a = 1) {
  return `extended-srgb:${[r, g, b, a].map((n) => n.toFixed(5)).join(',')}`
}

const VARIANTS = {
  'crystal-emboss': {
    fill: [
      { value: { 'automatic-gradient': srgb(0.82, 0.85, 0.90) } },
      { appearance: 'dark', value: { 'automatic-gradient': srgb(0.07, 0.07, 0.09) } },
    ],
    layers: [
      { name: 'Swan', file: 'swan-thick-white.svg', fill: srgb(1, 1, 1), glass: true, specular: 'inside' },
    ],
    lighting: 'individual',
    specular: 'inside',
    translucency: 0.62,
    blur: 0.72,
    refraction: { depth: 0.85, strength: 0.9 },
  },
  'dark-glass-tube': {
    fill: [
      { value: { 'automatic-gradient': srgb(1, 1, 1) } },
      { appearance: 'dark', value: { 'automatic-gradient': srgb(0.08, 0.08, 0.1) } },
    ],
    layers: [
      { name: 'Swan', file: 'swan-thick-black.svg', fill: srgb(0.18, 0.20, 0.24), glass: true, specular: 'inside' },
    ],
    lighting: 'individual',
    specular: 'inside',
    translucency: 0.48,
    blur: 0.58,
    refraction: { depth: 0.75, strength: 0.8 },
  },
  'stacked-glass': {
    fill: [
      { value: { 'automatic-gradient': srgb(0.93, 0.95, 0.98) } },
      { appearance: 'dark', value: { 'automatic-gradient': srgb(0.08, 0.08, 0.1) } },
    ],
    layers: [
      { name: 'Body', file: 'swan-heavy-white.svg', fill: srgb(0.78, 0.84, 0.92), glass: true, specular: 'outside' },
      { name: 'Ridge', file: 'swan-thick-white.svg', fill: srgb(1, 1, 1), glass: true, specular: 'inside' },
    ],
    lighting: 'individual',
    specular: 'inside',
    translucency: 0.7,
    blur: 0.68,
    refraction: { depth: 0.9, strength: 0.95 },
  },
}

function iconJson(variant) {
  return {
    features: ['refractivity', 'specular-location'],
    'fill-specializations': variant.fill,
    groups: [
      {
        name: 'Swan',
        lighting: variant.lighting,
        layers: variant.layers.map((layer) => ({
          name: layer.name,
          'image-name': layer.file,
          glass: layer.glass,
          fill: { solid: layer.fill },
          specular: layer.specular,
          'specular-highlight-placement': layer.specular,
          position: { scale: 1, 'translation-in-points': [0, 8] },
        })),
        shadow: { kind: 'layer-color', opacity: 0.55 },
        specular: variant.specular,
        'specular-highlight-placement': variant.specular,
        translucency: { enabled: true, value: variant.translucency },
        'blur-material': variant.blur,
        refractivity: { enabled: true, depth: variant.refraction.depth, strength: variant.refraction.strength },
      },
    ],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  }
}

function exportPng(rendition, dest) {
  execFileSync(ICTOOL, [
    ICON, '--export-image', '--output-file', dest,
    '--platform', 'macOS', '--rendition', rendition,
    '--width', '1024', '--height', '1024', '--scale', '1',
    '--design-generation', '27',
  ], { stdio: 'pipe' })
}

mkdirSync(ASSETS, { recursive: true })
writeFileSync(join(ASSETS, 'swan-thick-black.svg'), canvasSwan({ fill: '#000', strokeWidth: 5 }))
writeFileSync(join(ASSETS, 'swan-thick-white.svg'), canvasSwan({ fill: '#fff', stroke: '#fff', strokeWidth: 5 }))
writeFileSync(join(ASSETS, 'swan-heavy-white.svg'), canvasSwan({ fill: '#fff', stroke: '#fff', strokeWidth: 9 }))

for (const [name, variant] of Object.entries(VARIANTS)) {
  writeFileSync(join(ICON, 'icon.json'), JSON.stringify(iconJson(variant), null, 2))
  exportPng('Default', join(OUT, `${name}-default.png`))
  exportPng('Dark', join(OUT, `${name}-dark.png`))
  console.log('ok', name)
}
