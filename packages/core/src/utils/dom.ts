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
