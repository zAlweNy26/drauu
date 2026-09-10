export function createArrowHead(id: string, fill: string) {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  head.setAttribute('fill', fill)
  marker.setAttribute('id', id)
  marker.setAttribute('viewBox', '0 -5 10 10')
  marker.setAttribute('refX', '5')
  marker.setAttribute('refY', '0')
  marker.setAttribute('markerWidth', '4')
  marker.setAttribute('markerHeight', '4')
  marker.setAttribute('orient', 'auto')
  head.setAttribute('d', 'M0,-5L10,0L0,5')
  marker.appendChild(head)
  defs.appendChild(marker)

  return defs
}

export const ERASER_MASK_ID = 'drauu-eraser-mask'

export const ERASER_MASK_URL = `url(#${ERASER_MASK_ID})`

const MASK_BOX = { x: '-100%', y: '-100%', width: '300%', height: '300%' }

/**
 * The shared mask backing `eraseMode: 'partial'`, created on first use. Every
 * element the eraser has touched points at it, and each erase stroke paints
 * itself into it in black.
 *
 * Its id is fixed so that `dump()` / `load()` round-trips, at the cost of being
 * shared by any two drauu instances in one document.
 */
export function getEraserMask(svg: SVGSVGElement): SVGMaskElement {
  const existing = svg.querySelector<SVGMaskElement>(`mask#${ERASER_MASK_ID}`)
  if (existing)
    return existing

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  defs.setAttribute('data-drauu-eraser', '')

  const mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask')
  mask.setAttribute('id', ERASER_MASK_ID)
  mask.setAttribute('maskUnits', 'userSpaceOnUse')

  const base = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  base.setAttribute('fill', '#fff')

  for (const [key, value] of Object.entries(MASK_BOX)) {
    mask.setAttribute(key, value)
    base.setAttribute(key, value)
  }

  mask.append(base)
  defs.append(mask)
  svg.prepend(defs)

  return mask
}

/**
 * Drop the mask once its last erase stroke has been undone, so a drawing that
 * ends up untouched dumps exactly as it did before the eraser was picked up.
 */
export function pruneEraserMask(svg: SVGSVGElement | null) {
  const mask = svg?.querySelector<SVGMaskElement>(`mask#${ERASER_MASK_ID}`)
  if (!mask || mask.childElementCount > 1)
    return

  const defs = mask.parentElement
  if (defs?.hasAttribute('data-drauu-eraser'))
    defs.remove()
  else
    mask.remove()
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

/**
 * Every drawn element on the canvas mapped to the geometry it is made of, in
 * painting order. Geometry nested in a group is reported under that group, so
 * that a tool acting on whole drawings (the eraser) and one acting on a single
 * shape (the bucket) can both start from the same walk.
 */
export function collectInk(svg: SVGSVGElement): Map<SVGElement, SVGGeometryElement[]> {
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

  walk(svg)

  return owners
}

/**
 * Marks a shape the bucket has traced, as opposed to one the user drew.
 */
export const FILL_MARKER = 'data-drauu-fill'

/**
 * Slot a traced fill in under every stroke, and over the fills already there,
 * so that paint never hides the outlines that shaped it.
 */
export function insertFill(svg: SVGSVGElement, node: SVGElement) {
  for (const child of Array.from(svg.children) as SVGElement[]) {
    if (NON_INK.has(child.tagName.toLowerCase()) || child.hasAttribute(FILL_MARKER))
      continue

    child.before(node)
    return
  }

  svg.append(node)
}
