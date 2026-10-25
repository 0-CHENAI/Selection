import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Official Kimi Code (Pi 1.3.0+) speaks OpenAI Chat Completions. This replays
 * a local stream through the production fetch interceptor with an oauth
 * credential, so CI does not need a real Kimi account.
 *
 * The Anthropic single-LF framer stays covered by kimi-anthropic-live-stream
 * for custom Messages gateways. It is not this provider.
 */
it('sends Kimi Code OAuth as Chat Completions Bearer and parses reasoning plus tool calls', async () => {
  const seen: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const headers: Record<string, string> = {}
      req.headers.forEach((value, key) => { headers[key] = value })
      const text = await req.text()
      let body: unknown = text
      try { body = JSON.parse(text) } catch { /* keep the raw body in the failure */ }
      seen.push({ method: req.method, url: req.url, headers, body })
      const chunks = [
        delta({ role: 'assistant', content: '' }),
        delta({ reasoning_content: '先' }),
        delta({ reasoning_content: '整理' }),
        delta({ content: '周报' }),
        delta({ tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'read', arguments: '' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"notes.md"}' } }] }),
        delta({}, 'tool_calls', { prompt_tokens: 12, completion_tokens: 8 }),
      ]
      const sse = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
      return new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
    },
  })

  const sessionDir = mkdtempSync(join(tmpdir(), 'kimi-cc-'))
  const interceptor = resolve(import.meta.dir, '../../unified-network-interceptor.ts')
  const baseUrl = `http://127.0.0.1:${server.port}/v1`
  const code = `
    import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
    import { builtinModels } from '@earendil-works/pi-ai/providers/all';
    const store = new InMemoryCredentialStore();
    await store.modify('kimi-coding', async () => ({
      type: 'oauth',
      access: 'kimi-access-token',
      refresh: '',
      expires: Number.MAX_SAFE_INTEGER,
    }));
    const models = builtinModels({ credentials: store });
    const catalog = models.getModel('kimi-coding', 'k3');
    if (!catalog) throw new Error('catalog is missing k3');
    const model = { ...catalog, baseUrl: ${JSON.stringify(baseUrl)} };
    const stream = models.stream(model, {
      systemPrompt: '你是助手',
      messages: [{ role: 'user', content: '写周报', timestamp: Date.now() }],
      tools: [{
        name: 'read',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      }],
    }, { reasoningEffort: 'high' });
    const message = await stream.result();
    const content = (message.content ?? []).map((block) => {
      if (block.type === 'thinking') {
        return { type: 'thinking', thinking: block.thinking, thinkingSignature: block.thinkingSignature };
      }
      if (block.type === 'text') return { type: 'text', text: block.text };
      if (block.type === 'toolCall') {
        return { type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments };
      }
      return { type: block.type };
    });
    console.log('@@KIMI@@' + JSON.stringify({
      stopReason: message.stopReason,
      errorMessage: message.errorMessage ?? null,
      content,
    }));
  `
  const proc = Bun.spawn([process.execPath, '--preload', interceptor, '--eval', code], {
    cwd: resolve(import.meta.dir, '../../../../..'),
    env: {
      ...process.env,
      CRAFT_SESSION_DIR: sessionDir,
      CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL: '0',
      CRAFT_PI_MODEL_API: 'openai-completions',
      CRAFT_PI_MODEL_PROVIDER: 'kimi-coding',
      CRAFT_PI_MODEL_BASE_URL: baseUrl,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timeout = setTimeout(() => proc.kill(), 18_000)
  try {
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(exit, `${stderr}\n${stdout}`).toBe(0)
    const line = stdout.split('\n').find(entry => entry.startsWith('@@KIMI@@'))
    expect(line, stdout).toBeDefined()
    const parsed = JSON.parse(line!.slice('@@KIMI@@'.length)) as {
      stopReason: string
      errorMessage: string | null
      content: Array<Record<string, unknown>>
    }
    expect(parsed.stopReason).toBe('toolUse')
    expect(parsed.errorMessage).toBeNull()
    expect(parsed.content).toContainEqual({
      type: 'thinking',
      thinking: '先整理',
      thinkingSignature: 'reasoning_content',
    })
    expect(parsed.content).toContainEqual({ type: 'text', text: '周报' })
    expect(parsed.content).toContainEqual({
      type: 'toolCall',
      id: 'call_read',
      name: 'read',
      arguments: { path: 'notes.md' },
    })

    expect(seen).toHaveLength(1)
    const request = seen[0]!
    const url = new URL(request.url)
    expect(request.method).toBe('POST')
    expect(url.pathname).toBe('/v1/chat/completions')
    expect(url.pathname).not.toContain('/messages')
    expect(url.pathname).not.toContain('/v1/v1')
    expect(header(request.headers, 'authorization')).toBe('Bearer kimi-access-token')
    expect(header(request.headers, 'x-api-key')).toBeUndefined()
    expect(header(request.headers, 'accept-encoding')).toBe('identity')
    expect(header(request.headers, 'user-agent')).toMatch(/^pi\/1\.4\.0 \([^;]+; (?:bun|node)\/[^;]+; [^)]+\)$/)

    const body = request.body as {
      model?: string
      stream?: boolean
      reasoning_effort?: string
      max_tokens?: number
      max_completion_tokens?: number
      messages?: Array<{ role?: string }>
      tools?: Array<{ function?: { name?: string } }>
    }
    expect(body.model).toBe('k3')
    expect(body.stream).toBe(true)
    expect(body.reasoning_effort).toBe('high')
    expect(body.max_completion_tokens).toBeUndefined()
    expect(body.messages?.some(message => message.role === 'developer')).toBe(false)
    expect(body.messages?.some(message => message.role === 'system')).toBe(true)
    expect(body.messages?.some(message => message.role === 'user')).toBe(true)
    expect(body.tools?.[0]?.function?.name).toBe('read')
  } finally {
    clearTimeout(timeout)
    proc.kill()
    server.stop(true)
    rmSync(sessionDir, { recursive: true, force: true })
  }
}, 20_000)

function delta(
  deltaBody: Record<string, unknown>,
  finish: string | null = null,
  usage?: Record<string, number>,
) {
  return {
    id: 'chatcmpl-kimi',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: deltaBody, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name)
  return key ? headers[key] : undefined
}
