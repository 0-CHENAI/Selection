import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(CustomEase)

export const proMicroScaleEase = CustomEase.create('proMicroScaleFade', '0.32,0.72,0,1')

/** Smooth speed, acceleration, and jerk, including the transition through the peak. */
export const edgeOrbitEase = (progress: number) =>
  progress ** 4 * (35 + progress * (-84 + progress * (70 - 20 * progress)))

export const PRO_IDENTITY_EDGE_LENGTH = 96
export const PRO_IDENTITY_EDGE_DASH = '18 78'
export const PRO_IDENTITY_EDGE_HIDDEN = '0 96'

export const PRO_IDENTITY_INK_DURATION = 1.8
export const PRO_IDENTITY_INK_START_AT = 1.1
export const PRO_IDENTITY_DASH_DURATION = 0.4
export const PRO_IDENTITY_EDGE_FADE_DURATION = 0.3
export const PRO_IDENTITY_REDUCED_START_AT = 0.25
export const PRO_IDENTITY_REDUCED_INK_DURATION = 0.15

/** Composer toggle: same ink + edge language as the lockup, scaled to ~1/3 so NORM↔PRO stays snappy. */
export const SESSION_MODE_BADGE_INK_DURATION = 0.6
export const SESSION_MODE_BADGE_DASH_DURATION =
  PRO_IDENTITY_DASH_DURATION * SESSION_MODE_BADGE_INK_DURATION / PRO_IDENTITY_INK_DURATION
export const SESSION_MODE_BADGE_EDGE_FADE_DURATION =
  PRO_IDENTITY_EDGE_FADE_DURATION * SESSION_MODE_BADGE_INK_DURATION / PRO_IDENTITY_INK_DURATION

export type ProInkRevealConfig = {
  reduced: boolean | undefined
  startAt: number
  inkDuration: number
  dashDuration: number
  fadeDuration: number
  mode: string | object | null
  trace: string | object | null
}

export function addProInkReveal(timeline: gsap.core.Timeline, config: ProInkRevealConfig) {
  const { reduced, startAt, inkDuration, dashDuration, fadeDuration, mode, trace } = config
  timeline.fromTo(mode, {
    '--pro-ink-opacity': 0,
    scale: reduced ? 1 : 0.98,
    transformOrigin: '50% 50%',
    '--pro-ink-progress': reduced ? '100%' : '0%',
  }, {
    '--pro-ink-opacity': 1,
    scale: 1,
    '--pro-ink-progress': '100%',
    duration: reduced ? PRO_IDENTITY_REDUCED_INK_DURATION : inkDuration,
    ease: reduced ? proMicroScaleEase : edgeOrbitEase,
  }, startAt)
  if (!reduced) {
    timeline
      .set(trace, { opacity: 1, strokeDashoffset: 0, strokeDasharray: PRO_IDENTITY_EDGE_HIDDEN }, startAt)
      .to(trace, { strokeDasharray: PRO_IDENTITY_EDGE_DASH, duration: dashDuration, ease: edgeOrbitEase }, startAt)
      .to(trace, { strokeDashoffset: -PRO_IDENTITY_EDGE_LENGTH, duration: inkDuration, ease: edgeOrbitEase }, startAt)
      .to(trace, { opacity: 0, duration: fadeDuration, ease: 'sine.inOut' }, startAt + inkDuration - fadeDuration)
  }
  return timeline
}

export function addSessionModeBadgeReveal(timeline: gsap.core.Timeline, reduced: boolean | undefined) {
  addProInkReveal(timeline, {
    reduced,
    startAt: 0,
    inkDuration: SESSION_MODE_BADGE_INK_DURATION,
    dashDuration: SESSION_MODE_BADGE_DASH_DURATION,
    fadeDuration: SESSION_MODE_BADGE_EDGE_FADE_DURATION,
    mode: '.pro-identity-mode',
    trace: '.pro-identity-edge-trace',
  })
  timeline.fromTo('.session-mode-badge', { autoAlpha: 0 }, {
    autoAlpha: 1,
    duration: reduced ? PRO_IDENTITY_REDUCED_INK_DURATION : SESSION_MODE_BADGE_INK_DURATION,
    ease: reduced ? proMicroScaleEase : edgeOrbitEase,
  }, 0)
  return timeline
}

export function addProIdentityLockupReveal(timeline: gsap.core.Timeline, reduced: boolean | undefined) {
  return addProInkReveal(timeline, {
    reduced,
    startAt: reduced ? PRO_IDENTITY_REDUCED_START_AT : PRO_IDENTITY_INK_START_AT,
    inkDuration: PRO_IDENTITY_INK_DURATION,
    dashDuration: PRO_IDENTITY_DASH_DURATION,
    fadeDuration: PRO_IDENTITY_EDGE_FADE_DURATION,
    mode: '.pro-identity-mode',
    trace: '.pro-identity-edge-trace',
  })
}
