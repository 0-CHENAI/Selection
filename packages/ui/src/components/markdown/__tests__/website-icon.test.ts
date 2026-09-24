import { describe, expect, it } from 'bun:test'
import { websiteIconCandidates, websiteIconUrl } from '../WebsiteIcon'

describe('websiteIconUrl', () => {
  it('preserves the exact website host without sharing credentials, paths or queries', () => {
    const icon = new URL(websiteIconUrl('https://user:secret@docs.example.com/private?q=token#section')!)
    expect(icon.searchParams.get('url')).toBe('https://docs.example.com')
    expect(icon.href).not.toContain('secret')
    expect(icon.href).not.toContain('token')
  })
  it('does not request icons for local hosts, IP addresses or non-web targets', () => {
    for (const href of ['http://localhost:3000', 'http://app.local', 'http://app.internal', 'http://app.test', 'http://127.0.0.1', 'http://[::1]', 'file:///report.pdf', '/report.pdf', 'mailto:test@example.com', 'javascript:alert(1)', 'invalid']) {
      expect(websiteIconUrl(href)).toBeNull()
      expect(websiteIconCandidates(href)).toEqual([])
    }
  })
  it('tries the source website before the shared favicon service', () => {
    const candidates = websiteIconCandidates('http://user:secret@docs.example.com./private?q=token#section')
    expect(candidates).toEqual([
      'https://docs.example.com/favicon.ico',
      websiteIconUrl('https://docs.example.com')!,
    ])
    expect(candidates.join(' ')).not.toContain('secret')
    expect(candidates.join(' ')).not.toContain('token')
  })
})
