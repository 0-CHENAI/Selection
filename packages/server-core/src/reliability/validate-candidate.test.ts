import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import sharp from 'sharp'
import { validateCandidateFile } from './validate-candidate'
test('Office validation rejects incomplete packages and malformed XML', async () => {
  const root = mkdtempSync(join(tmpdir(),'candidate-office-'))
  try {
    const path = join(root,'file.docx')
    writeFileSync(path,zipSync({'word/document.xml':strToU8('<document/>')}))
    await expect(validateCandidateFile(path)).rejects.toThrow('missing')
    const parts = {'[Content_Types].xml':strToU8('<Types/>'),'_rels/.rels':strToU8('<Relationships/>'),'word/document.xml':strToU8('<document>')}
    writeFileSync(path,zipSync(parts)); await expect(validateCandidateFile(path)).rejects.toThrow('invalid XML')
    parts['word/document.xml']=strToU8('<document/>');writeFileSync(path,zipSync(parts))
    expect((await validateCandidateFile(path)).semanticVerified).toBe(false)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('images are decoded and text validation does not claim semantic correctness', async () => {
  const root = mkdtempSync(join(tmpdir(),'candidate-format-'))
  try {
    const image=join(root,'image.png');writeFileSync(image,await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer())
    expect((await validateCandidateFile(image)).checks).toEqual(['Image decoded'])
    writeFileSync(image,'not an image');await expect(validateCandidateFile(image)).rejects.toThrow()
    const text=join(root,'code.ts');writeFileSync(text,'const intentionallyInvalid = ;')
    expect(await validateCandidateFile(text)).toMatchObject({checks:['UTF-8 decoded'],scope:'format',semanticVerified:false})
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('PDF validation parses pages and rejects a corrupt document', async () => {
  const root=mkdtempSync(join(tmpdir(),'candidate-pdf-'))
  try {
    const path=join(root,'file.pdf')
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>']
    let pdf='%PDF-1.4\n';const offsets=[0]
    objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`})
    const xref=Buffer.byteLength(pdf);pdf+='xref\n0 4\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    writeFileSync(path,pdf);expect((await validateCandidateFile(path)).checks).toEqual(['PDF pages parsed'])
    writeFileSync(path,'broken pdf');await expect(validateCandidateFile(path)).rejects.toThrow()
  } finally {rmSync(root,{recursive:true,force:true})}
})
