import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FRAG_COMP, FRAG_SIM } from '../effort-webgl-shaders'
import {
  EFFORT_COLOR_BLEND_MS,
  EFFORT_FIELD_FADE_MS,
  EFFORT_THEME_VARS,
  easeEffortBlend,
  effortThemeFallback,
  lerpEffortRgb,
  parseCssColor,
  readEffortShaderTheme,
  stepEffortShaderTheme,
  type EffortShaderTheme,
} from '../effort-theme'
import { effortFramePlan, effortPaintPlan, mountWebglEffort } from '@/hooks/useWebglEffort'

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

describe('max effort theme css', () => {
  it('only paints the Max backdrop in dark menus', () => {
    expect(lightPalette).toContain('--prompt-spark: oklch(0.49 0.16 293)')
    expect(darkPalette).toContain('--prompt-spark: oklch(0.78 0.11 293)')
    const lightTrack = lightPalette.match(/--prompt-effort-max-track:\s*([^;]+);/)?.[1]
    expect(lightTrack).toBeTruthy()
    expect(lightTrack).toContain('0.18 0.008')
    expect(lightPalette).toContain('--prompt-effort-backdrop: 0')
    expect(darkPalette).toContain('--prompt-effort-backdrop: 1')
    expect(darkPalette).not.toContain('--prompt-effort-max-track:')
    expect(css).toContain('--prompt-effort-track-bg: var(--prompt-effort-max-track)')
    expect(hues(lightPalette).some(hue => Math.abs(hue - 293) < 1)).toBe(true)
    expect(hues(darkPalette).some(hue => Math.abs(hue - 293) < 1)).toBe(true)
    expect(lightPalette).toContain('color(srgb 0.28 0.1 0.58)')
    expect(lightPalette).toContain('--prompt-effort-chroma: 1')
    expect(darkPalette).toContain('--prompt-effort-chroma: 0')
  })

  it('follows the PRO gold token for track, cells, fill, and thumb', () => {
    expect(proSpark).toContain('--prompt-spark: var(--pro-accent)')
    for (const block of [proLight]) {
      expect(block).toContain('--prompt-effort-max-track: color-mix(in oklch, var(--prompt-spark)')
      expect(block).toContain('--prompt-effort-ember: color-mix(in oklch, var(--prompt-spark)')
      expect(block).toContain('--prompt-effort-mid: var(--prompt-spark)')
      expect(block).toContain('--prompt-effort-core: color-mix(in oklch, var(--prompt-spark)')
      expect(hues(block).length).toBeGreaterThan(0)
      expect(hues(block).every(hue => hue >= 55 && hue <= 100)).toBe(true)
      expect(block).not.toContain('293')
    }
    expect(proLight).toMatch(/--prompt-effort-core:[^;]*0\.97/)
    expect(proSpark).toContain('--prompt-effort-label: var(--prompt-spark)')
    const maxPaint = ruleBodies(css, '.prompt-effort-settings[data-max] {')[0] ?? ''
    expect(maxPaint).toContain('--prompt-effort-track-bg: color-mix(in oklab, var(--foreground) 4%, var(--popover))')
    expect(maxPaint).toContain('--prompt-effort-fill-bg: transparent')
    expect(maxPaint).toContain('--prompt-effort-thumb-bg: var(--prompt-effort-core)')
    expect(maxPaint).toContain('--prompt-effort-label: var(--prompt-spark)')
    expect(themeCss).toContain('--pro-accent: oklch(0.50178870 0.09392988 58.44502375)')
    expect(themeCss).toContain('--pro-accent: oklch(0.76808414 0.08380584 76.89195147)')
    const proAccents = [...themeCss.matchAll(/--pro-accent:\s*oklch\([^)]+\)/g)].map(match => match[0])
    expect(proAccents).toHaveLength(2)
    expect(proAccents.join('\n')).not.toContain('293')
  })

  it('fades the field for one short beat and settles under reduced motion', () => {
    expect(css).toContain(`transition: opacity ${EFFORT_FIELD_FADE_MS}ms ease`)
    expect(css).toContain(`--prompt-effort-track-bg ${EFFORT_COLOR_BLEND_MS}ms ease`)
    expect(css).toContain(`--prompt-effort-fill-bg ${EFFORT_COLOR_BLEND_MS}ms ease`)
    expect(css).toContain(`--prompt-effort-thumb-bg ${EFFORT_COLOR_BLEND_MS}ms ease`)
    expect(css).toContain(`--prompt-effort-thumb-border ${EFFORT_COLOR_BLEND_MS}ms ease`)
    expect(css).toContain(`--prompt-effort-label ${EFFORT_COLOR_BLEND_MS}ms ease`)
    expect(css).toContain(`--prompt-field-glow ${EFFORT_COLOR_BLEND_MS}ms ease`)
    expect(css).toContain('transition: width 220ms cubic-bezier(0.23, 1, 0.32, 1)')
    expect(css).toContain('left 220ms cubic-bezier(0.23, 1, 0.32, 1)')
    expect(css).toContain('box-shadow 250ms ease')
    expect(css).toContain('@property --prompt-spark')
    expect(css).toContain('syntax: "<color>"')
    expect(css).toContain('.prompt-effort-webgl[data-visible] { opacity: 1; }')
    const webgl = ruleBodies(css, '.prompt-effort-webgl {')[0] ?? ''
    expect(webgl).toContain(`transition: opacity ${EFFORT_FIELD_FADE_MS}ms ease`)
    expect(webgl).not.toContain('border-color')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.prompt-effort-webgl')
    expect(reduced).toContain('.prompt-effort-track')
    expect(reduced).toContain('.prompt-effort-settings')
    expect(reduced).toContain('.prompt-effort-fill')
    expect(reduced).toContain('.prompt-effort-thumb')
    expect(reduced).toContain('transition: none')
    expect(reduced).not.toContain('infinite')
    expect(reduced).not.toContain('background-color 300ms')
    expect(effortFramePlan(true)).toEqual({ steps: 32, loop: false })
    expect(effortFramePlan(false)).toEqual({ steps: 1, loop: true })
    expect(effortPaintPlan(true, false)).toEqual({ steps: 32, loop: false })
    expect(effortPaintPlan(false, false)).toEqual({ steps: 1, loop: true })
    expect(effortPaintPlan(false, true)).toEqual({ steps: 1, loop: true })
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

  it('keeps fallback cells brighter than the track in both themes', () => {
    const light = effortThemeFallback(false)
    const dark = effortThemeFallback(true)
    expect(light.track).not.toEqual(dark.track)
    expect(light.chroma).toBe(1)
    expect(light.backdrop).toBe(0)
    expect(dark.backdrop).toBe(1)
    expect(dark.chroma).toBe(0)
    expect(dark.ember).toEqual([0.28, 0.1, 0.58])
    expect(dark.heat).toBe(2.2)
    for (const palette of [light, dark]) {
      expect(relativeLuma(palette.mid)).toBeGreaterThan(relativeLuma(palette.track) * 10)
      expect(relativeLuma(palette.core)).toBeGreaterThan(relativeLuma(palette.mid))
    }
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

function themeWith(base: EffortShaderTheme, patch: Partial<EffortShaderTheme>): EffortShaderTheme {
  return { ...base, ...patch }
}

describe('effort color interpolation', () => {
  it('blends encoded sRGB in oklab instead of gamma space', () => {
    const red = [1, 0, 0] as const
    const blue = [0, 0, 1] as const
    expect(lerpEffortRgb(red, blue, 0)).toEqual([1, 0, 0])
    expect(lerpEffortRgb(red, blue, 1)).toEqual([0, 0, 1])
    expect(easeEffortBlend(0)).toBe(0)
    expect(easeEffortBlend(1)).toBe(1)
    expect(easeEffortBlend(0.5)).toBeGreaterThan(0.7)
    const mixed = lerpEffortRgb(red, blue, 0.5)
    const gamma = [0.5, 0, 0.5]
    expect(mixed[0]).toBeGreaterThan(0.15)
    expect(mixed[2]).toBeGreaterThan(0.15)
    expect(relativeLuma(mixed)).toBeGreaterThan(relativeLuma(gamma))
    const purple = parseCssColor('oklch(0.55 0.12 293)')
    const gold = parseCssColor('oklch(0.55 0.1 70)')
    expect(purple && gold).toBeTruthy()
    const crossed = lerpEffortRgb(purple!, gold!, 0.5)
    const straight = purple!.map((channel, index) => (channel + gold![index]!) / 2)
    expect(Math.abs(crossed[0] - straight[0]) + Math.abs(crossed[2] - straight[2])).toBeGreaterThan(0.02)
    const roundTrip = lerpEffortRgb([0.2, 0.4, 0.6], [0.2, 0.4, 0.6], 0.4)
    expect(roundTrip[0]).toBeCloseTo(0.2, 2)
    expect(roundTrip[1]).toBeCloseTo(0.4, 2)
    expect(roundTrip[2]).toBeCloseTo(0.6, 2)
  })

  it('eases toward a new theme and snaps when motion is reduced', () => {
    const purple = effortThemeFallback(false)
    const gold = themeWith(effortThemeFallback(true), {
      ember: [0.8, 0.5, 0.2],
      mid: [0.86, 0.58, 0.24],
      core: [1, 0.94, 0.86],
      track: [0.28, 0.18, 0.08],
      heat: 2.6,
    })
    const mounted = stepEffortShaderTheme(null, purple, 0, false)
    expect(mounted.settled).toBe(true)
    expect(mounted.theme.ember).toEqual([...purple.ember])

    const started = stepEffortShaderTheme(mounted.blend, gold, 1000, false)
    expect(started.settled).toBe(false)
    expect(started.theme.ember).toEqual([...purple.ember])
    expect(started.theme.heat).toBe(purple.heat)

    const midway = stepEffortShaderTheme(started.blend, gold, 1000 + EFFORT_COLOR_BLEND_MS / 2, false)
    expect(midway.settled).toBe(false)
    expect(midway.theme.backdrop).toBeGreaterThan(0.5)
    expect(midway.theme.backdrop).toBeLessThan(1)
    expect(midway.theme.heat).toBeGreaterThan((purple.heat + gold.heat) / 2)
    expect(midway.theme.ember[0]).toBeGreaterThan(lerpEffortRgb(purple.ember, gold.ember, 0.5)[0])

    const arrived = stepEffortShaderTheme(midway.blend, gold, 1000 + EFFORT_COLOR_BLEND_MS, false)
    expect(arrived.settled).toBe(true)
    expect(arrived.theme.ember).toEqual([...gold.ember])
    expect(arrived.theme.track).toEqual([...gold.track])
    expect(arrived.theme.heat).toBe(gold.heat)
    expect(arrived.blend.startedAt).toBeNull()

    const held = stepEffortShaderTheme(arrived.blend, gold, 1000 + EFFORT_COLOR_BLEND_MS + 40, false)
    expect(held.settled).toBe(true)
    expect(held.theme.ember).toEqual([...gold.ember])

    const retarget = stepEffortShaderTheme(midway.blend, purple, 1000 + EFFORT_COLOR_BLEND_MS / 2, false)
    expect(retarget.settled).toBe(false)
    expect(retarget.theme.ember).toEqual(midway.theme.ember)
    const returned = stepEffortShaderTheme(retarget.blend, purple, 1000 + EFFORT_COLOR_BLEND_MS / 2 + EFFORT_COLOR_BLEND_MS, false)
    expect(returned.settled).toBe(true)
    expect(returned.theme.ember).toEqual([...purple.ember])

    const snapped = stepEffortShaderTheme(midway.blend, gold, 1000, true)
    expect(snapped.settled).toBe(true)
    expect(snapped.theme.ember).toEqual([...gold.ember])
    expect(snapped.theme.chroma).toBe(gold.chroma)
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
    expect(FRAG_COMP).toContain('u_backdrop')

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
    const origin = calls.find(call => call.name === 'uniform1f' && call.args[0] === 'u_origin')
    expect(origin?.args[1]).toBeCloseTo(167 / 180, 6)
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

  it('eases shader colors across frames and keeps drawing until the blend settles', () => {
    console.warn = () => {}
    const { gl, calls } = fakeGl()
    const queue = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const observers: MutationCallback[] = []
    const style = {
      color: 'rgb(90, 60, 170)',
      borderTopColor: 'rgb(110, 70, 190)',
      borderRightColor: 'rgb(210, 190, 240)',
      borderBottomColor: 'rgb(230, 224, 245)',
      getPropertyValue: () => '0.58',
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
    Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => style })
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => gl,
      getBoundingClientRect: () => ({ width: 180, height: 22 }),
      addEventListener() {},
      removeEventListener() {},
      closest: () => null,
    }
    const ember = () => calls.filter(call => call.name === 'uniform3f' && call.args[0] === 'u_ember').at(-1)?.args.slice(1)
    const stop = mountWebglEffort(canvas as unknown as HTMLCanvasElement, { onContextRestored() {} })
    expect(ember()).toEqual([90 / 255, 60 / 255, 170 / 255])
    expect(queue.size).toBe(1)

    style.color = 'rgb(204, 128, 51)'
    style.borderTopColor = 'rgb(214, 148, 56)'
    style.borderRightColor = 'rgb(255, 244, 230)'
    style.borderBottomColor = 'rgb(72, 48, 20)'
    observers.at(-1)?.([], {} as MutationObserver)
    const changedAt = performance.now()
    expect(ember()).toEqual([90 / 255, 60 / 255, 170 / 255])
    expect(queue.size).toBe(1)

    const pending = queue.entries().next().value as [number, FrameRequestCallback]
    queue.delete(pending[0])
    pending[1](changedAt + EFFORT_COLOR_BLEND_MS / 2)
    const midway = ember() as number[]
    expect(midway[0]).toBeGreaterThan(90 / 255)
    expect(midway[0]).toBeLessThan(204 / 255)
    expect(queue.size).toBe(1)

    const next = queue.entries().next().value as [number, FrameRequestCallback]
    queue.delete(next[0])
    next[1](changedAt + EFFORT_COLOR_BLEND_MS)
    expect(ember()).toEqual([204 / 255, 128 / 255, 51 / 255])
    expect(queue.size).toBe(1)
    stop()
    expect(queue.size).toBe(0)
  })
})
