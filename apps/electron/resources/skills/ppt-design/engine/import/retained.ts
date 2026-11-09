import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'

export type RetainedMedia = {
  relId: string
  type: string
  target: string
  base64: string
}

export type RetainedFragment = {
  elementId: string
  feature: string
  xml: string
  media: RetainedMedia[]
}

export type RetainedSlide = {
  pageId: string
  backgroundXml?: string
  fragments: RetainedFragment[]
}

export type RetainedManifest = {
  version: 1
  slides: RetainedSlide[]
}

export function emptyManifest(): RetainedManifest {
  return { version: 1, slides: [] }
}

/** 把路线 B 的原片段贴回导出的 PPTX。可编辑对象仍由现有导出写出。 */
export async function mergeRetained(pptxPath: string, manifest: RetainedManifest): Promise<void> {
  if (!manifest.slides.some(slide => slide.fragments.length > 0 || slide.backgroundXml)) return
  const zip = await JSZip.loadAsync(readFileSync(pptxPath))
  let contentTypes = (await zip.file('[Content_Types].xml')?.async('string')) ?? ''
  for (let index = 0; index < manifest.slides.length; index++) {
    const slide = manifest.slides[index]!
    if (slide.fragments.length === 0 && !slide.backgroundXml) continue
    const path = `ppt/slides/slide${index + 1}.xml`
    const file = zip.file(path)
    if (!file) continue
    let xml = await file.async('string')
    const relPath = `ppt/slides/_rels/slide${index + 1}.xml.rels`
    let rels = (await zip.file(relPath)?.async('string')) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    if (slide.backgroundXml && slide.backgroundXml.includes('<p:bg')) {
      if (xml.includes('<p:bg')) xml = xml.replace(/<p:bg\b[\s\S]*?<\/p:bg>/, slide.backgroundXml)
      else xml = xml.replace(/<p:spTree\b/, `${slide.backgroundXml}<p:spTree`)
    }
    let serial = 1
    const blocks: string[] = []
    for (const fragment of slide.fragments) {
      if (/<!DOCTYPE|<!ENTITY|<\s*script\b|javascript:/i.test(fragment.xml)) continue
      let piece = fragment.xml
      for (const media of fragment.media) {
        if (media.target.split('/').includes('..') || media.relId.includes('"')) continue
        const relId = `rIdKeep${index + 1}${serial++}`
        const safeName = media.target.split('/').pop()?.replace(/[^\w.-]+/g, '') || `part${serial}`
        const stored = `ppt/media/retained-${index + 1}-${safeName}`
        zip.file(stored, Buffer.from(media.base64, 'base64'))
        piece = piece.split(media.relId).join(relId)
        const type = media.type || 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
        rels = rels.replace('</Relationships>', `<Relationship Id="${relId}" Type="${escapeAttr(type)}" Target="../media/${stored.split('/').pop()}"/></Relationships>`)
        contentTypes = addContentType(contentTypes, safeName)
      }
      blocks.push(piece)
    }
    if (blocks.length > 0) xml = xml.replace('</p:spTree>', `${blocks.join('')}</p:spTree>`)
    zip.file(path, xml)
    zip.file(relPath, rels)
  }
  if (contentTypes) zip.file('[Content_Types].xml', contentTypes)
  writeFileSync(pptxPath, Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })))
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function addContentType(xml: string, fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (!extension || !xml || xml.includes(`Extension="${extension}"`)) return xml
  const types: Record<string, string> = {
    emf: 'image/x-emf',
    wmf: 'image/x-wmf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    xml: 'application/xml',
  }
  const content = types[extension]
  if (!content) return xml
  return xml.replace('</Types>', `<Default Extension="${extension}" ContentType="${content}"/></Types>`)
}
