import type { EraseMode, Operation, Point } from '../types'
import { D } from '../utils'
import { ERASER_MASK_URL, getEraserMask, pruneEraserMask } from '../utils/dom'
import { segmentDistanceSquared } from '../utils/geometry'
import { BaseModel } from './base'

export interface EraserPathFragment {
  x1: number
  x2: number
  y1: number
  y2: number
  segment: number
  element: any
}

/**
 * An erasable element and the `[start, end)` slice of `pathFragments` tracing
 * it, once `sampled`. The bounds cover the element grown by `reach`, half its
 * stroke width. `filled` marks a shape that can also be hit from the inside,
 * `dead` one already removed in `element` mode.
 */
interface EraserTarget {
  element: SVGElement
  geometries: SVGGeometryElement[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  reach: number
  filled: boolean
  start: number
  end: number
  sampled: boolean
  dead?: boolean
}

const NON_INK = new Set([
  'defs',
  'mask',
  'marker',
  'clippath',
  'pattern',
  'symbol',
  'filter',
  'lineargradient',
  'radialgradient',
  'title',
  'desc',
  'style',
  'metadata',
])

const SAMPLE_SPACING = 12

const MAX_SUBDIVISIONS = 100

const CROSSING_TOLERANCE = 0.01

export class EraserModel extends BaseModel<SVGRectElement> {
  svgPointPrevious?: DOMPoint
  svgPointCurrent?: DOMPoint

  pathSubFactor = 20
  pathFragments: EraserPathFragment[] = []

  private targets: EraserTarget[] = []

  private _erased: SVGElement[] = []
  private _masked: SVGElement[] = []
  private _touched = false
  private _maskPath?: SVGPathElement
  private _maskData = ''

  get eraseMode(): EraseMode {
    return this.brush.eraseMode ?? 'element'
  }

  onSelected(el: SVGSVGElement | null): void {
    this.pathFragments = []
    this.targets = []

    if (!el)
      return

    const owners = new Map<SVGElement, SVGGeometryElement[]>()

    const walk = (parent: Element, owner?: SVGElement) => {
      for (const child of Array.from(parent.children) as SVGElement[]) {
        if (NON_INK.has(child.tagName.toLowerCase()))
          continue

        if (typeof (child as SVGGeometryElement).getTotalLength === 'function') {
          const key = owner ?? child
          const geometries = owners.get(key)
          if (geometries)
            geometries.push(child as SVGGeometryElement)
          else
            owners.set(key, [child as SVGGeometryElement])
        }
        else if (child.children.length) {
          walk(child, owner ?? child)
        }
      }
    }

    walk(el)

    for (const [owner, geometries] of owners)
      this.addTarget(owner, geometries)
  }

  onUnselected(): void {
    this.pathFragments = []
    this.targets = []
  }

  override onStart(point: Point) {
    this.svgPointPrevious = this.svgElement!.createSVGPoint()
    this.svgPointPrevious.x = point.x
    this.svgPointPrevious.y = point.y
    this.svgPointCurrent = this.svgPointPrevious
    this._erased = []
    this._masked = []
    this._touched = false

    if (this.eraseMode === 'partial') {
      const x = point.x.toFixed(D)
      const y = point.y.toFixed(D)
      this._maskData = `M ${x} ${y} L ${x} ${y}`
      this.openMaskPath()
    }

    this.checkAndErase()

    return undefined
  }

  override onMove(point: Point) {
    if (!this.svgPointPrevious)
      return false

    this.svgPointCurrent = this.svgElement!.createSVGPoint()
    this.svgPointCurrent.x = point.x
    this.svgPointCurrent.y = point.y

    if (this._maskPath) {
      this._maskData += ` L ${point.x.toFixed(D)} ${point.y.toFixed(D)}`
      this._maskPath.setAttribute('d', this._maskData)
    }

    const changed = this.checkAndErase()
    this.svgPointPrevious = this.svgPointCurrent
    return changed
  }

  override onEnd(): Operation | undefined {
    this.svgPointPrevious = undefined
    this.svgPointCurrent = undefined

    return this.eraseMode === 'partial'
      ? this.commitMask()
      : this.commitRemoval()
  }

  /**
   * Turn the nodes removed by an `element` mode stroke into an undo step, or
   * none at all when the stroke hit nothing.
   */
  private commitRemoval(): Operation | undefined {
    const erased = this._erased
    this._erased = []

    if (!erased.length)
      return undefined

    return {
      undo: () => erased.forEach(v => this.drauu._restoreNode(v)),
      redo: () => erased.forEach(v => this.drauu._removeNode(v)),
    }
  }

  /**
   * Turn a `partial` mode stroke into an undo step that drops its mask path and
   * unmasks only the elements this stroke was the first to mask, or none at all
   * when the trail never passed over ink.
   */
  private commitMask(): Operation | undefined {
    const path = this._maskPath
    const masked = this._masked
    const svg = this.svgElement
    const touched = this._touched

    this._maskPath = undefined
    this._masked = []
    this._maskData = ''
    this._touched = false

    if (!path)
      return undefined

    if (!touched) {
      path.remove()
      pruneEraserMask(svg)
      return undefined
    }

    return {
      undo: () => {
        path.remove()
        masked.forEach(el => el.removeAttribute('mask'))
        pruneEraserMask(svg)
      },
      redo: () => {
        if (svg)
          getEraserMask(svg).append(path)
        masked.forEach(el => el.setAttribute('mask', ERASER_MASK_URL))
      },
    }
  }

  /**
   * Add the black path that the current `partial` stroke paints itself into.
   */
  private openMaskPath() {
    const svg = this.svgElement
    if (!svg)
      return

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', this._maskData)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#000')
    path.setAttribute('stroke-width', this.brush.size.toString())
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')

    getEraserMask(svg).append(path)
    this._maskPath = path
  }

  /**
   * Register an element and the box that gates it, which is all that picking up
   * the eraser pays for. Sampling waits until the tip is actually nearby.
   */
  private addTarget(element: SVGElement, geometries: SVGGeometryElement[]) {
    let reach = 0
    let filled = false

    for (const geometry of geometries) {
      reach = Math.max(reach, (Number.parseFloat(geometry.getAttribute('stroke-width') || '0') || 0) / 2)
      const fill = geometry.getAttribute('fill')
      filled ||= !!fill && fill !== 'none' && fill !== 'transparent'
    }

    let box: DOMRect
    try {
      box = (element as SVGGraphicsElement).getBBox()
    }
    catch {
      return
    }

    this.targets.push({
      element,
      geometries,
      minX: box.x - reach,
      minY: box.y - reach,
      maxX: box.x + box.width + reach,
      maxY: box.y + box.height + reach,
      reach,
      filled,
      start: 0,
      end: 0,
      sampled: false,
    })
  }

  /**
   * Walk a target's geometry into fragments, once, the first time the eraser
   * comes within range of it.
   */
  private sample(target: EraserTarget) {
    target.sampled = true
    target.start = this.pathFragments.length

    for (const geometry of target.geometries) {
      let length = 0
      try {
        length = geometry.getTotalLength()
      }
      catch {
        continue
      }

      if (!length)
        continue

      const count = Math.min(
        MAX_SUBDIVISIONS,
        Math.max(this.pathSubFactor, Math.ceil(length / SAMPLE_SPACING)),
      )

      let previous = geometry.getPointAtLength(0)
      for (let i = 1; i <= count; i++) {
        const current = geometry.getPointAtLength(length * i / count)
        this.pathFragments.push({
          x1: previous.x,
          y1: previous.y,
          x2: current.x,
          y2: current.y,
          segment: i - 1,
          element: target.element,
        })
        previous = current
      }
    }

    target.end = this.pathFragments.length
  }

  /**
   * Erase everything under the segment from the previous point to the current
   * one, and report whether the canvas changed.
   */
  private checkAndErase(): boolean {
    const previous = this.svgPointPrevious
    const current = this.svgPointCurrent
    if (!previous || !current)
      return false

    const partial = this.eraseMode === 'partial'
    const reach = partial ? this.brush.size / 2 : CROSSING_TOLERANCE

    const minX = Math.min(previous.x, current.x) - reach
    const minY = Math.min(previous.y, current.y) - reach
    const maxX = Math.max(previous.x, current.x) + reach
    const maxY = Math.max(previous.y, current.y) + reach

    let changed = false

    for (const target of this.targets) {
      if (target.dead)
        continue

      if (target.minX > maxX || target.maxX < minX || target.minY > maxY || target.maxY < minY)
        continue

      if (!target.element.isConnected)
        continue

      if (!target.sampled)
        this.sample(target)

      if (!this.touches(target, previous, current, reach))
        continue

      if (partial) {
        changed = true
        this._touched = true
        if (target.element.getAttribute('mask') === ERASER_MASK_URL)
          continue
        target.element.setAttribute('mask', ERASER_MASK_URL)
        this._masked.push(target.element)
      }
      else {
        target.dead = true
        this.drauu._removeNode(target.element)
        this._erased.push(target.element)
        changed = true
      }
    }

    return changed
  }

  /**
   * Whether an eraser tip of the given reach, dragged from `previous` to
   * `current`, comes close enough to a target to take ink off it.
   */
  private touches(target: EraserTarget, previous: DOMPoint, current: DOMPoint, reach: number) {
    const limit = reach + target.reach
    const limitSquared = limit * limit

    for (let i = target.start; i < target.end; i++) {
      const fragment = this.pathFragments[i]
      const distance = segmentDistanceSquared(
        fragment.x1,
        fragment.y1,
        fragment.x2,
        fragment.y2,
        previous.x,
        previous.y,
        current.x,
        current.y,
      )
      if (distance <= limitSquared)
        return true
    }

    const geometry = target.element as SVGGeometryElement
    if (target.filled && typeof geometry.isPointInFill === 'function')
      return geometry.isPointInFill(current) || geometry.isPointInFill(previous)

    return false
  }
}
