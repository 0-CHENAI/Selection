import { useEffect, useState, type RefObject } from 'react'
import { VERT, FRAG_SIM, FRAG_BLUR, FRAG_COMP } from '@/components/app-shell/input/effort-webgl-shaders'

type Target = { framebuffer: WebGLFramebuffer; texture: WebGLTexture }

/** Mounted only at Max. No animation while hidden; reduced motion draws one settled frame. */
export function useWebglEffort(canvasRef: RefObject<HTMLCanvasElement>) {
  const [contextVersion, setContextVersion] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
    // The ordinary track remains usable when WebGL is unavailable.
    if (!gl) return

    const programs: WebGLProgram[] = []
    const shaders: WebGLShader[] = []
    let targets: Target[] = []
    let buffer: WebGLBuffer | null = null
    let vertexArray: WebGLVertexArrayObject | null = null
    let frame = 0
    let width = 0
    let height = 0
    let contextInvalidated = false
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let startedAt: number | null = null

    function destroyTargets() {
      for (const target of targets) {
        gl!.deleteFramebuffer(target.framebuffer)
        gl!.deleteTexture(target.texture)
      }
      targets = []
    }

    function dispose() {
      cancelAnimationFrame(frame)
      // A lost context already released these handles. Deleting them after
      // restoration would submit objects owned by the previous context.
      if (contextInvalidated) return
      destroyTargets()
      for (const program of programs) gl!.deleteProgram(program)
      for (const shader of shaders) gl!.deleteShader(shader)
      gl!.deleteBuffer(buffer)
      gl!.deleteVertexArray(vertexArray)
    }

    function compile(type: number, source: string) {
      const shader = gl!.createShader(type)
      if (!shader) throw new Error('Unable to allocate effort shader')
      shaders.push(shader)
      gl!.shaderSource(shader, source)
      gl!.compileShader(shader)
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        throw new Error(gl!.getShaderInfoLog(shader) || 'Unable to compile effort shader')
      }
      return shader
    }

    function link(vertex: WebGLShader, source: string) {
      const program = gl!.createProgram()
      if (!program) throw new Error('Unable to allocate effort program')
      programs.push(program)
      gl!.attachShader(program, vertex)
      gl!.attachShader(program, compile(gl!.FRAGMENT_SHADER, source))
      gl!.linkProgram(program)
      if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) {
        throw new Error(gl!.getProgramInfoLog(program) || 'Unable to link effort program')
      }
      return program
    }

    function makeTarget(): Target {
      const framebuffer = gl!.createFramebuffer()
      const texture = gl!.createTexture()
      if (!framebuffer || !texture) {
        gl!.deleteFramebuffer(framebuffer)
        gl!.deleteTexture(texture)
        throw new Error('Unable to allocate effort framebuffer')
      }
      const target = { framebuffer, texture }
      targets.push(target)
      gl!.bindTexture(gl!.TEXTURE_2D, texture)
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer)
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, texture, 0)
      if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) {
        throw new Error('Incomplete effort framebuffer')
      }
      gl!.clear(gl!.COLOR_BUFFER_BIT)
      return target
    }

    try {
      const vertex = compile(gl.VERTEX_SHADER, VERT)
      const simulation = link(vertex, FRAG_SIM)
      const blur = link(vertex, FRAG_BLUR)
      const composite = link(vertex, FRAG_COMP)
      vertexArray = gl.createVertexArray()
      buffer = gl.createBuffer()
      if (!vertexArray || !buffer) throw new Error('Unable to allocate effort geometry')
      gl.bindVertexArray(vertexArray)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.clearColor(0, 0, 0, 1)

      const uniforms = {
        time: gl.getUniformLocation(simulation, 'u_time'),
        slider: gl.getUniformLocation(simulation, 'u_slider'),
        elapsed: gl.getUniformLocation(simulation, 'u_elapsed'),
        back: gl.getUniformLocation(simulation, 'u_back'),
        simCells: gl.getUniformLocation(simulation, 'u_cells'),
        direction: gl.getUniformLocation(blur, 'u_dir'),
        extract: gl.getUniformLocation(blur, 'u_ext'),
        texture: gl.getUniformLocation(blur, 'u_tex'),
        resolution: gl.getUniformLocation(blur, 'u_res'),
        scene: gl.getUniformLocation(composite, 'u_scene'),
        glow: gl.getUniformLocation(composite, 'u_glow'),
        compCells: gl.getUniformLocation(composite, 'u_cells'),
      }
      let front: Target
      let back: Target
      let horizontal: Target
      let vertical: Target
      let columns = 83
      const rows = 7

      function render(now: number) {
        frame = 0
        if (!width || !height || document.hidden || contextInvalidated || gl!.isContextLost()) return
        // Freeze both phase and fill for reduced motion, without a RAF loop.
        startedAt ??= now
        const elapsed = motion.matches ? 5 : (now - startedAt) / 1000
        gl!.bindVertexArray(vertexArray)
        gl!.viewport(0, 0, width, height)
        // Settle trail energy synchronously for reduced motion. Only the final
        // composite is presented, with no animated warm-up or RAF loop.
        const simulationSteps = motion.matches ? 32 : 1
        for (let step = 0; step < simulationSteps; step++) {
          gl!.bindFramebuffer(gl!.FRAMEBUFFER, back.framebuffer)
          gl!.useProgram(simulation)
          gl!.uniform1f(uniforms.time, motion.matches ? 5 : now / 1000)
          gl!.uniform1f(uniforms.slider, 1)
          gl!.uniform1f(uniforms.elapsed, elapsed)
          gl!.uniform2f(uniforms.simCells, columns, rows)
          gl!.activeTexture(gl!.TEXTURE0)
          gl!.bindTexture(gl!.TEXTURE_2D, front.texture)
          gl!.uniform1i(uniforms.back, 0)
          gl!.drawArrays(gl!.TRIANGLES, 0, 6)
          const previous = front
          front = back
          back = previous
        }

        gl!.useProgram(blur)
        gl!.uniform2f(uniforms.resolution, width, height)
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, horizontal.framebuffer)
        gl!.uniform2f(uniforms.direction, 1, 0)
        gl!.uniform1f(uniforms.extract, 1)
        gl!.bindTexture(gl!.TEXTURE_2D, front.texture)
        gl!.uniform1i(uniforms.texture, 0)
        gl!.drawArrays(gl!.TRIANGLES, 0, 6)
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, vertical.framebuffer)
        gl!.uniform2f(uniforms.direction, 0, 1)
        gl!.uniform1f(uniforms.extract, 0)
        gl!.bindTexture(gl!.TEXTURE_2D, horizontal.texture)
        gl!.drawArrays(gl!.TRIANGLES, 0, 6)

        gl!.bindFramebuffer(gl!.FRAMEBUFFER, null)
        gl!.useProgram(composite)
        gl!.uniform2f(uniforms.compCells, columns, rows)
        gl!.bindTexture(gl!.TEXTURE_2D, front.texture)
        gl!.uniform1i(uniforms.scene, 0)
        gl!.activeTexture(gl!.TEXTURE1)
        gl!.bindTexture(gl!.TEXTURE_2D, vertical.texture)
        gl!.uniform1i(uniforms.glow, 1)
        gl!.drawArrays(gl!.TRIANGLES, 0, 6)
        if (!motion.matches) frame = requestAnimationFrame(render)
      }

      function refresh() {
        cancelAnimationFrame(frame)
        frame = 0
        if (!document.hidden && !contextInvalidated && !gl!.isContextLost()) render(performance.now())
      }

      function resize() {
        if (contextInvalidated || gl!.isContextLost()) return
        const rect = canvas!.getBoundingClientRect()
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const nextWidth = Math.round(rect.width * dpr)
        const nextHeight = Math.round(rect.height * dpr)
        if (!nextWidth || !nextHeight || (nextWidth === width && nextHeight === height)) return
        cancelAnimationFrame(frame)
        width = canvas!.width = nextWidth
        height = canvas!.height = nextHeight
        // Fractional columns preserve isotropic cells at every responsive width.
        columns = width / height * rows
        destroyTargets()
        gl!.activeTexture(gl!.TEXTURE0)
        front = makeTarget()
        back = makeTarget()
        horizontal = makeTarget()
        vertical = makeTarget()
        refresh()
      }

      function onContextLost(event: Event) {
        event.preventDefault()
        contextInvalidated = true
        cancelAnimationFrame(frame)
      }
      const onContextRestored = () => setContextVersion(version => version + 1)
      resize()
      const observer = new ResizeObserver(resize)
      observer.observe(canvas)
      motion.addEventListener('change', refresh)
      document.addEventListener('visibilitychange', refresh)
      canvas.addEventListener('webglcontextlost', onContextLost)
      canvas.addEventListener('webglcontextrestored', onContextRestored)
      return () => {
        observer.disconnect()
        motion.removeEventListener('change', refresh)
        document.removeEventListener('visibilitychange', refresh)
        canvas.removeEventListener('webglcontextlost', onContextLost)
        canvas.removeEventListener('webglcontextrestored', onContextRestored)
        dispose()
      }
    } catch (error) {
      dispose()
      console.warn('Max effort WebGL field unavailable:', error)
    }
  }, [canvasRef, contextVersion])
}
