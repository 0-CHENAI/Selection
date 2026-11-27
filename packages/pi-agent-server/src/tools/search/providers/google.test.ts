import { describe, expect, it } from 'bun:test'
import { GoogleSearchProvider } from './google.ts'

describe('GoogleSearchProvider', () => {
  it('uses active Gemini Flash grounding models and falls back on 404', async () => {
    const originalFetch = globalThis.fetch
    const calledUrls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calledUrls.push(url)
      if (url.includes('/gemini-3.8-flash:')) {
        return new Response('model not found', { status: 404 })
      }
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: 'Search answer' }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://example.com/result', title: 'Example Result' } },
            ],
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch

    try {
      const provider = new GoogleSearchProvider('AIza-test')
      const results = await provider.search('test query', 5)
      expect(calledUrls).toEqual([
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      ])
      expect(results).toEqual([
        { title: 'Example Result', url: 'https://example.com/result', description: '' },
      ])

      // Subsequent searches remember the working fallback model without retrying the 404 model
      await provider.search('second query', 5)
      expect(calledUrls).toEqual([
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not swallow non-404 errors', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch

    try {
      const provider = new GoogleSearchProvider('AIza-test')
      await expect(provider.search('test query', 5)).rejects.toThrow('HTTP 403')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
