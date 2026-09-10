/**
 * Squared distance between the segment `a`-`b` and the segment `c`-`d`.
 *
 * Closest-point-between-segments, from Ericson, Real-Time Collision Detection.
 * Either segment may be zero-length.
 */
export function segmentDistanceSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const ux = bx - ax
  const uy = by - ay
  const vx = dx - cx
  const vy = dy - cy
  const wx = ax - cx
  const wy = ay - cy

  const a = ux * ux + uy * uy
  const e = vx * vx + vy * vy
  const f = vx * wx + vy * wy

  let s: number
  let t: number

  if (a <= Number.EPSILON && e <= Number.EPSILON) {
    s = 0
    t = 0
  }
  else if (a <= Number.EPSILON) {
    s = 0
    t = clamp(f / e, 0, 1)
  }
  else {
    const c = ux * wx + uy * wy
    if (e <= Number.EPSILON) {
      t = 0
      s = clamp(-c / a, 0, 1)
    }
    else {
      const b = ux * vx + uy * vy
      const denom = a * e - b * b
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = clamp(-c / a, 0, 1)
      }
      else if (t > 1) {
        t = 1
        s = clamp((b - c) / a, 0, 1)
      }
    }
  }

  const px = wx + ux * s - vx * t
  const py = wy + uy * s - vy * t
  return px * px + py * py
}

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value
}
