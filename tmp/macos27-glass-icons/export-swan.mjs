#!/usr/bin/env bun
/**
 * Export the Selection swan as macOS 27 Liquid Glass PNGs via Icon Composer / ictool.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const REPO = join(ROOT, '../..')
const ICTOOL = '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool'
const OUT = join(ROOT, 'swan')
const ICON = join(OUT, 'SelectionSwan.icon')
const ASSETS = join(ICON, 'Assets')

const SOURCE_SVG = join(REPO, 'apps/electron/resources/icon.icon/Assets/icon.svg')
const BLACK_SWAN = join(REPO, 'apps/electron/src/renderer/assets/selection-swan-black.svg')
const WHITE_SWAN = join(REPO, 'apps/electron/src/renderer/assets/selection-swan-white.svg')

function extractPath(svg) {
  const match = svg.match(/<path[^>]*d="([^"]+)"/)
  if (!match) throw new Error('swan path missing')
  return match[1]
}

function canvasSwan(fill) {
  const d = extractPath(readFileSync(BLACK_SWAN, 'utf8'))
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(194 152) scale(5.625)">
    <path fill="${fill}" fill-rule="nonzero" d="${d}"/>
  </g>
</svg>
`
}

function iconJson(scale) {
  return {
    features: ['refractivity', 'specular-location'],
    'fill-specializations': [
      { value: { 'automatic-gradient': 'extended-srgb:1.00000,1.00000,1.00000,1.00000' } },
      { appearance: 'dark', value: { 'automatic-gradient': 'extended-srgb:0.09000,0.09000,0.10000,1.00000' } },
    ],
    groups: [
      {
        name: 'Swan',
        lighting: 'combined',
        layers: [
          {
            name: 'Swan',
            glass: true,
            'image-name-specializations': [
              { value: 'swan-black-1024.svg' },
              { appearance: 'dark', value: 'swan-white-1024.svg' },
            ],
            position: {
              scale,
              'translation-in-points': [0, 8],
            },
          },
        ],
        shadow: { kind: 'neutral', opacity: 0.4 },
        specular: true,
        'specular-highlight-placement': 'outside',
        translucency: { enabled: true, value: 0.32 },
        'blur-material': 0.36,
        refractivity: { enabled: true, depth: 0.45, strength: 0.5 },
      },
    ],
    'supported-platforms': {
      circles: ['watchOS'],
      squares: 'shared',
    },
  }
}

function exportImage(rendition, dest, generation = '27') {
  execFileSync(ICTOOL, [
    ICON,
    '--export-image',
    '--output-file', dest,
    '--platform', 'macOS',
    '--rendition', rendition,
    '--width', '1024',
    '--height', '1024',
    '--scale', '1',
    '--design-generation', generation,
  ], { stdio: 'pipe' })
}

function writePackage(scale) {
  mkdirSync(ASSETS, { recursive: true })
  writeFileSync(join(ASSETS, 'swan-black-1024.svg'), canvasSwan('#000000'))
  writeFileSync(join(ASSETS, 'swan-white-1024.svg'), canvasSwan('#FFFFFF'))
  copyFileSync(SOURCE_SVG, join(ASSETS, 'swan-source-1024.svg'))
  writeFileSync(join(ICON, 'icon.json'), JSON.stringify(iconJson(scale), null, 2))
}

mkdirSync(OUT, { recursive: true })

const scales = process.argv[2] ? [Number(process.argv[2])] : [1, 0.37, 37]
const results = []

for (const scale of scales) {
  writePackage(scale)
  const tag = String(scale).replace('.', 'p')
  try {
    exportImage('Default', join(OUT, `scale-${tag}-default.png`))
    exportImage('Dark', join(OUT, `scale-${tag}-dark.png`))
    results.push({ scale, ok: true })
    console.log('ok scale', scale)
  } catch (error) {
    results.push({ scale, ok: false, error: String(error.stderr || error) })
    console.error('fail scale', scale, error.stderr?.toString() || error.message)
  }
}

writeFileSync(join(OUT, 'export-log.json'), JSON.stringify(results, null, 2))
copyFileSync(BLACK_SWAN, join(OUT, 'swan-black.svg'))
copyFileSync(WHITE_SWAN, join(OUT, 'swan-white.svg'))
copyFileSync(SOURCE_SVG, join(OUT, 'swan-1024.svg'))
console.log('wrote', OUT)
