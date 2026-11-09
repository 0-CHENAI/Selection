import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { htmlArtifactLocation, resolveHtmlArtifactResource, isHtmlArtifactNavigationAllowed, isHtmlArtifactRequestAllowed } from '../html-artifact'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'selection-html-')); directories.push(base)
  const root = join(base, '文档 空格'); await mkdir(join(root, 'assets'), { recursive: true })
  const html = join(root, '报告 #1.html'); await writeFile(html, '<script src="assets/app.js"></script>')
  await writeFile(join(root, 'assets', 'app.js'), 'window.ready=true')
  return { base, root, html }
}
describe('HTML document browser grant', () => {
  test('explicitly opened hidden HTML is readable without exposing other hidden resources', async () => {
    const { root } = await fixture()
    const file = join(root, '.report.html'); await writeFile(file, '<p>report</p>')
    await writeFile(join(root, '.env'), 'private')
    const location = await htmlArtifactLocation(file, 'document')
    expect(await resolveHtmlArtifactResource(location.root, 'document', location.url, location.document)).toBe(await realpath(file))
    await expect(resolveHtmlArtifactResource(location.root, 'document', 'selection-html://document/.env', location.document)).rejects.toThrow()
  })
  test('local resources require a trusted requesting frame; web sockets and ordinary web resources remain usable', () => {
    const request = { url: 'selection-html://document/assets/app.js', resourceType: 'script', referrer: '' }
    expect(isHtmlArtifactRequestAllowed('document', { ...request, frame: { url: 'selection-html://document/report.html' } })).toBe(true)
    expect(isHtmlArtifactRequestAllowed('document', { ...request, frame: { url: 'https://example.com' } })).toBe(false)
    expect(isHtmlArtifactRequestAllowed('document', { ...request, referrer: 'selection-html://document/report.html', frame: { url: 'https://example.com' } })).toBe(false)
    expect(isHtmlArtifactRequestAllowed('document', { ...request, frame: { url: 'about:blank', parent: { url: 'https://example.com' } } })).toBe(false)
    expect(isHtmlArtifactRequestAllowed('document', { ...request, frame: { url: 'blob:selection-html://document/worker' } })).toBe(true)
    expect(isHtmlArtifactRequestAllowed('document', { ...request, referrer: 'https://document/report.html' })).toBe(false)
    expect(isHtmlArtifactRequestAllowed('document', { ...request, referrer: 'selection-html://document/report.html' })).toBe(true)
    expect(isHtmlArtifactRequestAllowed('document', request)).toBe(false)
    for (const url of ['https://example.com/a.js', 'wss://example.com/live', 'ws://localhost:8080', 'about:blank']) expect(isHtmlArtifactRequestAllowed('document', { ...request, url })).toBe(true)
    for (const url of ['about:crash', 'file:///etc/passwd', 'selection-html://other/report.html', 'craftagents://x']) expect(isHtmlArtifactRequestAllowed('document', { ...request, url })).toBe(false)
  })
  test('encoded document names and nested resources retain their directory', async () => {
    const { html } = await fixture()
    const location = await htmlArtifactLocation(html, 'document')
    expect(await resolveHtmlArtifactResource(location.root, 'document', location.url)).toBe(await realpath(html))
    expect(await resolveHtmlArtifactResource(location.root, 'document', new URL('assets/app.js?v=1#part', location.url).href)).toBe(join(location.root, 'assets', 'app.js'))
    await expect(htmlArtifactLocation('relative.html', 'document')).rejects.toThrow()
    await expect(htmlArtifactLocation('/missing.html', 'document')).rejects.toThrow()
  })
  test('rejects origin swapping, encoded traversal, hidden files, directories and escaping symlinks', async () => {
    const { base, html, root } = await fixture()
    const location = await htmlArtifactLocation(html, 'document')
    await writeFile(join(base, 'private.txt'), 'private')
    await symlink(join(base, 'private.txt'), join(root, 'leak.txt'))
    await writeFile(join(root, '.env'), 'private')
    await symlink(join(root, '.env'), join(root, 'hidden.txt'))
    for (const path of ['selection-html://other/assets/app.js', 'file:///etc/passwd', 'selection-html://document/%2e%2e%2fprivate.txt', 'selection-html://document/%2eenv', 'selection-html://document/leak.txt', 'selection-html://document/hidden.txt', 'selection-html://document/assets/', 'selection-html://document/%5c..%5cprivate.txt', 'selection-html://document/a%00.js']) {
      await expect(resolveHtmlArtifactResource(location.root, 'document', path)).rejects.toThrow()
    }
  })
  test('navigation cannot reach local files or app protocols', () => {
    for (const url of ['file:///etc/passwd', 'craftagents://workspace/x', 'thumbnail://thumb/x', 'javascript:alert(1)', 'data:text/html,x', 'about:crash']) expect(isHtmlArtifactNavigationAllowed(url)).toBe(false)
    for (const url of ['https://example.com', 'selection-html://document/page.html', 'about:blank']) expect(isHtmlArtifactNavigationAllowed(url)).toBe(true)
  })
})
