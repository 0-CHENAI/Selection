import {
  PROMPT_FX_ENERGY_LIVE,
  attachPromptFxEngagement,
  attachPromptFxGate,
  decorativeLayerDpr,
  promptFxFrameDue,
  promptFxFrameIntervalMs,
  promptFxShouldLoop,
} from './prompt-fx-runtime'

type Spark = { x: number; y: number; life: number; span: number; speed: number; phase: number }

export function mountPromptSparks(
  canvas: HTMLCanvasElement,
  host: { energy: { current: number }; reducedMotion?: boolean },
): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}

  let width = 0
  let height = 0
  let frame = 0
  let last = performance.now()
  let lastDraw = 0
  let due = 0
  let disposed = false
  let engaged = false
  const particles: Spark[] = []
  const field = typeof canvas.closest === 'function' ? canvas.closest('.prompt-field') : canvas.parentElement

  const resize = () => {
    if (disposed) return
    const rect = canvas.getBoundingClientRect()
    const dpr = decorativeLayerDpr(window.devicePixelRatio || 1)
    const nextWidth = rect.width
    const nextHeight = rect.height
    const nextStoreW = Math.round(nextWidth * dpr)
    const nextStoreH = Math.round(nextHeight * dpr)
    if (!nextStoreW || !nextStoreH) {
      width = 0
      height = 0
      gateState.displayed = false
      return
    }
    gateState.displayed = true
    if (nextStoreW === canvas.width && nextStoreH === canvas.height && width === nextWidth && height === nextHeight) return
    width = nextWidth
    height = nextHeight
    canvas.width = nextStoreW
    canvas.height = nextStoreH
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paint(performance.now())
  }

  const live = () => host.energy.current > PROMPT_FX_ENERGY_LIVE || particles.length > 0

  const paint = (now: number) => {
    lastDraw = now
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = getComputedStyle(canvas).color
    for (const p of particles) {
      ctx.globalAlpha = Math.sin(p.life / p.span * Math.PI) * 0.5 * Math.max(0, Math.min(1, (height - p.y) / 12, p.y / 12))
      ctx.beginPath()
      ctx.arc(p.x + Math.sin(now / 1100 + p.phase) * 5, p.y, 0.9 + host.energy.current * 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  const tick = (now: number) => {
    frame = 0
    if (disposed || !width || !height) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    host.energy.current *= Math.exp(-dt / 0.8)
    const gate = {
      reducedMotion: !!host.reducedMotion,
      visible: gateState.visible,
      windowFocused: gateState.windowFocused,
      intersecting: gateState.intersecting,
      displayed: gateState.displayed && width > 1 && height > 1,
      engaged,
      live: live(),
    }
    if (!promptFxShouldLoop(gate)) {
      paint(now)
      return
    }
    const active = host.energy.current > PROMPT_FX_ENERGY_LIVE
    if (!promptFxFrameDue(now, lastDraw, promptFxFrameIntervalMs(active))) {
      frame = requestAnimationFrame(tick)
      return
    }
    due += dt
    if ((engaged || active) && due > 0.18 && particles.length < 22) {
      due = 0
      particles.push({
        x: Math.random() * width,
        y: height + 2,
        life: 0,
        span: 3 + Math.random() * 2,
        speed: 8 + Math.random() * 7,
        phase: Math.random() * Math.PI * 2,
      })
    }
    const gain = host.energy.current
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!
      p.life += dt
      p.y -= p.speed * dt * (1 + gain * 3)
      if (p.life > p.span || p.y < 0) particles.splice(i, 1)
    }
    paint(now)
    if (!disposed && promptFxShouldLoop({ ...gate, live: live() })) frame = requestAnimationFrame(tick)
  }

  const kick = () => {
    if (disposed || frame) return
    last = performance.now()
    frame = requestAnimationFrame(tick)
  }

  const { state: gateState, dispose: disposeGate } = attachPromptFxGate(canvas, kick)
  const disposeEngagement = attachPromptFxEngagement(field ?? canvas.parentElement, next => {
    engaged = next
    kick()
  })
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  sizeObserver?.observe(canvas)
  resize()
  kick()

  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    frame = 0
    sizeObserver?.disconnect()
    disposeGate()
    disposeEngagement()
    if (width && height) ctx.clearRect(0, 0, width, height)
  }
}
