#!/usr/bin/env bun
/**
 * Official macOS 27 conversion: keep the original flat swan,
 * let Icon Composer apply default Liquid Glass. No restyled glyph.
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
const SOURCE = join(REPO, 'apps/electron/resources/icon.icon/Assets/icon.svg')
const BLACK = join(REPO, 'apps/electron/src/renderer/assets/selection-swan-black.svg')

function extractPath(svg) {
  return svg.match(/<path[^>]*d="([^"]+)"/)[1]
}

function canvasSwan(fill) {
  const d = extractPath(readFileSync(BLACK, 'utf8'))
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(194 152) scale(5.625)">
    <path fill="${fill}" fill-rule="nonzero" d="${d}"/>
  </g>
</svg>
`
}

/** Closest to Xcode's Icon Composer template + Apple's import defaults. */
const official = {
  features: ['refractivity', 'specular-location'],
  'fill-specializations': [
    { value: { 'automatic-gradient': 'srgb:1.00000,1.00000,1.00000,1.00000' } },
    { appearance: 'dark', value: { 'automatic-gradient': 'srgb:0.00000,0.00000,0.00000,1.00000' } },
  ],
  groups: [
    {
      layers: [
        {
          name: 'icon',
          glass: true,
          'image-name-specializations': [
            { value: 'icon.svg' },
            { appearance: 'dark', value: 'icon-dark.svg' },
          ],
        },
      ],
      shadow: { kind: 'neutral', opacity: 0.5 },
      specular: true,
      translucency: { enabled: false, value: 0.5 },
    },
  ],
  'supported-platforms': {
    circles: ['watchOS'],
    squares: 'shared',
  },
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
copyFileSync(SOURCE, join(ASSETS, 'icon.svg'))
writeFileSync(join(ASSETS, 'icon-dark.svg'), canvasSwan('#FFFFFF'))
writeFileSync(join(ICON, 'icon.json'), JSON.stringify(official, null, 2))

exportPng('Default', join(OUT, 'swan-mac27-default.png'))
exportPng('Dark', join(OUT, 'swan-mac27-dark.png'))
try {
  exportPng('TintedDark', join(OUT, 'swan-mac27-TintedDark-1024.png'))
} catch {
  console.log('no TintedDark')
}

copyFileSync(join(OUT, 'swan-mac27-default.png'), join(OUT, 'official-default.png'))
copyFileSync(join(OUT, 'swan-mac27-dark.png'), join(OUT, 'official-dark.png'))
console.log('wrote official conversion')
