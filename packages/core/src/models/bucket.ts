import type { Operation, Point } from '../types'
import type { FloodRegion } from '../utils/flood'
import { collectInk, FILL_MARKER, insertFill } from '../utils/dom'
import { floodRegion } from '../utils/flood'
import { BaseModel } from './base'

/**
 * How far a shape's bounds may sit from the space inside it, on top of half a
 * stroke width, and still count as the same thing.
 */
const SLACK = 2

/**
 * Fills the space under the pointer with the brush color, on click.
 *
 * The space is whatever the ink around the click encloses, found by flooding
 * the drawing outward from the point until strokes stop it. It does not matter
 * how many strokes fence a space in, or whether any one of them is a closed
 * shape — a triangle drawn as three separate lines fills, and so does the
 * inside of a freehand loop.
 *
 * A click that lands on ink instead repaints the shape it landed on, which is
 * how a filled shape, or a stroke thick enough to click on, gets recolored.
 *
 * Hold alt to clear a fill rather than paint one.
 */
export class BucketModel extends BaseModel<SVGGeometryElement> {
  private operation: Operation | undefined

  override onStart(point: Point) {
    this.operation = this.plan(point)
    // Fill through the operation itself, so that a redo repeats exactly what
    // the click did.
    this.operation?.redo()

    return undefined
  }

  override onEnd(): Operation | undefined {
    const operation = this.operation
    this.operation = undefined
    return operation
  }

  /**
   * Work out what a click at this point should paint, without painting it.
   */
  private plan(point: Point): Operation | undefined {
    const svg = this.svgElement
    if (!svg)
      return undefined

    const { onInk, region } = floodRegion(svg, point)

    if (onInk) {
      const shape = this.inkAt(point)
      return shape ? this.paintShape(shape) : undefined
    }

    // Nothing enclosed the click, so there is no space to fill.
    if (!region)
      return undefined

    // A space that turns out to be exactly the inside of one hollow shape is
    // painted through that shape instead of over it: crisper at any zoom, and
    // it stays with the shape when the shape is erased.
    const shape = region.loops === 1 ? this.shapeAround(point, region) : undefined

    return shape
      ? this.paintShape(shape)
      : this.paintRegion(svg, region)
  }

  /**
   * The topmost shape covering the point, which for a click that landed on ink
   * is the shape whose paint the user clicked.
   */
  private inkAt(point: Point): SVGGeometryElement | undefined {
    const shapes = this.shapes()

    for (let i = shapes.length - 1; i >= 0; i--) {
      if (this.covers(shapes[i], point))
        return shapes[i]
    }

    return undefined
  }

  /**
   * The one hollow shape a space belongs to, when the space is exactly that
   * shape's inside, or nothing when the space was fenced in some other way.
   */
  private shapeAround(point: Point, region: FloodRegion): SVGGeometryElement | undefined {
    let picked: SVGGeometryElement | undefined
    let pickedArea = Number.POSITIVE_INFINITY

    for (const shape of this.shapes()) {
      // A shape that is painted inside is ink in its own right, not a fence
      // around a space — a freehand stroke is its own filled outline.
      const fill = shape.getAttribute('fill')
      if (fill == null || (fill !== 'none' && fill !== 'transparent'))
        continue

      // Paint laid into a shape's own fill sits behind everything else that
      // shape wears — its translucency, or an eraser's mask — which would tint
      // or rub holes in it. Such a shape is left alone and the space traced.
      if (shape.hasAttribute('mask'))
        continue

      const opacity = shape.getAttribute('opacity')
      if (opacity != null && Number.parseFloat(opacity) !== 1)
        continue

      if (!this.covers(shape, point))
        continue

      let box: DOMRect
      try {
        box = shape.getBBox()
      }
      catch {
        continue
      }

      const size = Number.parseFloat(shape.getAttribute('stroke-width') || '')
      const slack = (Number.isFinite(size) ? size : 1) / 2 + SLACK + region.unit * 2
      if (Math.abs(box.x - region.minX) > slack
        || Math.abs(box.y - region.minY) > slack
        || Math.abs(box.x + box.width - region.maxX) > slack
        || Math.abs(box.y + box.height - region.maxY) > slack) {
        continue
      }

      // `<=` so that between shapes covering the same area the one painted
      // last, which is the one the user sees, wins.
      const area = box.width * box.height
      if (area <= pickedArea) {
        picked = shape
        pickedArea = area
      }
    }

    return picked
  }

  private shapes() {
    return [...collectInk(this.svgElement!).values()].flat()
  }

  private covers(shape: SVGGeometryElement, point: Point) {
    if (typeof shape.isPointInFill !== 'function')
      return false

    const target = this.svgElement!.createSVGPoint()
    target.x = point.x
    target.y = point.y

    try {
      return shape.isPointInFill(target)
    }
    catch {
      return false
    }
  }

  /**
   * The undo step for painting a shape's own fill, or none at all when the
   * shape already carries this exact fill and the click would only cost an
   * undo step.
   */
  private paintShape(shape: SVGGeometryElement): Operation | undefined {
    // Clearing a traced fill takes the whole shape away with it. Nothing else
    // was ever drawn there to leave behind.
    if (this.altPressed && shape.hasAttribute(FILL_MARKER)) {
      const svg = this.svgElement!
      return {
        undo: () => insertFill(svg, shape),
        redo: () => shape.remove(),
      }
    }

    const opacity = this.brush.opacity ?? 1
    const fill = this.altPressed ? 'transparent' : this.brush.color
    const fillOpacity = this.altPressed || opacity === 1 ? null : opacity.toString()

    // `null` stands for an attribute that isn't there, so that undoing removes
    // it again rather than pinning a default onto the shape.
    const previousFill = shape.getAttribute('fill')
    const previousFillOpacity = shape.getAttribute('fill-opacity')

    if (fill === previousFill && fillOpacity === previousFillOpacity)
      return undefined

    return {
      undo: () => {
        setAttribute(shape, 'fill', previousFill)
        setAttribute(shape, 'fill-opacity', previousFillOpacity)
      },
      redo: () => {
        setAttribute(shape, 'fill', fill)
        setAttribute(shape, 'fill-opacity', fillOpacity)
      },
    }
  }

  /**
   * The undo step for laying a traced space down as paint of its own.
   */
  private paintRegion(svg: SVGSVGElement, region: FloodRegion): Operation | undefined {
    // An empty space holds no paint for an alt-click to take away.
    if (this.altPressed)
      return undefined

    const opacity = this.brush.opacity ?? 1
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    node.setAttribute(FILL_MARKER, '')
    node.setAttribute('d', region.d)
    node.setAttribute('fill', this.brush.color)
    node.setAttribute('stroke', 'none')

    if (opacity !== 1)
      node.setAttribute('fill-opacity', opacity.toString())

    return {
      undo: () => node.remove(),
      redo: () => insertFill(svg, node),
    }
  }
}

function setAttribute(el: SVGElement, name: string, value: string | null) {
  if (value == null)
    el.removeAttribute(name)
  else
    el.setAttribute(name, value)
}
