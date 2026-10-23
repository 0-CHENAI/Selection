import type { Bounds } from './types';

export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 540;
export const BOUNDS_TOLERANCE = 0.6;
export const OVERLAP_PAD = 0.8;

export function isFiniteBounds(bounds: Bounds): boolean {
  return bounds.length === 4 && bounds.every(value => Number.isFinite(value));
}

export function outOfCanvas(bounds: Bounds): string | undefined {
  const [x, y, w, h] = bounds;
  if (w <= 0 || h <= 0) return `non-positive size ${w}×${h}`;
  if (x < -BOUNDS_TOLERANCE || y < -BOUNDS_TOLERANCE) return `origin ${x},${y} is off canvas`;
  if (x + w > CANVAS_WIDTH + BOUNDS_TOLERANCE || y + h > CANVAS_HEIGHT + BOUNDS_TOLERANCE) {
    return `box ${x},${y} ${w}×${h} exceeds ${CANVAS_WIDTH}×${CANVAS_HEIGHT}`;
  }
  return undefined;
}

export function intersects(a: Bounds, b: Bounds, pad = OVERLAP_PAD): boolean {
  return a[0] + pad < b[0] + b[2] && a[0] + a[2] > b[0] + pad
    && a[1] + pad < b[1] + b[3] && a[1] + a[3] > b[1] + pad;
}

export function inches(pt: number): number {
  return pt / 72;
}
