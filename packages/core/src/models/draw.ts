import type { Point } from '../types'
import { D, guid } from '../utils'
import { createArrowHead } from '../utils/dom'
import { simplify } from '../utils/simplify'
import { BaseModel } from './base'

export class DrawModel extends BaseModel<SVGPathElement> {
  /**
   * Every point of the stroke in progress, in the order it was drawn.
   *
   * Only ever appended to until the stroke ends, so a consumer can read it
   * incrementally. The path is simplified when the stroke is committed.
   */
  public points: Point[] = []
  private arrowId: string | undefined
  /** `d` for the leading segments, which can no longer change. */
  private settledPath = ''
  /** Index of the last segment in `settledPath`; -1 before the first point. */
  private settledTo = -1

  override onStart(point: Point) {
    this.el = this.createElement('path', { fill: 'transparent' })
    this.points = [point]
    this.settledPath = ''
    this.settledTo = -1

    if (this.brush.arrowEnd) {
      this.arrowId = guid()
      const head = createArrowHead(this.arrowId, this.brush.color)
      this.el.appendChild(head)
    }

    return this.el
  }

  override onMove(point: Point) {
    if (!this.el)
      this.onStart(point)

    if (this.points[this.points.length - 1] !== point)
      this.points.push(point)

    this.attr('d', this.pathData())
    return true
  }

  /**
   * `DrawModel.toSvgData(this.points)`, without rebuilding it on every move.
   *
   * Segment i reads points i - 2 to i + 1, so it is final as soon as point
   * i + 1 exists. Those are appended to `settledPath` once; only the last
   * segment is recomputed, keeping each move O(1) in segment math however
   * long the stroke gets.
   */
  private pathData() {
    const points = this.points
    if (this.settledTo < 0) {
      this.settledPath = DrawModel.moveCommand(points[0])
      this.settledTo = 0
    }

    for (let i = this.settledTo + 1; i <= points.length - 2; i++) {
      this.settledPath += ` ${DrawModel.bezierCommand(points[i], i, points)}`
      this.settledTo = i
    }

    const last = points.length - 1
    return last > this.settledTo
      ? `${this.settledPath} ${DrawModel.bezierCommand(points[last], last, points)}`
      : this.settledPath
  }

  override onEnd() {
    const path = this.el
    this.el = null

    if (!path)
      return false

    path.setAttribute('d', DrawModel.toSvgData(simplify(this.points, 1, true)))

    if (!path.getTotalLength()) {
      // Draw a point
      const { x, y } = this.points[0]
      const r = this.brush.size / 2
      path.setAttribute('d', `M ${x - r} ${y} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0`)
      path.setAttribute('fill', this.brush.color)
      path.setAttribute('stroke-width', '0')
    }

    return true
  }

  // https://francoisromain.medium.com/smooth-a-svg-path-with-cubic-bezier-curves-e37b49d46c74
  static line(a: Point, b: Point) {
    const lengthX = b.x - a.x
    const lengthY = b.y - a.y
    return {
      length: Math.sqrt(lengthX ** 2 + lengthY ** 2),
      angle: Math.atan2(lengthY, lengthX),
    }
  }

  static controlPoint(current: Point, previous: Point, next?: Point, reverse?: boolean) {
  // When 'current' is the first or last point of the array
  // 'previous' or 'next' don't exist.
  // Replace with 'current'
    const p = previous || current
    const n = next || current
    // The smoothing ratio
    const smoothing = 0.2
    // Properties of the opposed-line
    const o = DrawModel.line(p, n)
    // If is end-control-point, add PI to the angle to go backward
    const angle = o.angle + (reverse ? Math.PI : 0)
    const length = o.length * smoothing
    // The control point position is relative to the current point
    const x = current.x + Math.cos(angle) * length
    const y = current.y + Math.sin(angle) * length
    return { x, y }
  }

  static bezierCommand(point: Point, i: number, points: Point[]) {
  // start control point
    const cps = DrawModel.controlPoint(points[i - 1], points[i - 2], point)
    // end control point
    const cpe = DrawModel.controlPoint(point, points[i - 1], points[i + 1], true)
    return `C ${cps.x.toFixed(D)},${cps.y.toFixed(D)} ${cpe.x.toFixed(D)},${cpe.y.toFixed(D)} ${point.x.toFixed(D)},${point.y.toFixed(D)}`
  }

  static moveCommand(point: Point) {
    return `M ${point.x.toFixed(D)},${point.y.toFixed(D)}`
  }

  static toSvgData(points: Point[]) {
    return points.reduce(
      (acc, point, i, a) =>
        i === 0
          ? DrawModel.moveCommand(point)
          : `${acc} ${DrawModel.bezierCommand(point, i, a)}`,
      '',
    )
  }
}
