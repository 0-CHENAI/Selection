import {
  attachPromptFxGate,
  createPromptFxClock,
  decorativeLayerDpr,
  promptFxShouldLoop,
  promptFxSyncClock,
  type PromptFxCssBox,
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
  let last = 0
  let due = 0
  let disposed = false
  let fillStyle = ''
  const clock = createPromptFxClock()
  const particles: Spark[] = []

  const looping = () => promptFxShouldLoop({
    reducedMotion: !!host.reducedMotion,
    visible: gateState.visible,
    intersecting: gateState.intersecting,
    displayed: gateState.displayed && width > 1 && height > 1,
  })

  const readColor = () => {
    try {
      fillStyle = getComputedStyle(canvas).color
    } catch {
      fillStyle = fillStyle || 'currentColor'
    }
  }

  const applyBox = (box: PromptFxCssBox) => {
    if (disposed) return
    const dpr = decorativeLayerDpr(window.devicePixelRatio || 1)
    const nextWidth = box.width
    const nextHeight = box.height
    const nextStoreW = Math.round(nextWidth * dpr)
    const nextStoreH = Math.round(nextHeight * dpr)
    if (!nextStoreW || !nextStoreH) {
      width = 0
      height = 0
      return
    }
    if (nextStoreW === canvas.width && nextStoreH === canvas.height && width === nextWidth && height === nextHeight) return
    width = nextWidth
    height = nextHeight
    canvas.width = nextStoreW
    canvas.height = nextStoreH
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const paint = (now: number) => {
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = fillStyle
    const gain = host.energy.current
    for (const p of particles) {
      ctx.globalAlpha = Math.sin(p.life / p.span * Math.PI) * 0.5 * Math.max(0, Math.min(1, (height - p.y) / 12, p.y / 12))
      ctx.beginPath()
      ctx.arc(p.x + Math.sin(now / 1100 + p.phase) * 5, p.y, 0.9 + gain * 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  const tick = (wall: number) => {
    frame = 0
    if (disposed || !width || !height) return
    const animate = looping()
    const now = promptFxSyncClock(clock, animate, wall)
    if (!animate) return
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    host.energy.current *= Math.exp(-dt / 0.8)
    const gain = host.energy.current
    due += dt
    if (due > 0.18 && particles.length < 22) {
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
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!
      p.life += dt
      p.y -= p.speed * dt * (1 + gain * 3)
      if (p.life > p.span || p.y < 0) particles.splice(i, 1)
    }
    paint(now)
    if (!disposed && looping()) frame = requestAnimationFrame(tick)
  }

  const kick = () => {
    if (disposed || frame) return
    if (!looping()) {
      promptFxSyncClock(clock, false, performance.now())
      return
    }
    frame = requestAnimationFrame(tick)
  }

  const { state: gateState, dispose: disposeGate } = attachPromptFxGate(canvas, kick, applyBox)
  readColor()
  let themeObserver: MutationObserver | undefined
  if (typeof MutationObserver === 'function' && document.documentElement) {
    themeObserver = new MutationObserver(() => {
      readColor()
      kick()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  }
  kick()

  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    frame = 0
    themeObserver?.disconnect()
    disposeGate()
    if (width && height) ctx.clearRect(0, 0, width, height)
  }
}
