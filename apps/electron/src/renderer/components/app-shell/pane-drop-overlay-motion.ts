import { animate as motionAnimate, type AnimationPlaybackControls, type MotionValue } from 'motion/react'

type AnimateValue = (
  value: MotionValue<number>,
  to: number,
  options?: { duration?: number; ease?: readonly number[]; delay?: number },
) => AnimationPlaybackControls

export const PANE_DROP_EASE = [0.22, 1, 0.36, 1] as const
export const PANE_DROP_BLUR_PX = 16
export const PANE_DROP_HINT_DELAY = 0.1
export const PANE_DROP_WASH = 0.4

export type PaneDropMotionValues = {
  blur: MotionValue<number>
  wash: MotionValue<number>
  hintOpacity: MotionValue<number>
  hintY: MotionValue<number>
  hintScale: MotionValue<number>
}

type Player = {
  enter: () => void
  leave: () => Promise<void>
  acceptThenLeave: () => Promise<void>
  snapIdle: () => void
}

const animateMotionValue: AnimateValue = (value, to, options) =>
  motionAnimate(value, to, {
    duration: options?.duration,
    delay: options?.delay,
    ease: options?.ease as [number, number, number, number],
  })

export function createPaneDropPlayer(
  values: PaneDropMotionValues,
  reducedMotion: () => boolean,
  animate: AnimateValue = animateMotionValue,
): Player {
  let generation = 0
  let running: AnimationPlaybackControls[] = []

  const dur = (seconds: number) => (reducedMotion() ? 0 : seconds)

  const stopRunning = () => {
    for (const control of running) control.stop()
    running = []
  }

  const begin = () => {
    generation += 1
    stopRunning()
    return generation
  }

  const track = (control: AnimationPlaybackControls) => {
    running.push(control)
    return control
  }

  const wait = (controls: AnimationPlaybackControls[]) =>
    Promise.all(controls.map(control => control.finished.catch(() => undefined)))

  const snapOpen = () => {
    values.blur.set(PANE_DROP_BLUR_PX)
    values.wash.set(1)
    values.hintOpacity.set(1)
    values.hintY.set(0)
    values.hintScale.set(1)
  }

  const snapIdle = () => {
    begin()
    values.blur.set(0)
    values.wash.set(0)
    values.hintOpacity.set(0)
    values.hintY.set(10)
    values.hintScale.set(0.94)
  }

  const fadeOut = () => {
    const frostDelay = dur(0.06)
    return [
      track(animate(values.hintOpacity, 0, { duration: dur(0.26), ease: PANE_DROP_EASE })),
      track(animate(values.hintY, 10, { duration: dur(0.3), ease: PANE_DROP_EASE })),
      track(animate(values.hintScale, 0.9, { duration: dur(0.28), ease: PANE_DROP_EASE })),
      track(animate(values.wash, 0, { duration: dur(0.36), ease: PANE_DROP_EASE, delay: frostDelay })),
      track(animate(values.blur, 0, { duration: dur(0.42), ease: PANE_DROP_EASE })),
    ]
  }

  const enter = () => {
    begin()
    if (reducedMotion()) {
      snapOpen()
      return
    }
    const hintDelay = PANE_DROP_HINT_DELAY
    track(animate(values.blur, PANE_DROP_BLUR_PX, { duration: 0.5, ease: PANE_DROP_EASE }))
    track(animate(values.wash, 1, { duration: 0.42, ease: PANE_DROP_EASE }))
    track(animate(values.hintOpacity, 1, { duration: 0.4, ease: PANE_DROP_EASE, delay: hintDelay }))
    track(animate(values.hintY, 0, { duration: 0.46, ease: PANE_DROP_EASE, delay: hintDelay }))
    track(animate(values.hintScale, 1, { duration: 0.46, ease: PANE_DROP_EASE, delay: hintDelay }))
  }

  const leave = async () => {
    begin()
    if (reducedMotion()) {
      values.blur.set(0)
      values.wash.set(0)
      values.hintOpacity.set(0)
      values.hintY.set(8)
      values.hintScale.set(0.92)
      return
    }
    await wait(fadeOut())
  }

  const acceptThenLeave = async () => {
    const gen = begin()
    if (reducedMotion()) {
      values.blur.set(0)
      values.wash.set(0)
      values.hintOpacity.set(0)
      values.hintY.set(8)
      values.hintScale.set(0.92)
      return
    }
    await wait([
      track(animate(values.hintScale, 0.88, { duration: 0.14, ease: PANE_DROP_EASE })),
      track(animate(values.hintY, 12, { duration: 0.14, ease: PANE_DROP_EASE })),
    ])
    if (generation !== gen) return
    await wait([
      track(animate(values.hintScale, 1.06, { duration: 0.2, ease: PANE_DROP_EASE })),
      track(animate(values.hintY, -4, { duration: 0.2, ease: PANE_DROP_EASE })),
    ])
    if (generation !== gen) return
    await wait(fadeOut())
  }

  return { enter, leave, acceptThenLeave, snapIdle }
}
