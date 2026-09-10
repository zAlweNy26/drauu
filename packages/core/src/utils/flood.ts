import type { Point } from '../types'
import { collectInk, ERASER_MASK_ID, ERASER_MASK_URL } from './dom'
import { D } from './index'
import { simplify } from './simplify'

/** A space enclosed by ink, traced back into SVG user units. */
export interface FloodRegion {
  /** Path data for the space, one subpath per contour. */
  d: string
  /** Contour count. More than one means the space has islands in it. */
  loops: number
  /** Bounds of the space. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** User units covered by one raster pixel, the accuracy of the trace. */
  unit: number
}

export interface FloodResult {
  /** Whether the point landed on ink rather than in a space between it. */
  onInk: boolean
  /** The space around the point, absent when it is not enclosed by ink. */
  region?: FloodRegion
}

/** Raster pixels per user unit. */
const SCALE = 1

/** Ink is rasterized to at most this many pixels, then the trace coarsens. */
const MAX_PIXELS = 4_000_000

/**
 * Alpha at which a rasterized pixel counts as ink.
 *
 * Held well clear of the faint end, because the antialiased skirt around a
 * stroke is not the stroke: counting the skirt as ink walls a sharp corner off
 * long before the ink itself does, and paint stops short of the corner.
 */
const INK_ALPHA = 96

/** Alpha at which a pixel holds any ink at all. */
const FAINT_ALPHA = 8

/** Thinnest wall a stroke may rasterize to, in pixels, so none of them leak. */
const MIN_WALL = 1.2

/**
 * How far walls grow, in user units, on the second attempt at a space that
 * leaked, bridging the gaps a shaky hand leaves behind.
 */
const BRIDGE = 1.5

/** How far the space grows back, in user units, to sit under the ink. */
const TUCK = 1.5

/** Trace accuracy, in pixels. Enough to take the staircase off a diagonal. */
const TRACE_TOLERANCE = 1.4

/**
 * Find the space that surrounds `point`, the way a paint bucket does: whatever
 * ink is in the way stops it, however many strokes that ink came from.
 *
 * The drawing is rasterized to a canvas first, since the enclosure the user
 * sees is a property of the painted picture rather than of any one element in
 * it. Rasterizing runs through `Path2D` rather than through an `<svg>` image,
 * which keeps the whole thing synchronous, and free of the canvas tainting an
 * external image would bring.
 */
export function floodRegion(svg: SVGSVGElement, point: Point): FloodResult {
  const miss: FloodResult = { onInk: false }

  let box: DOMRect
  try {
    box = svg.getBBox()
  }
  catch {
    return miss
  }

  // The raster spans the ink and the point, so that a point outside the drawing
  // leaks out immediately rather than paying for a raster of its own.
  const spanX = Math.max(box.x + box.width, point.x) - Math.min(box.x, point.x)
  const spanY = Math.max(box.y + box.height, point.y) - Math.min(box.y, point.y)
  const scale = Math.min(SCALE, Math.sqrt(MAX_PIXELS / Math.max(1, spanX * spanY)))
  const unit = 1 / scale
  const bridge = Math.max(1, Math.round(BRIDGE * scale))
  const tuck = Math.max(1, Math.round(TUCK * scale))

  // Blank margin around the ink, wide enough that bridging cannot reach the
  // edge and wall an unenclosed space in by accident.
  const margin = bridge + 2
  const originX = Math.min(box.x, point.x) - margin * unit
  const originY = Math.min(box.y, point.y) - margin * unit
  const width = Math.max(1, Math.ceil(spanX * scale) + margin * 2)
  const height = Math.max(1, Math.ceil(spanY * scale) + margin * 2)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx)
    return miss

  const base = new DOMMatrix([scale, 0, 0, scale, -originX * scale, -originY * scale])
  let root: DOMMatrix | undefined
  try {
    root = svg.getScreenCTM()?.inverse()
  }
  catch {
    root = undefined
  }

  const ink = [...collectInk(svg).values()].flat()
  const rubbed = ink.filter(el => el.getAttribute('mask') === ERASER_MASK_URL)

  // Ink the partial eraser has taken away is still in the document, invisible.
  // The elements it has touched go down first and the eraser's own trail is
  // punched out of them, so that walls stand where the picture shows them
  // rather than where the DOM happens to keep them.
  if (rubbed.length) {
    rasterize(ctx, rubbed, base, root, unit)
    ctx.globalCompositeOperation = 'destination-out'
    rasterize(ctx, Array.from(svg.querySelectorAll<SVGElement>(`mask#${ERASER_MASK_ID} path`)), base, root, unit)
    ctx.globalCompositeOperation = 'source-over'
    rasterize(ctx, ink.filter(el => !rubbed.includes(el)), base, root, unit)
  }
  else {
    rasterize(ctx, ink, base, root, unit)
  }

  const pixels = ctx.getImageData(0, 0, width, height).data
  const walls = new Uint8Array(width * height)
  const faint: number[] = []

  for (let i = 0, alpha = 3; i < walls.length; i++, alpha += 4) {
    const value = pixels[alpha]
    if (value >= INK_ALPHA)
      walls[i] = 1
    else if (value >= FAINT_ALPHA)
      faint.push(i)
  }

  // Ink thinner than a pixel never reaches the ink threshold and would leave no
  // wall at all, so a faint pixel with no solid ink beside it is taken to be all
  // the wall there is. A faint pixel next to solid ink is that ink's skirt, and
  // is left out of the way of the paint.
  const thin = faint.filter((i) => {
    const x = i % width
    return !walls[i - width] && !walls[i + width]
      && !(x > 0 && (walls[i - 1] || walls[i - width - 1] || walls[i + width - 1]))
      && !(x < width - 1 && (walls[i + 1] || walls[i - width + 1] || walls[i + width + 1]))
  })

  for (const i of thin)
    walls[i] = 1

  const startX = Math.floor((point.x - originX) * scale)
  const startY = Math.floor((point.y - originY) * scale)
  if (startX < 0 || startY < 0 || startX >= width || startY >= height)
    return miss

  const start = startY * width + startX
  // Read before the walls are grown, so that a point merely close to a stroke
  // still counts as a point in the space beside it.
  if (walls[start])
    return { onInk: true }

  // Flood the ink exactly as it rasterized. Nothing has thickened the walls
  // yet, so the paint squeezes as far into a corner as the ink itself allows.
  let space = flood(walls, width, height, start)

  // Only a space that leaked buys the forgiving second attempt, where walls
  // grow to close the gaps a shaky hand leaves behind. Growing them blunts a
  // sharp corner, which is why it is not the first thing tried.
  if (!space) {
    dilate(walls, width, height, bridge)
    if (walls[start])
      return miss
    space = flood(walls, width, height, start)
  }

  if (!space)
    return miss

  dilate(space, width, height, tuck, walls)

  const loops = trace(space, width, height)
  if (!loops.length)
    return miss

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const d = loops.map((loop) => {
    const points = loop.map(({ x, y }) => {
      const ux = originX + x * unit
      const uy = originY + y * unit
      minX = Math.min(minX, ux)
      minY = Math.min(minY, uy)
      maxX = Math.max(maxX, ux)
      maxY = Math.max(maxY, uy)
      return `${ux.toFixed(D)},${uy.toFixed(D)}`
    })
    return `M ${points.join(' L ')} Z`
  }).join(' ')

  return { onInk: false, region: { d, loops: loops.length, minX, minY, maxX, maxY, unit } }
}

/**
 * Paint elements onto the canvas as solid ink, at the size and shape they are
 * drawn on screen.
 */
function rasterize(
  ctx: CanvasRenderingContext2D,
  elements: SVGElement[],
  base: DOMMatrix,
  root: DOMMatrix | undefined,
  unit: number,
) {
  ctx.fillStyle = '#000'
  ctx.strokeStyle = '#000'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const el of elements) {
    const path = toPath2D(el)
    if (!path)
      continue

    ctx.setTransform(localMatrix(el, base, root))

    // An absent `fill` paints black and an absent `stroke` paints nothing,
    // following SVG rather than guessing.
    const fill = el.getAttribute('fill')
    if (fill == null || isVisible(fill))
      ctx.fill(path, el.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero')

    const stroke = el.getAttribute('stroke')
    if (stroke != null && isVisible(stroke)) {
      // Dashes are left out on purpose: a dotted outline walls a space off to
      // the eye just as a solid one does, and filling inside one is the whole
      // point of reaching for the bucket.
      const size = Number.parseFloat(el.getAttribute('stroke-width') || '')
      ctx.lineWidth = Math.max(Number.isFinite(size) ? size : 1, MIN_WALL * unit)
      ctx.stroke(path)
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/**
 * An element's outline as a canvas path, in its own user space.
 */
function toPath2D(el: SVGElement): Path2D | undefined {
  if (el.tagName.toLowerCase() === 'path') {
    const d = el.getAttribute('d')
    return d ? new Path2D(d) : undefined
  }

  // Everything else is walked through its own geometry, so that a rounded
  // rectangle, an ellipse and a polyline all rasterize without this having to
  // know how any one of them is spelled.
  const geometry = el as SVGGeometryElement
  if (typeof geometry.getTotalLength !== 'function')
    return undefined

  try {
    const length = geometry.getTotalLength()
    if (!length)
      return undefined

    const steps = Math.min(800, Math.max(24, Math.ceil(length / 3)))
    const path = new Path2D()
    for (let i = 0; i <= steps; i++) {
      const { x, y } = geometry.getPointAtLength(length * i / steps)
      if (i)
        path.lineTo(x, y)
      else
        path.moveTo(x, y)
    }
    return path
  }
  catch {
    return undefined
  }
}

/**
 * The transform from an element's own space to the raster, so that a `viewBox`
 * or a transform on a group lands the ink where the picture shows it.
 */
function localMatrix(el: SVGElement, base: DOMMatrix, root: DOMMatrix | undefined) {
  if (!root)
    return base

  // A `<mask>` is never rendered and so has no screen matrix of its own; its
  // contents are already in the root's space, which `base` alone covers.
  const screen = (el as SVGGraphicsElement).getScreenCTM?.()
  return screen ? base.multiply(root.multiply(screen)) : base
}

function isVisible(paint: string) {
  return paint !== '' && paint !== 'none' && paint !== 'transparent'
}

/**
 * The space reachable from `start` without crossing ink, or nothing at all when
 * it runs off the edge of the raster and so was never enclosed.
 */
function flood(walls: Uint8Array, width: number, height: number, start: number) {
  const space = new Uint8Array(width * height)
  const queue = [start]
  space[start] = 1

  while (queue.length) {
    const i = queue.pop()!
    const x = i % width
    const y = (i - x) / width

    if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
      return undefined

    if (!space[i - 1] && !walls[i - 1]) {
      space[i - 1] = 1
      queue.push(i - 1)
    }
    if (!space[i + 1] && !walls[i + 1]) {
      space[i + 1] = 1
      queue.push(i + 1)
    }
    if (!space[i - width] && !walls[i - width]) {
      space[i - width] = 1
      queue.push(i - width)
    }
    if (!space[i + width] && !walls[i + width]) {
      space[i + width] = 1
      queue.push(i + width)
    }
  }

  return space
}

/**
 * Grow a mask by a pixel in each direction, `times` over. Given `within`, it
 * may only grow into pixels that mask has set.
 */
function dilate(mask: Uint8Array, width: number, height: number, times: number, within?: Uint8Array) {
  for (let pass = 0; pass < times; pass++) {
    const grown = mask.slice()

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (mask[i] || (within && !within[i]))
          continue
        if (mask[i - 1] || mask[i + 1] || mask[i - width] || mask[i + width])
          grown[i] = 1
      }
    }

    mask.set(grown)
  }
}

/**
 * Walk the outline of a mask into closed contours of pixel corners.
 *
 * Each edge between a set pixel and an unset one is emitted so that the mask
 * lies to its right, which winds an outer contour one way and a contour round
 * an island the other, and so leaves islands unpainted under the default
 * `nonzero` fill rule.
 */
function trace(mask: Uint8Array, width: number, height: number): Point[][] {
  const stride = width + 1
  const edges = new Map<number, number[]>()

  const add = (from: number, to: number) => {
    const list = edges.get(from)
    if (list)
      list.push(to)
    else
      edges.set(from, [to])
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!mask[i])
        continue

      const topLeft = y * stride + x
      if (y === 0 || !mask[i - width])
        add(topLeft, topLeft + 1)
      if (x === width - 1 || !mask[i + 1])
        add(topLeft + 1, topLeft + 1 + stride)
      if (y === height - 1 || !mask[i + width])
        add(topLeft + 1 + stride, topLeft + stride)
      if (x === 0 || !mask[i - 1])
        add(topLeft + stride, topLeft)
    }
  }

  const loops: Point[][] = []

  for (const first of [...edges.keys()]) {
    while (edges.get(first)?.length) {
      const loop: Point[] = []
      let at = first

      for (;;) {
        const next = edges.get(at)
        const to = next?.pop()
        if (to == null)
          break
        if (!next!.length)
          edges.delete(at)

        const x = to % stride
        loop.push({ x, y: (to - x) / stride })
        at = to

        if (to === first)
          break
      }

      if (loop.length > 3)
        loops.push(simplify(loop, TRACE_TOLERANCE, true))
    }
  }

  return loops
}
