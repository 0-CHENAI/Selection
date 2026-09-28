#!/usr/bin/env bun
/**
 * Generate macOS 27 Liquid Glass file-type icons.
 *
 * - composer/*.icon  Icon Composer packages (true system glass via ictool)
 * - png/*.png        Flattened Default / Dark renders
 * - svg/*.svg        Standalone glass document pages (no Icon Composer needed)
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ICTOOL = '/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool'

const KINDS = [
  { id: 'word', mark: 'W', hex: '#2B7DE9', dark: '#1D4ED8' },
  { id: 'excel', mark: 'X', hex: '#1D7A41', dark: '#166534' },
  { id: 'powerpoint', mark: 'P', hex: '#D24726', dark: '#B91C1C' },
  { id: 'pdf', mark: 'PDF', hex: '#E11D2E', dark: '#B91C1C' },
  { id: 'markdown', mark: 'MD', hex: '#64748B', dark: '#475569' },
  { id: 'text', mark: 'TXT', hex: '#6B7280', dark: '#4B5563' },
  { id: 'image', mark: '', hex: '#7C3AED', dark: '#6D28D9', glyph: 'image' },
  { id: 'code', mark: '', hex: '#0F766E', dark: '#115E59', glyph: 'code' },
  { id: 'archive', mark: '', hex: '#B45309', dark: '#92400E', glyph: 'archive' },
  { id: 'audio', mark: '', hex: '#DB2777', dark: '#BE185D', glyph: 'audio' },
  { id: 'video', mark: '', hex: '#6D28D9', dark: '#5B21B6', glyph: 'video' },
  { id: 'file', mark: '', hex: '#78716C', dark: '#57534E', glyph: 'file' },
]

function hexToSrgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  const parts = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
  return `extended-srgb:${parts.map((v) => v.toFixed(5)).join(',')}`
}

function mix(hex, other, amount) {
  const a = Number.parseInt(hex.slice(1), 16)
  const b = Number.parseInt(other.slice(1), 16)
  const ch = (shift) => Math.round((((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount))
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`
}

/** Folded-corner page, 1024 canvas. Used as an Icon Composer alpha mask. */
function pageSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <path fill="#000" d="M318 196h332l138 138v470c0 28-22 50-50 50H318c-28 0-50-22-50-50V246c0-28 22-50 50-50z"/>
</svg>
`
}

function foldSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <path fill="#000" d="M650 196v138h138z"/>
</svg>
`
}

function markSvg(mark) {
  const size = mark.length === 1 ? 210 : 118
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <text x="512" y="720" text-anchor="middle" fill="#000"
    font-family="SF Pro Display, SF NS, Helvetica Neue, Helvetica, sans-serif"
    font-weight="700" font-size="${size}" letter-spacing="${mark.length > 1 ? -2 : 0}">${mark}</text>
</svg>
`
}

function glyphSvg(kind) {
  const paths = {
    image: '<rect x="332" y="340" width="360" height="280" rx="36"/><circle cx="430" cy="430" r="36"/><path d="M360 560l90-88 70 62 70-80 74 106H360z"/>',
    code: '<path d="M430 360l-110 152 110 152M594 360l110 152-110 152" fill="none" stroke="#000" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>',
    archive: '<path d="M320 360h384v80H320zM352 440h320v260c0 18-14 32-32 32H384c-18 0-32-14-32-32z"/><rect x="470" y="480" width="84" height="36" rx="8"/>',
    audio: '<path d="M430 360v304c0 40-34 64-70 48-28-12-42-40-28-68 12-24 40-36 64-28V456l196-48v192c0 40-34 64-70 48-28-12-42-40-28-68 12-24 40-36 64-28V360z"/>',
    video: '<rect x="300" y="360" width="424" height="304" rx="48"/><path fill="#fff" d="M456 432l160 80-160 80z"/>',
    file: '<path d="M368 300h220l136 136v352c0 24-20 44-44 44H368c-24 0-44-20-44-44V344c0-24 20-44 44-44z"/>',
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g fill="#000">${paths[kind] ?? paths.file}</g>
</svg>
`
}

function iconJson(kind) {
  return {
    features: ['refractivity', 'specular-location'],
    'fill-specializations': [
      { value: { 'automatic-gradient': hexToSrgb(kind.hex) } },
      { appearance: 'dark', value: { 'automatic-gradient': hexToSrgb(kind.dark) } },
    ],
    groups: [
      {
        name: 'Document',
        lighting: 'individual',
        layers: [
          {
            name: 'Page',
            'image-name': 'page.svg',
            glass: true,
            fill: { solid: 'extended-srgb:1.00000,1.00000,1.00000,1.00000' },
          },
          {
            name: 'Fold',
            'image-name': 'fold.svg',
            glass: true,
            fill: { solid: 'extended-srgb:0.92000,0.94000,0.98000,1.00000' },
          },
          kind.mark
            ? {
                name: 'Mark',
                'image-name': 'mark.png',
                glass: true,
                fill: { solid: hexToSrgb(kind.hex) },
              }
            : {
                name: 'Glyph',
                'image-name': 'glyph.svg',
                glass: true,
                fill: { solid: 'extended-srgb:1.00000,1.00000,1.00000,1.00000' },
              },
        ],
        shadow: { kind: 'layer-color', opacity: 0.42 },
        specular: true,
        'specular-highlight-placement': 'outside',
        translucency: { enabled: true, value: 0.38 },
        'blur-material': 0.42,
        refractivity: { enabled: true, depth: 0.55, strength: 0.62 },
      },
    ],
    'supported-platforms': { squares: 'shared' },
  }
}

function documentSvg(kind) {
  const light = mix(kind.hex, '#ffffff', 0.55)
  const mid = mix(kind.hex, '#ffffff', 0.22)
  const deep = mix(kind.hex, '#0f172a', 0.28)
  const ink = mix(kind.hex, '#0f172a', 0.18)
  const mark = kind.mark
  const markSize = !mark ? 0 : mark.length === 1 ? 168 : 92
  const extra = kind.glyph ? glyphForDocument(kind.glyph) : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="glass-${kind.id}" x1="18%" y1="0%" x2="86%" y2="100%">
      <stop offset="0%" stop-color="${light}"/>
      <stop offset="46%" stop-color="${mid}"/>
      <stop offset="100%" stop-color="${deep}"/>
    </linearGradient>
    <linearGradient id="sheen-${kind.id}" x1="20%" y1="0%" x2="70%" y2="80%">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.72"/>
      <stop offset="38%" stop-color="#fff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fold-${kind.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="${light}" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="shadow-${kind.id}" x="-20%" y="-10%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="${kind.hex}" flood-opacity="0.22"/>
      <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.16"/>
    </filter>
    <clipPath id="page-${kind.id}">
      <path d="M292 168h348l148 148v512c0 36-28 64-64 64H292c-36 0-64-28-64-64V232c0-36 28-64 64-64z"/>
    </clipPath>
  </defs>
  <path filter="url(#shadow-${kind.id})" fill="url(#glass-${kind.id})"
    d="M292 168h348l148 148v512c0 36-28 64-64 64H292c-36 0-64-28-64-64V232c0-36 28-64 64-64z"/>
  <g clip-path="url(#page-${kind.id})">
    <rect width="1024" height="1024" fill="url(#sheen-${kind.id})"/>
    <path d="M220 150h520l-180 240H180z" fill="#fff" opacity="0.22"/>
    <ellipse cx="390" cy="250" rx="210" ry="70" fill="#fff" opacity="0.28"/>
  </g>
  <path d="M640 168v148h148z" fill="url(#fold-${kind.id})" stroke="${light}" stroke-width="2"/>
  <path d="M292 168h348l148 148v512c0 36-28 64-64 64H292c-36 0-64-28-64-64V232c0-36 28-64 64-64z"
    fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="3"/>
  ${mark ? `<text x="512" y="690" text-anchor="middle" fill="${ink}" fill-opacity="0.92"
    font-family="SF Pro Display, SF NS, Helvetica Neue, Helvetica, sans-serif"
    font-weight="700" font-size="${markSize}" letter-spacing="${mark.length > 1 ? -1 : 0}">${mark}</text>` : extra}
</svg>
`
}

function glyphForDocument(kind) {
  const common = 'fill="none" stroke="currentColor" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"'
  const wrap = (inner) => `<g transform="translate(512 560)" color="#1e293b" opacity="0.86">${inner}</g>`
  if (kind === 'image') return wrap(`<g transform="translate(-140 -90)" fill="#1e293b" stroke="none"><rect x="0" y="0" width="280" height="200" rx="28"/><circle cx="78" cy="64" r="22" fill="#fff"/><path d="M24 164l70-68 54 48 54-62 54 82H24z" fill="#fff" opacity="0.9"/></g>`)
  if (kind === 'code') return wrap(`<g ${common}><path d="M-70 -70L-150 0l80 70M70 -70L150 0l-80 70"/></g>`)
  if (kind === 'archive') return wrap(`<g fill="#1e293b"><rect x="-130" y="-80" width="260" height="48" rx="8"/><rect x="-110" y="-32" width="220" height="150" rx="16"/><rect x="-28" y="8" width="56" height="22" rx="6" fill="#fff"/></g>`)
  if (kind === 'audio') return wrap(`<g fill="#1e293b"><path d="M-20 -90v180c-38 8-70-18-70-52 0-28 22-48 54-48V-36l152-36v140c-38 8-70-18-70-52 0-28 22-48 54-48V-126z"/></g>`)
  if (kind === 'video') return wrap(`<g fill="#1e293b"><rect x="-150" y="-90" width="300" height="200" rx="36"/><path d="M-30 -36l96 46-96 46z" fill="#fff"/></g>`)
  return wrap(`<g fill="#1e293b"><path d="M-90 -100h120l80 80v160c0 18-14 32-32 32h-168c-18 0-32-14-32-32v-208c0-18 14-32 32-32z"/></g>`)
}

function previewHtml(ids) {
  const cards = ids.map((id) => `
    <figure>
      <img src="png/${id}-mac27-default.png" alt="${id} default"/>
      <img src="png/${id}-mac27-dark.png" alt="${id} dark" class="on-dark"/>
      <img src="svg/${id}-document.svg" alt="${id} document svg"/>
      <figcaption>${id}</figcaption>
    </figure>`).join('')
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8"/>
<title>macOS 27 glass file icons</title>
<style>
  body { margin: 0; font: 14px/1.4 ui-sans-serif, system-ui; background: #e8e8ed; color: #1d1d1f; }
  h1 { font-size: 22px; font-weight: 620; margin: 28px 32px 8px; }
  p { margin: 0 32px 24px; color: #6e6e73; max-width: 720px; }
  section { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; padding: 0 28px 40px; }
  figure { margin: 0; padding: 16px; border-radius: 18px; background: #fff; box-shadow: 0 10px 30px #00000010; }
  figure img { width: 32%; aspect-ratio: 1; object-fit: contain; background: #f5f5f7; border-radius: 12px; }
  figure img.on-dark { background: #1d1d1f; }
  figcaption { margin-top: 10px; font-weight: 600; text-transform: capitalize; }
</style>
<h1>macOS 27 玻璃文件图标</h1>
<p>左：Icon Composer / ictool Default（design-generation 27）。中：Dark。右：独立 SVG 文档页，可直接当资源用。</p>
<section>${cards}</section>
</html>`
}

async function rasterMark(kind, dest) {
  const svg = markSvg(kind.mark)
  await sharp(Buffer.from(svg)).png().toFile(dest)
}

function writeIconPackage(kind) {
  const dir = join(ROOT, 'composer', `${kind.id}.icon`)
  const assets = join(dir, 'Assets')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(assets, 'page.svg'), pageSvg())
  writeFileSync(join(assets, 'fold.svg'), foldSvg())
  if (kind.mark) {
    // placeholder; replaced by PNG after raster
  } else {
    writeFileSync(join(assets, 'glyph.svg'), glyphSvg(kind.glyph))
  }
  writeFileSync(join(dir, 'icon.json'), JSON.stringify(iconJson(kind), null, 2))
  return dir
}

function exportPng(iconDir, id, rendition, dest) {
  execFileSync(ICTOOL, [
    iconDir,
    '--export-image',
    '--output-file', dest,
    '--platform', 'macOS',
    '--rendition', rendition,
    '--width', '1024',
    '--height', '1024',
    '--scale', '1',
    '--design-generation', '27',
  ], { stdio: 'inherit' })
}

async function main() {
  mkdirSync(join(ROOT, 'png'), { recursive: true })
  mkdirSync(join(ROOT, 'svg'), { recursive: true })
  mkdirSync(join(ROOT, 'composer'), { recursive: true })

  for (const kind of KINDS) {
    const iconDir = writeIconPackage(kind)
    if (kind.mark) {
      await rasterMark(kind, join(iconDir, 'Assets', 'mark.png'))
    }
    writeFileSync(join(ROOT, 'svg', `${kind.id}-document.svg`), documentSvg(kind))
    exportPng(iconDir, kind.id, 'Default', join(ROOT, 'png', `${kind.id}-mac27-default.png`))
    exportPng(iconDir, kind.id, 'Dark', join(ROOT, 'png', `${kind.id}-mac27-dark.png`))
    console.log('generated', kind.id)
  }

  writeFileSync(join(ROOT, 'preview.html'), previewHtml(KINDS.map((k) => k.id)))
  console.log('wrote', join(ROOT, 'preview.html'))
}

await main()
