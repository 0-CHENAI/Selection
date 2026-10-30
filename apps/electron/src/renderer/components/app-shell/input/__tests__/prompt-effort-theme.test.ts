import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FRAG_COMP, FRAG_SIM } from '../effort-webgl-shaders'
import {
  EFFORT_FIELD_FADE_MS,
  EFFORT_THEME_VARS,
  effortThemeFallback,
  parseCssColor,
  readEffortShaderTheme,
} from '../effort-theme'
import { effortFramePlan, mountWebglEffort } from '@/hooks/useWebglEffort'

const css = readFileSync(join(import.meta.dir, '../PromptBarEffects.css'), 'utf8')
const themeCss = readFileSync(join(import.meta.dir, '../../../../index.css'), 'utf8')

function ruleBodies(source: string, selector: string): string[] {
  const bodies: string[] = []
  let from = 0
  while (from < source.length) {
    const start = source.indexOf(selector, from)
    if (start < 0) break
    const open = source.indexOf('{', start)
    const close = source.indexOf('}', open)
    bodies.push(source.slice(open + 1, close))
    from = close + 1
  }
  return bodies
}

function hues(block: string): number[] {
  return [...block.matchAll(/oklch\(\s*[0-9.]+\s+[0-9.]+\s+([0-9.]+)/g)].map(match => Number(match[1]))
}

const lightPalette = ruleBodies(css, '.prompt-field,\n.prompt-effort-settings {')[0] ?? ''
const darkPalette = ruleBodies(css, '.dark .prompt-field,\n.dark .prompt-effort-settings {')[0] ?? ''
const proSpark = ruleBodies(css, ".prompt-effort-settings[data-work-mode='PRO'] {")[0] ?? ''
const proLight = ruleBodies(css, ".prompt-effort-settings[data-work-mode='PRO'] {")[1] ?? ''
const proDark = ruleBodies(css, ".dark .prompt-effort-settings[data-work-mode='PRO'] {")[0] ?? ''

describe('max effort theme css', () => {
  it('uses a soft light track and a lifted dark track', () => {
    expect(lightPalette).toContain('--prompt-spark: oklch(0.49 0.16 293)')
    expect(darkPalette).toContain('--prompt-spark: oklch(0.78 0.11 293)')
    const lightTrack = lightPalette.match(/--prompt-effort-max-track:\s*([^;]+);/)?.[1]
    const darkTrack = darkPalette.match(/--prompt-effort-max-track:\s*([^;]+);/)?.[1]
    expect(lightTrack).toBeTruthy()
    expect(darkTrack).toBeTruthy()
    expect(lightTrack).not.toBe(darkTrack)
    expect(lightTrack).toContain('0.975')
    expect(darkTrack).toContain('0.23')
    expect(css).not.toContain('oklch(0.14 0.008 293)')
    expect(css).toContain('background-color: var(--prompt-effort-max-track)')
    expect(hues(lightPalette).some(hue => Math.abs(hue - 293) < 1)).toBe(true)
    expect(hues(darkPalette).some(hue => Math.abs(hue - 293) < 1)).toBe(true)
    expect(darkPalette).toContain('color(srgb 0.28 0.1 0.58)')
    expect(darkPalette).toContain('--prompt-effort-chroma: 0')
    expect(lightPalette).toContain('--prompt-effort-chroma: 1')
  })

  it('follows the PRO gold token for track, cells, fill, and thumb', () => {
    expect(proSpark).toContain('--prompt-spark: var(--pro-accent)')
    expect(proDark).toContain('--prompt-spark: var(--pro-accent)')
    for (const block of [proLight, proDark]) {
      expect(block).toContain('--prompt-effort-max-track: color-mix(in oklch, var(--prompt-spark)')
      expect(block).toContain('--prompt-effort-ember: color-mix(in oklch, var(--prompt-spark)')
      expect(block).toContain('--prompt-effort-mid: color-mix(in oklch, var(--prompt-spark)')
      expect(block).toContain('--prompt-effort-core: color-mix(in oklch, var(--prompt-spark)')
      expect(hues(block).length).toBeGreaterThan(0)
      expect(hues(block).every(hue => hue >= 55 && hue <= 100)).toBe(true)
      expect(block).not.toContain('293')
    }
    expect(proDark).toMatch(/--prompt-effort-core:[^;]*0\.97/)
    expect(css).toContain(".prompt-effort-settings[data-max] .prompt-effort-fill { background: color-mix(in srgb, var(--prompt-spark) 35%, transparent); }")
    expect(css).toContain(".prompt-effort-settings[data-max] .prompt-effort-thumb { background: var(--prompt-spark); }")
    expect(themeCss).toContain('--pro-accent: oklch(0.50178870 0.09392988 58.44502375)')
    expect(themeCss).toContain('--pro-accent: oklch(0.76808414 0.08380584 76.89195147)')
    const proAccents = [...themeCss.matchAll(/--pro-accent:\s*oklch\([^)]+\)/g)].map(match => match[0])
    expect(proAccents).toHaveLength(2)
    expect(proAccents.join('\n')).not.toContain('293')
  })

  it('fades the field for one short beat and settles under reduced motion', () => {
    expect(css).toContain(`transition: opacity ${EFFORT_FIELD_FADE_MS}ms ease`)
    expect(css).toContain(`transition: background-color ${EFFORT_FIELD_FADE_MS}ms ease`)
    expect(css).toContain('.prompt-effort-webgl[data-visible] { opacity: 1; }')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.prompt-effort-webgl')
    expect(reduced).toContain('.prompt-effort-track')
    expect(reduced).toContain('transition: none')
    expect(reduced).not.toContain('infinite')
    expect(effortFramePlan(true)).toEqual({ steps: 32, loop: false })
    expect(effortFramePlan(false)).toEqual({ steps: 1, loop: true })
  })
})

function relativeLuma(rgb: readonly number[]): number {
  const lin = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}

describe('effort color parsing', () => {
  it('parses the sRGB and oklch forms the browser hands back', () => {
    expect(parseCssColor('rgb(120, 80, 200)')).toEqual([120 / 255, 80 / 255, 200 / 255])
    expect(parseCssColor('rgb(212 175 55 / 1)')?.[0]).toBeGreaterThan(parseCssColor('rgb(212 175 55 / 1)')?.[2] ?? 1)
    expect(parseCssColor('color(srgb 0.28 0.1 0.58)')).toEqual([0.28, 0.1, 0.58])
    expect(parseCssColor('#abc')).toEqual([170 / 255, 187 / 255, 204 / 255])
    expect(parseCssColor('not-a-color')).toBeNull()
    const purple = parseCssColor('oklch(0.55 0.12 293)')
    const gold = parseCssColor('oklch(0.55 0.1 70)')
    const lifted = parseCssColor('oklch(0.296 0.04 293)')
    const crushed = parseCssColor('oklch(0.14 0.008 293)')
    expect(purple?.[2]).toBeGreaterThan(purple?.[0] ?? 1)
    expect(gold?.[0]).toBeGreaterThan(gold?.[2] ?? 1)
    expect(lifted && crushed && relativeLuma(lifted) > relativeLuma(crushed) * 2).toBe(true)
  })

  it('keeps light and dark fallbacks apart, with the rich purple ember on dark', () => {
    const light = effortThemeFallback(false)
    const dark = effortThemeFallback(true)
    expect(light.track).not.toEqual(dark.track)
    expect(light.chroma).toBe(1)
    expect(dark.chroma).toBe(0)
    expect(dark.ember).toEqual([0.28, 0.1, 0.58])
    expect(dark.heat).toBe(1.2)
    const theme = readEffortShaderTheme({
      color: 'rgb(180, 120, 40)',
      borderTopColor: 'rgb(196, 140, 48)',
      borderRightColor: 'rgb(255, 244, 230)',
      borderBottomColor: 'rgb(48, 32, 18)',
      getPropertyValue: (name: string) => ({
        [EFFORT_THEME_VARS.heat]: '0.58',
        [EFFORT_THEME_VARS.exposure]: '0.8',
        [EFFORT_THEME_VARS.floor]: '0.05',
        [EFFORT_THEME_VARS.rise]: '0.2',
        [EFFORT_THEME_VARS.chroma]: '1',
      }[name] ?? ''),
    }, false)
    expect(theme.ember[0]).toBeGreaterThan(theme.ember[2])
    expect(theme.core[0]).toBeGreaterThan(0.9)
    expect(theme.track).not.toEqual(effortThemeFallback(true).track)
    expect(theme.heat).toBe(0.58)
  })
})

const GL = {
  COMPILE_STATUS: 0x8B81,
  LINK_STATUS: 0x8B82,
  VERTEX_SHADER: 0x8B31,
  FRAGMENT_SHADER: 0x8B30,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88E4,
  FLOAT: 0x1406,
  TRIANGLES: 4,
  TEXTURE_2D: 0x0DE1,
  TEXTURE0: 0x84C0,
  TEXTURE1: 0x84C1,
  RGBA: 0x1908,
  UNSIGNED_BYTE: 0x1401,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812F,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  FRAMEBUFFER: 0x8D40,
  COLOR_ATTACHMENT0: 0x8CE0,
  FRAMEBUFFER_COMPLETE: 0x8CD5,
  COLOR_BUFFER_BIT: 0x4000,
} as const

interface RecordedCall { name: string; args: unknown[] }

function fakeGl() {
  const calls: RecordedCall[] = []
  const gl = new Proxy({ ...GL } as Record<PropertyKey, unknown>, {
    get(target, prop) {
      if (Reflect.has(target, prop)) return target[prop]
      if (prop === 'then') return undefined
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args })
        if (prop === 'createShader' || prop === 'createProgram' || prop === 'createBuffer' || prop === 'createTexture' || prop === 'createFramebuffer' || prop === 'createVertexArray') return {}
        if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return true
        if (prop === 'getUniformLocation') return args[1]
        if (prop === 'checkFramebufferStatus') return GL.FRAMEBUFFER_COMPLETE
        if (prop === 'isContextLost') return false
        if (prop === 'getShaderInfoLog' || prop === 'getProgramInfoLog') return ''
        return undefined
      }
    },
  })
  return { gl: gl as unknown as WebGL2RenderingContext, calls }
}

describe('max effort webgl field', () => {
  const previous = ['window', 'document', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'MutationObserver']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const warn = console.warn
  afterEach(() => {
    console.warn = warn
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })

  it('uploads the computed theme, clears transparent, and does not loop when motion is reduced', async () => {
    expect(FRAG_SIM).toContain('uniform vec3 u_ember, u_mid, u_core')
    expect(FRAG_SIM).toContain('u_heat')
    expect(FRAG_SIM).not.toContain('vec3(0.28, 0.10, 0.58)')
    expect(FRAG_COMP).toContain('u_track')
    expect(FRAG_COMP).toContain('mix(u_track, shown, presence)')

    const warnings: unknown[][] = []
    console.warn = (...args: unknown[]) => { warnings.push(args) }
    const { gl, calls } = fakeGl()
    let contextAttrs: WebGLContextAttributes | undefined
    let reduced = true
    const queue = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const observers: MutationCallback[] = []
    const style = {
      color: 'rgb(90, 60, 170)',
      borderTopColor: 'rgb(110, 70, 190)',
      borderRightColor: 'rgb(210, 190, 240)',
      borderBottomColor: 'rgb(40, 28, 72)',
      getPropertyValue: (name: string) => ({
        [EFFORT_THEME_VARS.heat]: '1.2',
        [EFFORT_THEME_VARS.exposure]: '1.1',
        [EFFORT_THEME_VARS.floor]: '0',
        [EFFORT_THEME_VARS.rise]: '0.12',
        [EFFORT_THEME_VARS.chroma]: '0',
      }[name] ?? ''),
    }
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = ++frameId
        queue.set(id, callback)
        return id
      },
      cancelAnimationFrame: (id: number) => { queue.delete(id) },
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { constructor(callback: MutationCallback) { observers.push(callback) } observe() {} disconnect() {} },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        devicePixelRatio: 1,
        matchMedia: (query: string) => ({
          get matches() { return reduced && query.includes('reduce') },
          addEventListener() {},
          removeEventListener() {},
        }),
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        hidden: false,
        documentElement: { classList: { contains: (name: string) => name === 'dark' } },
        addEventListener() {},
        removeEventListener() {},
      },
    })
    Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => style })
    const canvas = {
      width: 0,
      height: 0,
      getContext: (_kind: string, attrs?: WebGLContextAttributes) => {
        contextAttrs = attrs
        return gl
      },
      getBoundingClientRect: () => ({ width: 180, height: 22 }),
      addEventListener() {},
      removeEventListener() {},
      closest: () => null,
    }
    const draws = () => calls.filter(call => call.name === 'drawArrays').length
    const stop = mountWebglEffort(canvas as unknown as HTMLCanvasElement, { onContextRestored() {} })
    expect(warnings).toEqual([])
    expect(contextAttrs).toMatchObject({ alpha: true, premultipliedAlpha: true, antialias: false })
    expect(calls.filter(call => call.name === 'clearColor').every(call => call.args.join(',') === '0,0,0,0')).toBe(true)
    expect(draws()).toBe(35)
    expect(queue.size).toBe(0)
    const ember = calls.filter(call => call.name === 'uniform3f' && call.args[0] === 'u_ember').at(-1)
    expect(ember?.args.slice(1)).toEqual([90 / 255, 60 / 255, 170 / 255])
    expect((ember?.args[1] as number) < (ember?.args[3] as number)).toBe(true)

    style.color = 'rgb(196, 130, 42)'
    style.borderTopColor = 'rgb(210, 150, 48)'
    style.borderRightColor = 'rgb(255, 246, 232)'
    style.borderBottomColor = 'rgb(62, 40, 18)'
    style.getPropertyValue = (name: string) => ({
      [EFFORT_THEME_VARS.heat]: '1.2',
      [EFFORT_THEME_VARS.exposure]: '1.1',
      [EFFORT_THEME_VARS.floor]: '0',
      [EFFORT_THEME_VARS.rise]: '0.12',
      [EFFORT_THEME_VARS.chroma]: '0',
    }[name] ?? '')
    observers.at(-1)?.([], {} as MutationObserver)
    observers.at(-1)?.([], {} as MutationObserver)
    expect(draws()).toBe(105)
    expect(queue.size).toBe(0)
    const gold = calls.filter(call => call.name === 'uniform3f' && call.args[0] === 'u_ember').at(-1)
    expect((gold?.args[1] as number) > (gold?.args[3] as number)).toBe(true)
    const track = calls.filter(call => call.name === 'uniform3f' && call.args[0] === 'u_track').at(-1)
    expect(track?.args.slice(1)).toEqual([62 / 255, 40 / 255, 18 / 255])
    await Bun.sleep(20)
    expect(draws()).toBe(105)
    expect(queue.size).toBe(0)
    stop()
  })

  it('keeps a single animation frame alive and stops it on teardown', () => {
    console.warn = () => {}
    const { gl, calls } = fakeGl()
    const queue = new Map<number, FrameRequestCallback>()
    let frameId = 0
    Object.assign(globalThis, {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = ++frameId
        queue.set(id, callback)
        return id
      },
      cancelAnimationFrame: (id: number) => { queue.delete(id) },
      ResizeObserver: class { observe() {} disconnect() {} },
      MutationObserver: class { observe() {} disconnect() {} },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        hidden: false,
        documentElement: { classList: { contains: () => false } },
        addEventListener() {},
        removeEventListener() {},
      },
    })
    Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: () => ({
        color: 'rgb(1, 2, 3)',
        borderTopColor: 'rgb(4, 5, 6)',
        borderRightColor: 'rgb(7, 8, 9)',
        borderBottomColor: 'rgb(10, 11, 12)',
        getPropertyValue: () => '',
      }),
    })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => gl,
      getBoundingClientRect: () => ({ width: 180, height: 22 }),
      addEventListener() {},
      removeEventListener() {},
      closest: () => null,
    }
    const stop = mountWebglEffort(canvas as unknown as HTMLCanvasElement, { onContextRestored() {} })
    expect(calls.filter(call => call.name === 'drawArrays').length).toBe(4)
    expect(queue.size).toBe(1)
    for (let step = 0; step < 5; step++) {
      const pending = queue.entries().next().value as [number, FrameRequestCallback] | undefined
      expect(pending).toBeTruthy()
      queue.delete(pending![0])
      pending![1](performance.now())
    }
    expect(queue.size).toBe(1)
    expect(calls.filter(call => call.name === 'drawArrays').length).toBe(24)
    const stale = [...queue.values()][0]!
    stop()
    expect(queue.size).toBe(0)
    stale(performance.now())
    expect(queue.size).toBe(0)
    expect(calls.filter(call => call.name === 'drawArrays').length).toBe(24)
  })
})
