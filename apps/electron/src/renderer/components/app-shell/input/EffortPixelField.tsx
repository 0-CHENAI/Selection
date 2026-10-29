import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { FRAG_BLUR, FRAG_COMP, FRAG_SIM, VERT } from './effortPixelShaders'

/**
 * Max-effort track field. WebGL2 pipeline adapted from
 * https://github.com/254558/claude-range-slider (张帅, commit e79b9ac).
 * Upstream ships no LICENSE file; the port keeps that attribution.
 */

interface FrameTarget {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}

function readAccent(canvas: HTMLCanvasElement): [number, number, number] {
  const host = canvas.parentElement
  if (!host) return [0.55, 0.42, 0.75]
  const probe = document.createElement('span')
  probe.style.color = 'var(--prompt-spark)'
  host.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  const match = value.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  if (!match) return [0.55, 0.42, 0.75]
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255]
}

function mountPixelField(canvas: HTMLCanvasElement, reduced: boolean) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  })
  if (!gl) return () => {}

  let raf = 0
  let running = false
  let simA: FrameTarget | null = null
  let simB: FrameTarget | null = null
  let blurH: FrameTarget | null = null
  let blurV: FrameTarget | null = null
  const startedAt = performance.now()
  let accent: [number, number, number] = [0.55, 0.42, 0.75]
  let dark = 0
  let pro = 0
  const readTheme = () => {
    accent = readAccent(canvas)
    // The Max track is charcoal in both themes, so the field uses the dark palette.
    dark = 1
    pro = canvas.closest('[data-work-mode="PRO"]') ? 1 : 0
  }

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader)
      return null
    }
    return shader
  }
  const link = (fragment: string) => {
    const vertex = compile(gl.VERTEX_SHADER, VERT)
    const frag = compile(gl.FRAGMENT_SHADER, fragment)
    if (!vertex || !frag) return null
    const program = gl.createProgram()
    if (!program) return null
    gl.attachShader(program, vertex)
    gl.attachShader(program, frag)
    gl.bindAttribLocation(program, 0, 'a_pos')
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(frag)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      return null
    }
    return program
  }

  const simProg = link(FRAG_SIM)
  const blurProg = link(FRAG_BLUR)
  const compProg = link(FRAG_COMP)
  if (!simProg || !blurProg || !compProg) return () => {}

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const simTime = gl.getUniformLocation(simProg, 'u_time')
  const simSlider = gl.getUniformLocation(simProg, 'u_slider')
  const simElapsed = gl.getUniformLocation(simProg, 'u_elapsed')
  const simDark = gl.getUniformLocation(simProg, 'u_dark')
  const simPro = gl.getUniformLocation(simProg, 'u_pro')
  const simAccent = gl.getUniformLocation(simProg, 'u_accent')
  const simBack = gl.getUniformLocation(simProg, 'u_back')
  const blurDir = gl.getUniformLocation(blurProg, 'u_dir')
  const blurExt = gl.getUniformLocation(blurProg, 'u_ext')
  const blurTex = gl.getUniformLocation(blurProg, 'u_tex')
  const blurRes = gl.getUniformLocation(blurProg, 'u_res')
  const compScene = gl.getUniformLocation(compProg, 'u_scene')
  const compGlow = gl.getUniformLocation(compProg, 'u_glow')

  const dropTarget = (target: FrameTarget | null) => {
    if (!target) return
    gl.deleteFramebuffer(target.fbo)
    gl.deleteTexture(target.tex)
  }
  const makeTarget = (): FrameTarget | null => {
    const fbo = gl.createFramebuffer()
    const tex = gl.createTexture()
    if (!fbo || !tex || !canvas.width || !canvas.height) return null
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { fbo, tex }
  }
  const dropTargets = () => {
    dropTarget(simA); simA = null
    dropTarget(simB); simB = null
    dropTarget(blurH); blurH = null
    dropTarget(blurV); blurV = null
  }

  const draw = (time: number, elapsed: number) => {
    if (!simA || !simB || !blurH || !blurV) return
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(vao)

    gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo)
    gl.useProgram(simProg)
    gl.uniform1f(simTime, time * 0.001)
    gl.uniform1f(simSlider, 1)
    gl.uniform1f(simElapsed, elapsed)
    gl.uniform1f(simDark, dark)
    gl.uniform1f(simPro, pro)
    gl.uniform3f(simAccent, accent[0], accent[1], accent[2])
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, simA.tex)
    gl.uniform1i(simBack, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.useProgram(blurProg)
    gl.uniform2f(blurRes, canvas.width, canvas.height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurH.fbo)
    gl.uniform2f(blurDir, 1, 0)
    gl.uniform1f(blurExt, 1)
    gl.bindTexture(gl.TEXTURE_2D, simB.tex)
    gl.uniform1i(blurTex, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurV.fbo)
    gl.uniform2f(blurDir, 0, 1)
    gl.uniform1f(blurExt, 0)
    gl.bindTexture(gl.TEXTURE_2D, blurH.tex)
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(compProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, simB.tex)
    gl.uniform1i(compScene, 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, blurV.tex)
    gl.uniform1i(compGlow, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.disable(gl.BLEND)

    const swap = simA
    simA = simB
    simB = swap
  }

  const settle = () => {
    if (!simA || !simB) return
    for (let i = 0; i < 48; i += 1) draw(1200, 2.4)
  }

  const loop = (time: number) => {
    const elapsed = (performance.now() - startedAt) / 1000
    draw(time, elapsed)
    raf = window.requestAnimationFrame(loop)
  }
  const ensureLoop = () => {
    if (reduced || running || !simA) return
    running = true
    raf = window.requestAnimationFrame(loop)
  }

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    readTheme()
    if (canvas.width === width && canvas.height === height && simA) return
    canvas.width = width
    canvas.height = height
    dropTargets()
    simA = makeTarget()
    simB = makeTarget()
    blurH = makeTarget()
    blurV = makeTarget()
    if (reduced) settle()
    else ensureLoop()
  }

  const observer = new ResizeObserver(() => resize())
  observer.observe(canvas)
  const themeObserver = new MutationObserver(() => readTheme())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  readTheme()
  resize()

  return () => {
    running = false
    window.cancelAnimationFrame(raf)
    observer.disconnect()
    themeObserver.disconnect()
    dropTargets()
    gl.deleteProgram(simProg)
    gl.deleteProgram(blurProg)
    gl.deleteProgram(compProg)
    gl.deleteVertexArray(vao)
    gl.deleteBuffer(vbo)
  }
}

export function EffortPixelField() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return mountPixelField(canvas, !!reduced)
  }, [reduced])

  return <canvas ref={canvasRef} className="prompt-effort-pixel-grid" data-pixel-engine="claude-range-slider" aria-hidden="true" />
}
