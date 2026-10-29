import * as React from 'react'
import { useReducedMotion } from 'motion/react'
import { Particles, ParticlesProvider } from '@tsparticles/react'
import { loadSlim } from '@tsparticles/slim'
import type { Engine, ISourceOptions } from '@tsparticles/engine'

async function loadEffortParticles(engine: Engine) {
  await loadSlim(engine)
}

function particleOptions(mode: 'max' | 'prelude', colors: string[]): ISourceOptions {
  const max = mode === 'max'
  return {
    fullScreen: { enable: false },
    fpsLimit: 40,
    detectRetina: true,
    pauseOnBlur: true,
    particles: {
      number: { value: max ? 240 : 12 },
      color: { value: colors },
      shape: { type: 'square' },
      opacity: {
        value: { min: max ? 0.35 : 0.12, max: max ? 0.95 : 0.4 },
        animation: { enable: true, speed: max ? 0.7 : 0.25, sync: false },
      },
      size: { value: max ? 3.1 : 1.6 },
      move: {
        enable: true,
        speed: max ? 0.12 : 0.1,
        direction: 'none',
        outModes: { default: 'bounce' },
      },
      links: { enable: false },
    },
    interactivity: {
      detectsOn: 'canvas',
      events: {
        onHover: { enable: false },
        onClick: { enable: false },
      },
    },
  }
}

/** tsParticles field for Max, and a sparse prelude on High / Extra High. */
export function EffortParticles({ mode }: { mode: 'max' | 'prelude' }) {
  const reduced = useReducedMotion()
  const hostRef = React.useRef<HTMLSpanElement>(null)
  const [colors, setColors] = React.useState<string[] | null>(null)
  const id = React.useId().replace(/:/g, '')
  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const style = getComputedStyle(host)
    const next = [1, 2, 3, 4]
      .map(index => style.getPropertyValue(`--prompt-particle-${index}`).trim())
      .filter(Boolean)
    setColors(next.length >= 2 ? next : ['#d9ccf3', '#b794e8', '#8b6ad4', '#c5d4ff'])
  }, [mode])
  const options = React.useMemo(
    () => colors ? particleOptions(mode, colors) : null,
    [colors, mode],
  )

  return (
    <span ref={hostRef} className="prompt-effort-particles" data-mode={mode} aria-hidden="true">
      <span className="prompt-effort-particle-fallback" />
      {!reduced && options && (
        <ParticlesProvider init={loadEffortParticles}>
          <Particles
            id={`effort-particles-${id}`}
            className="prompt-effort-particle-host"
            options={options}
          />
        </ParticlesProvider>
      )}
    </span>
  )
}
